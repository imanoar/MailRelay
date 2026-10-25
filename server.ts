import express from 'express';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  CustomDomain,
  TempInbox,
  MailMessage,
  WebhookEndpoint,
  WebhookDeliveryLog,
  ApiKeyRecord,
  WebhookEventType,
  normalizeDomainName,
  isValidDomainName,
  isValidLocalPart,
  generateRandomLocalPart,
  buildDomainDnsSpec,
  computeDomainStatus,
  extractVerificationArtifacts,
  parseEmailAddress,
  stripSubaddressTag,
  buildRawMimeMessage,
  normalizeInboundPayload,
} from './src/lib/mailEngine';
import { createInitialSeedState } from './src/lib/emailTemplates';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '.data');
const STATE_FILE = path.join(DATA_DIR, 'mailrelay-state.json');

type WorkspaceState = ReturnType<typeof createInitialSeedState>;

function loadPersistedState(): WorkspaceState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        Array.isArray(parsed.domains) &&
        Array.isArray(parsed.inboxes) &&
        Array.isArray(parsed.messages)
      ) {
        return {
          domains: parsed.domains,
          inboxes: parsed.inboxes,
          messages: parsed.messages,
          webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
          deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
          apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
        };
      }
    }
  } catch (err) {
    console.warn('Could not load persisted state, initializing empty state:', err);
  }
  const initial = createInitialSeedState();
  savePersistedState(initial);
  return initial;
}

function savePersistedState(current: WorkspaceState = state): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(current, null, 2), 'utf8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    console.warn('Failed to persist state to disk:', err);
  }
}

const state: WorkspaceState = loadPersistedState();

function computeHmacSignature(secret: string, timestampSec: number, payload: string): string {
  const signedContent = `${timestampSec}.${payload}`;
  const digest = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
  return `t=${timestampSec},v1=${digest}`;
}

async function dispatchWebhooksForEvent(
  event: WebhookEventType,
  domainId: string,
  payloadObject: Record<string, unknown>
): Promise<WebhookDeliveryLog[]> {
  const matchingHooks = state.webhooks.filter(
    (wh) =>
      wh.active &&
      wh.events.includes(event) &&
      (wh.domainId === 'all' || wh.domainId === domainId)
  );

  const createdLogs: WebhookDeliveryLog[] = [];

  for (const wh of matchingHooks) {
    const startTime = Date.now();
    const deliveryId = `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const timestampSec = Math.floor(startTime / 1000);
    const bodyString = JSON.stringify(payloadObject, null, 2);
    const signature = computeHmacSignature(wh.secret, timestampSec, bodyString);

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MailRelay-Webhook-Dispatcher/1.0',
      'X-MailRelay-Event': event,
      'X-MailRelay-Delivery': deliveryId,
      'X-MailRelay-Signature': signature,
    };

    let statusCode = 502;
    let success = false;
    let responseBody = '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(wh.url, {
        method: 'POST',
        headers: requestHeaders,
        body: bodyString,
        signal: controller.signal,
      });
      statusCode = res.status;
      success = res.ok;
      const text = await res.text();
      responseBody = text.slice(0, 2000) || JSON.stringify({ status: res.statusText });
    } catch (netErr) {
      statusCode = 502;
      success = false;
      responseBody = JSON.stringify(
        {
          error: 'Webhook delivery failed',
          detail: netErr instanceof Error ? netErr.message : String(netErr),
        },
        null,
        2
      );
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const nowIso = new Date().toISOString();
    wh.lastTriggeredAt = nowIso;

    const logEntry: WebhookDeliveryLog = {
      id: deliveryId,
      webhookId: wh.id,
      webhookName: wh.name,
      event,
      targetUrl: wh.url,
      statusCode,
      success,
      durationMs,
      timestamp: nowIso,
      requestHeaders,
      requestPayload: bodyString,
      responseBody,
    };

    state.deliveries.unshift(logEntry);
    createdLogs.push(logEntry);
  }

  if (state.deliveries.length > 100) {
    state.deliveries.length = 100;
  }

  savePersistedState();
  return createdLogs;
}

function enrichDomains(domains: CustomDomain[], inboxes: TempInbox[], messages: MailMessage[]): CustomDomain[] {
  return domains.map((d) => {
    const domainInboxes = inboxes.filter((i) => i.domainId === d.id);
    const inboxIds = new Set(domainInboxes.map((i) => i.id));
    const domainMessages = messages.filter((m) => inboxIds.has(m.inboxId));
    return {
      ...d,
      inboxCount: domainInboxes.length,
      messageCount: domainMessages.length,
    };
  });
}

async function ingestNormalizedInbound(normalized: ReturnType<typeof normalizeInboundPayload>) {
  const parsedTo = parseEmailAddress(normalized.to);
  const { baseLocalPart } = stripSubaddressTag(parsedTo.localPart);

  let inbox = state.inboxes.find(
    (i) =>
      i.address.toLowerCase() === parsedTo.address ||
      (i.domainName.toLowerCase() === parsedTo.domain && i.localPart.toLowerCase() === baseLocalPart)
  );

  if (!inbox) {
    const domainRecord = state.domains.find((d) => d.domain.toLowerCase() === parsedTo.domain);
    if (!domainRecord) {
      return {
        errorStatus: 404,
        errorMessage: `Domain ${parsedTo.domain} is not connected to this workspace. Add ${parsedTo.domain} in the Domains tab first.`,
      };
    }

    if (domainRecord.catchAll) {
      const now = Date.now();
      inbox = {
        id: `inb-${now.toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        address: `${baseLocalPart}@${domainRecord.domain}`,
        localPart: baseLocalPart,
        domainId: domainRecord.id,
        domainName: domainRecord.domain,
        label:
          normalized.provider === 'cloudflare-worker'
            ? `Cloudflare Catch-All (${baseLocalPart})`
            : `Catch-All (${baseLocalPart})`,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 1440 * 60_000).toISOString(),
        ttlMinutes: 1440,
        autoExtractOtp: true,
      };
      state.inboxes.unshift(inbox);
    } else {
      return {
        errorStatus: 404,
        errorMessage: `No active temp inbox found for ${parsedTo.address} and catch-all routing is disabled on ${parsedTo.domain}.`,
      };
    }
  }

  const parsedFrom = parseEmailAddress(normalized.from);
  const msgId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const receivedAt = new Date().toISOString();
  const extracted = extractVerificationArtifacts(
    normalized.subject,
    normalized.textBody,
    normalized.htmlBody
  );

  const rawMime =
    normalized.rawMime ||
    buildRawMimeMessage({
      messageId: msgId,
      from: normalized.from,
      to: inbox.address,
      subject: normalized.subject,
      textBody: normalized.textBody,
      htmlBody: normalized.htmlBody,
      receivedAt,
      headers: normalized.headers,
    });

  const newMessage: MailMessage = {
    id: msgId,
    inboxId: inbox.id,
    to: inbox.address,
    from: normalized.from,
    fromName: parsedFrom.name,
    subject: normalized.subject,
    textBody: normalized.textBody,
    htmlBody: normalized.htmlBody,
    rawMime,
    headers: {
      From: normalized.from,
      To: inbox.address,
      Subject: normalized.subject,
      'Message-ID': `<${msgId}@${inbox.domainName}>`,
      ...normalized.headers,
    },
    receivedAt,
    sizeBytes: Buffer.byteLength(rawMime, 'utf8'),
    read: false,
    starred: false,
    extracted,
    spamScore: 0.0,
    dkimPass: true,
    spfPass: true,
  };

  state.messages.unshift(newMessage);
  savePersistedState();

  const webhookLogs: WebhookDeliveryLog[] = [];
  const msgLogs = await dispatchWebhooksForEvent('message.received', inbox.domainId, {
    id: `evt_${Date.now()}_msg`,
    event: 'message.received',
    provider: normalized.provider,
    createdAt: receivedAt,
    domain: inbox.domainName,
    inbox: {
      id: inbox.id,
      address: inbox.address,
    },
    message: {
      id: newMessage.id,
      from: newMessage.from,
      to: newMessage.to,
      subject: newMessage.subject,
      primaryOtp: newMessage.extracted.primaryOtp,
      otpCodes: newMessage.extracted.otpCodes,
      verificationLinks: newMessage.extracted.verificationLinks.map((l) => l.url),
      receivedAt: newMessage.receivedAt,
    },
  });
  webhookLogs.push(...msgLogs);

  if (extracted.primaryOtp || extracted.verificationLinks.length > 0) {
    const otpLogs = await dispatchWebhooksForEvent('otp.extracted', inbox.domainId, {
      id: `evt_${Date.now()}_otp`,
      event: 'otp.extracted',
      provider: normalized.provider,
      createdAt: receivedAt,
      domain: inbox.domainName,
      inbox: {
        id: inbox.id,
        address: inbox.address,
      },
      extracted: {
        messageId: newMessage.id,
        primaryOtp: extracted.primaryOtp,
        otpCodes: extracted.otpCodes,
        verificationLinks: extracted.verificationLinks,
      },
    });
    webhookLogs.push(...otpLogs);
  }

  return {
    inbox,
    message: newMessage,
    webhookLogs,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  app.use('/api/v1', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Relay-Key');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // --- API V1 ROUTES ---

  app.get('/api/v1/state', (_req, res) => {
    res.json({
      persistence: {
        engine: 'file-backed-json',
        path: '.data/mailrelay-state.json',
        persisted: true,
      },
      domains: enrichDomains(state.domains, state.inboxes, state.messages),
      inboxes: state.inboxes,
      messages: state.messages,
      webhooks: state.webhooks,
      deliveries: state.deliveries,
      apiKeys: state.apiKeys,
    });
  });

  app.get('/api/v1/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="mailrelay-workspace-backup.json"');
    res.json(state);
  });

  app.post('/api/v1/clear', (_req, res) => {
    const fresh = createInitialSeedState();
    state.domains = fresh.domains;
    state.inboxes = fresh.inboxes;
    state.messages = fresh.messages;
    state.webhooks = fresh.webhooks;
    state.deliveries = fresh.deliveries;
    state.apiKeys = fresh.apiKeys;
    savePersistedState();
    res.json({
      ok: true,
      domains: [],
      inboxes: [],
      messages: [],
      webhooks: [],
      deliveries: [],
      apiKeys: [],
    });
  });

  // --- DOMAINS ---
  app.get('/api/v1/domains', (_req, res) => {
    res.json({ domains: enrichDomains(state.domains, state.inboxes, state.messages) });
  });

  app.post('/api/v1/domains', (req, res) => {
    const rawDomain = String(req.body?.domain ?? '');
    const description = String(req.body?.description ?? '').trim() || 'Custom domain';
    const catchAll = Boolean(req.body?.catchAll ?? true);

    const normalized = normalizeDomainName(rawDomain);
    if (!isValidDomainName(normalized)) {
      res.status(400).json({ error: 'Please provide a valid domain name (e.g. mail.yourdomain.com).' });
      return;
    }

    if (state.domains.some((d) => d.domain === normalized)) {
      res.status(409).json({ error: `Domain ${normalized} is already connected.` });
      return;
    }

    const dkimSelector = `mr${Math.floor(1 + Math.random() * 9)}`;
    const verificationToken = `tok_${crypto.randomBytes(10).toString('hex')}`;
    const newDomain: CustomDomain = {
      id: `dom-${Date.now().toString(36)}`,
      domain: normalized,
      description,
      status: 'pending',
      catchAll,
      createdAt: new Date().toISOString(),
      dkimSelector,
      verificationToken,
      dnsRecords: buildDomainDnsSpec(normalized, dkimSelector, verificationToken, false),
    };

    state.domains.unshift(newDomain);
    savePersistedState();
    res.status(201).json({ domain: enrichDomains([newDomain], state.inboxes, state.messages)[0] });
  });

  app.post('/api/v1/domains/:id/verify', async (req, res) => {
    const dom = state.domains.find((d) => d.id === req.params.id);
    if (!dom) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }

    const mode = String(req.body?.mode ?? 'dns').trim();

    let mxVerified = false;
    let spfVerified = false;
    let mxHosts: string[] = [];

    try {
      const mxRecords = await dns.resolveMx(dom.domain);
      if (Array.isArray(mxRecords) && mxRecords.length > 0) {
        mxHosts = mxRecords.map((r) => r.exchange.toLowerCase());
        // Verified if domain has valid MX records (e.g. Cloudflare Email Routing *.mx.cloudflare.net or custom MX)
        mxVerified = true;
      }
    } catch {
      mxVerified = false;
    }

    try {
      const txtRecords = await dns.resolveTxt(dom.domain);
      const flatTxt = txtRecords.map((chunks) => chunks.join('')).join(' ');
      if (flatTxt.toLowerCase().includes('v=spf1')) {
        spfVerified = true;
      }
    } catch {
      spfVerified = false;
    }

    if (mode === 'cloudflare') {
      // Activate domain for HTTP inbound routing via Cloudflare Email Worker
      dom.dnsRecords = dom.dnsRecords.map((rec) => ({
        ...rec,
        verified: rec.type === 'MX' ? mxVerified || true : true,
      }));
    } else {
      dom.dnsRecords = dom.dnsRecords.map((rec) => {
        if (rec.type === 'MX') return { ...rec, verified: mxVerified };
        if (rec.purpose === 'SPF') return { ...rec, verified: spfVerified };
        return { ...rec, verified: mxVerified && spfVerified };
      });
    }

    dom.status = computeDomainStatus(dom.dnsRecords);
    if (dom.status === 'verified') {
      dom.verifiedAt = new Date().toISOString();
    }
    savePersistedState();

    res.json({
      domain: enrichDomains([dom], state.inboxes, state.messages)[0],
      dnsProbe: {
        mxVerified,
        spfVerified,
        mxHosts,
        checkedAt: new Date().toISOString(),
      },
    });
  });

  app.patch('/api/v1/domains/:id', (req, res) => {
    const dom = state.domains.find((d) => d.id === req.params.id);
    if (!dom) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }
    if (typeof req.body?.catchAll === 'boolean') {
      dom.catchAll = req.body.catchAll;
    }
    if (typeof req.body?.description === 'string') {
      dom.description = req.body.description.trim();
    }
    savePersistedState();
    res.json({ domain: enrichDomains([dom], state.inboxes, state.messages)[0] });
  });

  app.delete('/api/v1/domains/:id', (req, res) => {
    const idx = state.domains.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }
    const removed = state.domains[idx];
    state.domains.splice(idx, 1);
    const removedInboxIds = new Set(
      state.inboxes.filter((i) => i.domainId === removed.id).map((i) => i.id)
    );
    state.inboxes = state.inboxes.filter((i) => i.domainId !== removed.id);
    state.messages = state.messages.filter((m) => !removedInboxIds.has(m.inboxId));
    savePersistedState();
    res.json({ deletedId: removed.id });
  });

  // --- INBOXES ---
  app.get('/api/v1/inboxes', (req, res) => {
    const domainFilter = String(req.query.domainId ?? '').trim();
    const search = String(req.query.search ?? '').trim().toLowerCase();
    let list = [...state.inboxes];
    if (domainFilter && domainFilter !== 'all') {
      list = list.filter((i) => i.domainId === domainFilter || i.domainName === domainFilter);
    }
    if (search) {
      list = list.filter(
        (i) =>
          i.address.toLowerCase().includes(search) ||
          i.label.toLowerCase().includes(search)
      );
    }
    res.json({ inboxes: list });
  });

  app.post('/api/v1/inboxes', async (req, res) => {
    const requestedDomainId = String(req.body?.domainId ?? '').trim();
    const dom =
      state.domains.find((d) => d.id === requestedDomainId || d.domain === requestedDomainId) ??
      state.domains[0];

    if (!dom) {
      res.status(400).json({ error: 'Connect your domain in the Domains tab first before generating an inbox.' });
      return;
    }

    const rawPrefix = String(req.body?.prefix ?? '').trim().toLowerCase();
    const localPart = rawPrefix ? rawPrefix : generateRandomLocalPart('inbox');

    if (!isValidLocalPart(localPart)) {
      res.status(400).json({
        error: 'Invalid inbox username/local-part. Use alphanumeric characters, dots, hyphens, or plus tags.',
      });
      return;
    }

    const address = `${localPart}@${dom.domain}`;
    const existing = state.inboxes.find((i) => i.address.toLowerCase() === address.toLowerCase());
    if (existing) {
      res.status(409).json({ error: `Inbox ${address} already exists.`, inbox: existing });
      return;
    }

    const ttlMinutes = Math.min(10080, Math.max(5, Number(req.body?.ttlMinutes) || 60));
    const now = Date.now();
    const label = String(req.body?.label ?? '').trim() || `Inbox (${localPart})`;

    const newInbox: TempInbox = {
      id: `inb-${now.toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      address,
      localPart,
      domainId: dom.id,
      domainName: dom.domain,
      label,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMinutes * 60_000).toISOString(),
      ttlMinutes,
      autoExtractOtp: req.body?.autoExtractOtp !== false,
    };

    state.inboxes.unshift(newInbox);
    savePersistedState();

    await dispatchWebhooksForEvent('inbox.created', dom.id, {
      id: `evt_${Date.now()}`,
      event: 'inbox.created',
      createdAt: newInbox.createdAt,
      domain: dom.domain,
      inbox: {
        id: newInbox.id,
        address: newInbox.address,
        label: newInbox.label,
        expiresAt: newInbox.expiresAt,
      },
    });

    res.status(201).json({ inbox: newInbox });
  });

  app.delete('/api/v1/inboxes/:id', async (req, res) => {
    const idx = state.inboxes.findIndex((i) => i.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Inbox not found' });
      return;
    }
    const removed = state.inboxes[idx];
    state.inboxes.splice(idx, 1);
    state.messages = state.messages.filter((m) => m.inboxId !== removed.id);
    savePersistedState();

    await dispatchWebhooksForEvent('inbox.expired', removed.domainId, {
      id: `evt_${Date.now()}`,
      event: 'inbox.expired',
      createdAt: new Date().toISOString(),
      domain: removed.domainName,
      inbox: { id: removed.id, address: removed.address },
    });

    res.json({ deletedId: removed.id });
  });

  // --- MESSAGES ---
  app.get('/api/v1/inboxes/:id/messages', (req, res) => {
    const inbox = state.inboxes.find((i) => i.id === req.params.id || i.address === req.params.id);
    if (!inbox) {
      res.status(404).json({ error: 'Inbox not found' });
      return;
    }
    const list = state.messages.filter((m) => m.inboxId === inbox.id);
    res.json({
      inbox: inbox.address,
      count: list.length,
      messages: list,
    });
  });

  app.get('/api/v1/messages', (req, res) => {
    const inboxId = String(req.query.inboxId ?? '').trim();
    const search = String(req.query.search ?? '').trim().toLowerCase();
    let list = [...state.messages];
    if (inboxId && inboxId !== 'all') {
      list = list.filter((m) => m.inboxId === inboxId || m.to.toLowerCase() === inboxId.toLowerCase());
    }
    if (search) {
      list = list.filter(
        (m) =>
          m.subject.toLowerCase().includes(search) ||
          m.from.toLowerCase().includes(search) ||
          m.to.toLowerCase().includes(search) ||
          m.textBody.toLowerCase().includes(search) ||
          (m.extracted.primaryOtp && m.extracted.primaryOtp.toLowerCase().includes(search))
      );
    }
    res.json({ count: list.length, messages: list });
  });

  app.get('/api/v1/messages/:id', (req, res) => {
    const msg = state.messages.find((m) => m.id === req.params.id);
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    res.json({ message: msg });
  });

  app.get('/api/v1/messages/:id/eml', (req, res) => {
    const msg = state.messages.find((m) => m.id === req.params.id);
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const safeFilename = `${msg.id}.eml`;
    res.setHeader('Content-Type', 'message/rfc822; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(msg.rawMime);
  });

  app.patch('/api/v1/messages/:id', (req, res) => {
    const msg = state.messages.find((m) => m.id === req.params.id);
    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (typeof req.body?.read === 'boolean') msg.read = req.body.read;
    if (typeof req.body?.starred === 'boolean') msg.starred = req.body.starred;
    savePersistedState();
    res.json({ message: msg });
  });

  app.delete('/api/v1/messages/:id', (req, res) => {
    const idx = state.messages.findIndex((m) => m.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const [removed] = state.messages.splice(idx, 1);
    savePersistedState();
    res.json({ deletedId: removed.id });
  });

  // --- UNIVERSAL INBOUND EMAIL & WEBHOOK INGESTION ---
  // Ingests real incoming emails from Cloudflare Email Workers, Postmark, SendGrid, Mailgun, or REST API
  app.post('/api/v1/inbound', async (req, res) => {
    const normalized = normalizeInboundPayload(req.body ?? {});

    if (!normalized.to || !normalized.to.includes('@')) {
      res.status(400).json({
        error: 'Recipient "to" email address is required (e.g. user@your-domain.com).',
      });
      return;
    }

    const result = await ingestNormalizedInbound(normalized);
    if ('errorStatus' in result) {
      res.status(result.errorStatus ?? 400).json({ error: result.errorMessage });
      return;
    }

    res.status(201).json({
      accepted: true,
      provider: normalized.provider,
      inbox: result.inbox,
      message: result.message,
      webhooksTriggered: result.webhookLogs.length,
      deliveries: result.webhookLogs,
    });
  });

  // --- WEBHOOKS ---
  app.get('/api/v1/webhooks', (_req, res) => {
    res.json({ webhooks: state.webhooks, deliveries: state.deliveries });
  });

  app.post('/api/v1/webhooks', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const url = String(req.body?.url ?? '').trim();
    const domainId = String(req.body?.domainId ?? 'all').trim();
    const events = Array.isArray(req.body?.events) && req.body.events.length > 0
      ? (req.body.events as WebhookEventType[])
      : (['message.received', 'otp.extracted'] as WebhookEventType[]);

    if (!name) {
      res.status(400).json({ error: 'Webhook endpoint name is required.' });
      return;
    }
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      res.status(400).json({
        error: 'Webhook URL must be a valid http:// or https:// endpoint.',
      });
      return;
    }

    const secret = String(req.body?.secret ?? '').trim() || `whsec_${crypto.randomBytes(16).toString('hex')}`;
    const newWh: WebhookEndpoint = {
      id: `wh-${Date.now().toString(36)}`,
      name,
      url,
      secret,
      events,
      domainId,
      active: true,
      createdAt: new Date().toISOString(),
    };

    state.webhooks.unshift(newWh);
    savePersistedState();
    res.status(201).json({ webhook: newWh });
  });

  app.patch('/api/v1/webhooks/:id', (req, res) => {
    const wh = state.webhooks.find((w) => w.id === req.params.id);
    if (!wh) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    if (typeof req.body?.active === 'boolean') wh.active = req.body.active;
    savePersistedState();
    res.json({ webhook: wh });
  });

  app.delete('/api/v1/webhooks/:id', (req, res) => {
    const idx = state.webhooks.findIndex((w) => w.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    const [removed] = state.webhooks.splice(idx, 1);
    savePersistedState();
    res.json({ deletedId: removed.id });
  });

  // --- API KEYS ---
  app.post('/api/v1/api-keys', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'API key name is required.' });
      return;
    }
    const scopes = Array.isArray(req.body?.scopes) && req.body.scopes.length > 0
      ? (req.body.scopes as string[])
      : ['inboxes:write', 'messages:read', 'webhooks:manage'];

    const hex = crypto.randomBytes(16).toString('hex');
    const prefix = `mr_live_${hex.slice(0, 4)}`;
    const token = `${prefix}_${hex.slice(4)}`;
    const newKey: ApiKeyRecord = {
      id: `key-${Date.now().toString(36)}`,
      name,
      prefix,
      token,
      scopes,
      createdAt: new Date().toISOString(),
      lastUsedAt: 'Never',
    };
    state.apiKeys.unshift(newKey);
    savePersistedState();
    res.status(201).json({ apiKey: newKey });
  });

  app.delete('/api/v1/api-keys/:id', (req, res) => {
    const idx = state.apiKeys.findIndex((k) => k.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }
    const [removed] = state.apiKeys.splice(idx, 1);
    savePersistedState();
    res.json({ deletedId: removed.id });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MailRelay server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
