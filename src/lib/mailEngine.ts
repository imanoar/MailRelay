export interface DnsRecordSpec {
  id: string;
  type: 'MX' | 'TXT' | 'CNAME';
  host: string;
  value: string;
  priority?: number;
  purpose: 'Inbound Routing' | 'SPF' | 'DKIM' | 'Return-Path';
  verified: boolean;
}

export interface CustomDomain {
  id: string;
  domain: string;
  description: string;
  status: 'verified' | 'pending' | 'partial';
  catchAll: boolean;
  createdAt: string;
  verifiedAt?: string;
  dkimSelector: string;
  verificationToken: string;
  dnsRecords: DnsRecordSpec[];
  inboxCount?: number;
  messageCount?: number;
}

export interface TempInbox {
  id: string;
  address: string;
  localPart: string;
  domainId: string;
  domainName: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  ttlMinutes: number;
  autoExtractOtp: boolean;
  forwardWebhookId?: string;
}

export interface ExtractedArtifacts {
  otpCodes: string[];
  primaryOtp: string | null;
  verificationLinks: Array<{
    url: string;
    label: string;
  }>;
}

export interface MailMessage {
  id: string;
  inboxId: string;
  to: string;
  from: string;
  fromName: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  rawMime: string;
  headers: Record<string, string>;
  receivedAt: string;
  sizeBytes: number;
  read: boolean;
  starred: boolean;
  extracted: ExtractedArtifacts;
  spamScore: number;
  dkimPass: boolean;
  spfPass: boolean;
}

export type WebhookEventType =
  | 'message.received'
  | 'otp.extracted'
  | 'inbox.created'
  | 'inbox.expired';

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  domainId: string | 'all';
  active: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
}

export interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  webhookName: string;
  event: WebhookEventType;
  targetUrl: string;
  statusCode: number;
  success: boolean;
  durationMs: number;
  timestamp: string;
  requestHeaders: Record<string, string>;
  requestPayload: string;
  responseBody: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  token: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string;
}

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const LOCAL_PART_REGEX = /^[a-z0-9][a-z0-9._+-]{0,62}$/i;

export function normalizeDomainName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
}

export function isValidDomainName(input: string): boolean {
  const normalized = normalizeDomainName(input);
  if (!normalized || normalized.length > 253) return false;
  return DOMAIN_REGEX.test(normalized);
}

export function isValidLocalPart(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (trimmed.includes('..')) return false;
  return LOCAL_PART_REGEX.test(trimmed);
}

export function generateRandomLocalPart(prefix = 'qa'): string {
  const sanitizedPrefix = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 16) || 'qa';
  const adjectives = ['swift', 'delta', 'cobalt', 'auth', 'canary', 'build', 'stage', 'flow'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return `${sanitizedPrefix}-${adj}-${randomDigits}`;
}

export function buildDomainDnsSpec(
  domain: string,
  dkimSelector: string,
  verificationToken: string,
  verified = false
): DnsRecordSpec[] {
  const normalized = normalizeDomainName(domain);
  return [
    {
      id: `dns-mx-${normalized}`,
      type: 'MX',
      host: '@',
      value: 'mx1.mailrelay-sandbox.dev',
      priority: 10,
      purpose: 'Inbound Routing',
      verified,
    },
    {
      id: `dns-spf-${normalized}`,
      type: 'TXT',
      host: '@',
      value: `v=spf1 include:spf.mailrelay-sandbox.dev ~all`,
      purpose: 'SPF',
      verified,
    },
    {
      id: `dns-dkim-${normalized}`,
      type: 'TXT',
      host: `${dkimSelector}._domainkey`,
      value: `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC${verificationToken.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}IDAQAB`,
      purpose: 'DKIM',
      verified,
    },
    {
      id: `dns-rp-${normalized}`,
      type: 'CNAME',
      host: 'bounces',
      value: 'return.mailrelay-sandbox.dev',
      purpose: 'Return-Path',
      verified,
    },
  ];
}

export function computeDomainStatus(records: DnsRecordSpec[]): 'verified' | 'pending' | 'partial' {
  if (!records.length) return 'pending';
  const verifiedCount = records.filter((r) => r.verified).length;
  if (verifiedCount === records.length) return 'verified';
  if (verifiedCount > 0) return 'partial';
  return 'pending';
}

/**
 * Automatically scans incoming message bodies (plain text, HTML, and subject)
 * for 4-8 digit OTP codes while filtering out dates, years, URLs, and CSS units.
 */
export function scanMessageForOtpTokens(
  textBody: string,
  htmlBody = '',
  subject = ''
): string[] {
  const strippedHtml = htmlBody
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');

  // Remove URLs, ISO dates, slash dates, and clock timestamps so they don't produce false positives
  const proseWithoutNoise = `${subject}\n${textBody}\n${strippedHtml}`
    .replace(/https?:\/\/[^\s"'<>)\]]+/gi, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');

  const otpCandidates = new Set<string>();

  // 1. Contextual 4-8 digit OTP pattern near keywords like code, otp, pin, verification, token, passcode
  const contextualRegex =
    /(?:code|otp|pin|passcode|verification|verify|token|security\s+code|one-time|2fa|mfa)(?:\s+is|\s*:)?[^0-9A-Za-z]{1,25}?\b([0-9]{4,8}|[A-Z0-9]{3}-[A-Z0-9]{3})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = contextualRegex.exec(proseWithoutNoise)) !== null) {
    const candidate = match[1].toUpperCase();
    if (!isLikelyYearOrNoise(candidate)) {
      otpCandidates.add(candidate);
    }
  }

  // 2. Standalone 4-8 digit OTP codes or hyphenated 3-3 codes in message body/subject
  const standaloneOtpRegex = /\b([0-9]{4,8}|[A-Z0-9]{3}-[A-Z0-9]{3})\b(?!\s*(?:px|ms|kb|mb|gb|bytes|am|pm)\b)/gi;
  while ((match = standaloneOtpRegex.exec(proseWithoutNoise)) !== null) {
    const candidate = match[1].toUpperCase();
    if (!isLikelyYearOrNoise(candidate)) {
      otpCandidates.add(candidate);
    }
  }

  return Array.from(otpCandidates);
}

export function extractVerificationArtifacts(
  subject: string,
  textBody: string,
  htmlBody: string
): ExtractedArtifacts {
  const otpCodes = scanMessageForOtpTokens(textBody, htmlBody, subject);
  let match: RegExpExecArray | null;

  // Extract verification / magic links from HTML hrefs and plain text URLs
  const linkMap = new Map<string, string>();

  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = anchorRegex.exec(htmlBody)) !== null) {
    const url = match[1].trim();
    const rawLabel = match[2].replace(/<[^>]+>/g, '').trim() || 'Verification Link';
    if (isActionableUrl(url)) {
      linkMap.set(url, rawLabel);
    }
  }

  const plainUrlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;
  while ((match = plainUrlRegex.exec(textBody)) !== null) {
    const url = match[0].replace(/[.,;!?]+$/, '');
    if (isActionableUrl(url) && !linkMap.has(url)) {
      linkMap.set(url, inferLinkLabel(url));
    }
  }

  const verificationLinks = Array.from(linkMap.entries()).map(([url, label]) => ({
    url,
    label,
  }));

  return {
    otpCodes,
    primaryOtp: otpCodes[0] ?? null,
    verificationLinks,
  };
}

function isLikelyYearOrNoise(token: string): boolean {
  if (/^(19|20)\d{2}$/.test(token)) return true;
  if (/^0+$/.test(token)) return true;
  return false;
}

function isActionableUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(png|jpg|jpeg|gif|svg|css|woff2?)$/i.test(url)) return false;
  if (/unsubscribe|privacy|terms|preferences/i.test(url)) return false;
  return true;
}

function inferLinkLabel(url: string): string {
  if (/verify|confirm|activate/i.test(url)) return 'Verify Email Address';
  if (/reset|password|recover/i.test(url)) return 'Reset Password';
  if (/magic|login|auth|signin/i.test(url)) return 'Sign In with Magic Link';
  if (/invite|accept|join/i.test(url)) return 'Accept Invitation';
  return 'Action Link';
}

export function parseEmailAddress(raw: string): { name: string; address: string; localPart: string; domain: string } {
  const trimmed = raw.trim();
  const angleMatch = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  const address = (angleMatch ? angleMatch[2] : trimmed).trim().toLowerCase();
  const rawName = angleMatch && angleMatch[1] ? angleMatch[1].trim() : '';
  const atIndex = address.lastIndexOf('@');
  const localPart = atIndex > 0 ? address.slice(0, atIndex) : address;
  const domain = atIndex > 0 ? address.slice(atIndex + 1) : '';
  const fallbackName = localPart
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    name: rawName || fallbackName || 'Sender',
    address,
    localPart,
    domain,
  };
}

export function stripSubaddressTag(localPart: string): { baseLocalPart: string; tag: string | null } {
  const plusIndex = localPart.indexOf('+');
  if (plusIndex === -1) {
    return { baseLocalPart: localPart.toLowerCase(), tag: null };
  }
  return {
    baseLocalPart: localPart.slice(0, plusIndex).toLowerCase(),
    tag: localPart.slice(plusIndex + 1) || null,
  };
}

export function buildRawMimeMessage(params: {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  receivedAt: string;
  headers?: Record<string, string>;
}): string {
  const boundary = `----=_Part_${params.messageId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
  const dateHeader = new Date(params.receivedAt).toUTCString();
  const extraHeaders = Object.entries(params.headers ?? {})
    .filter(([k]) => !['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type'].includes(k.toLowerCase()))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');

  return [
    `Return-Path: <${parseEmailAddress(params.from).address}>`,
    `Received: from mx1.mailrelay-sandbox.dev (mx1.mailrelay-sandbox.dev [10.24.0.12])`,
    `\tby inbound.mailrelay-sandbox.dev with ESMTPS id ${params.messageId}`,
    `\tfor <${params.to}>; ${dateHeader}`,
    `Authentication-Results: mx.mailrelay-sandbox.dev; dkim=pass header.i=@${parseEmailAddress(params.from).domain}; spf=pass`,
    `Date: ${dateHeader}`,
    `From: ${params.from}`,
    `To: <${params.to}>`,
    `Message-ID: <${params.messageId}@mailrelay-sandbox.dev>`,
    `Subject: ${params.subject}`,
    ...(extraHeaders ? [extraHeaders] : []),
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    params.textBody,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    params.htmlBody,
    ``,
    `--${boundary}--`,
  ].join('\r\n');
}

export function formatRemainingTtl(expiresAtIso: string, nowMs = Date.now()): {
  expired: boolean;
  label: string;
  secondsRemaining: number;
} {
  const expiresMs = new Date(expiresAtIso).getTime();
  const diffSeconds = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  if (diffSeconds <= 0) {
    return { expired: true, label: 'Expired', secondsRemaining: 0 };
  }
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;
  if (hours > 0) {
    return {
      expired: false,
      label: `${hours}h ${String(minutes).padStart(2, '0')}m`,
      secondsRemaining: diffSeconds,
    };
  }
  return {
    expired: false,
    label: `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`,
    secondsRemaining: diffSeconds,
  };
}

export function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export interface ParsedMimeResult {
  headers: Record<string, string>;
  subject: string;
  from: string;
  to: string;
  textBody: string;
  htmlBody: string;
}

export function parseRawMimeEmail(rawMime: string): ParsedMimeResult {
  const normalized = rawMime.replace(/\r\n/g, '\n');
  const splitIndex = normalized.indexOf('\n\n');
  const rawHeaderBlock = splitIndex !== -1 ? normalized.slice(0, splitIndex) : '';
  const rawBodyBlock = splitIndex !== -1 ? normalized.slice(splitIndex + 2) : normalized;

  // Unfold multiline headers
  const unfoldedHeaders = rawHeaderBlock.replace(/\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfoldedHeaders.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      headers[key] = val;
    }
  }

  const getHeader = (name: string): string => {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v;
    }
    return '';
  };

  const contentType = getHeader('content-type');
  const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);

  let textBody = '';
  let htmlBody = '';

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = rawBodyBlock.split(`--${boundary}`);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '--') continue;
      const partSplit = part.indexOf('\n\n');
      if (partSplit === -1) continue;
      const partHeaders = part.slice(0, partSplit).toLowerCase();
      let partContent = part.slice(partSplit + 2).replace(/\n--$/, '').trim();

      if (partHeaders.includes('quoted-printable')) {
        partContent = decodeQuotedPrintable(partContent);
      }

      if (partHeaders.includes('text/html')) {
        htmlBody = partContent;
      } else if (partHeaders.includes('text/plain')) {
        textBody = partContent;
      }
    }
  } else {
    const isQp = getHeader('content-transfer-encoding').toLowerCase().includes('quoted-printable');
    const decoded = isQp ? decodeQuotedPrintable(rawBodyBlock.trim()) : rawBodyBlock.trim();
    if (contentType.toLowerCase().includes('text/html')) {
      htmlBody = decoded;
      textBody = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      textBody = decoded;
    }
  }

  if (!textBody && htmlBody) {
    textBody = htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return {
    headers,
    subject: getHeader('subject'),
    from: getHeader('from'),
    to: getHeader('to'),
    textBody,
    htmlBody,
  };
}

export function normalizeInboundPayload(body: Record<string, unknown>): {
  to: string;
  from: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  rawMime?: string;
  headers: Record<string, string>;
  provider: 'cloudflare-worker' | 'postmark' | 'sendgrid-mailgun' | 'direct-api';
} {
  const rawMimeInput = String(body.rawMime ?? body.email ?? '').trim();
  const parsedMime = rawMimeInput ? parseRawMimeEmail(rawMimeInput) : null;

  // Detect provider signature
  let provider: 'cloudflare-worker' | 'postmark' | 'sendgrid-mailgun' | 'direct-api' = 'direct-api';
  if (body.provider === 'cloudflare-worker' || body.rawMime) {
    provider = 'cloudflare-worker';
  } else if (body.TextBody !== undefined || body.HtmlBody !== undefined || body.FromFull !== undefined) {
    provider = 'postmark';
  } else if (body['body-plain'] !== undefined || body['body-html'] !== undefined || body.recipient !== undefined) {
    provider = 'sendgrid-mailgun';
  }

  const to = String(
    body.to ?? body.To ?? body.recipient ?? parsedMime?.to ?? ''
  ).trim();

  const from = String(
    body.from ?? body.From ?? body.sender ?? parsedMime?.from ?? '"External Sender" <no-reply@external.dev>'
  ).trim();

  const subject = String(
    body.subject ?? body.Subject ?? parsedMime?.subject ?? '(No subject)'
  ).trim();

  let textBody = String(
    body.text ?? body.textBody ?? body.TextBody ?? body['body-plain'] ?? parsedMime?.textBody ?? ''
  ).trim();

  let htmlBody = String(
    body.html ?? body.htmlBody ?? body.HtmlBody ?? body['body-html'] ?? parsedMime?.htmlBody ?? ''
  ).trim();

  // If caller passed raw MIME inside `text` (common in simple Cloudflare Worker scripts), parse it automatically
  if (!htmlBody && textBody.includes('MIME-Version:') && textBody.includes('Content-Type:')) {
    const autoParsed = parseRawMimeEmail(textBody);
    if (autoParsed.textBody || autoParsed.htmlBody) {
      textBody = autoParsed.textBody || textBody;
      htmlBody = autoParsed.htmlBody;
    }
  }

  if (!htmlBody && textBody) {
    htmlBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; color: #0f172a; line-height: 1.6;">${textBody.replace(/\n/g, '<br/>')}</div>`;
  }

  const customHeaders: Record<string, string> = {
    ...(parsedMime?.headers ?? {}),
    ...(body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)
      ? (body.headers as Record<string, string>)
      : {}),
    'X-Ingestion-Provider': provider,
  };

  return {
    to,
    from,
    subject,
    textBody,
    htmlBody,
    rawMime: rawMimeInput || undefined,
    headers: customHeaders,
    provider,
  };
}

export function sanitizeAndWrapEmailHtml(rawHtml: string): string {
  const cleaned = rawHtml
    // Remove executable script, iframe, object, embed, and form tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    // Strip inline event handlers (onclick, onerror, onload, etc.)
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Neutralize javascript: and data:text/html URIs in href/src
    .replace(/(href|src)\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*["']?\s*data:text\/html[^"'\s>]*/gi, '$1="#"');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base target="_blank" rel="noopener noreferrer" />
    <style>
      html, body {
        margin: 0;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #0f172a;
        background-color: #ffffff;
        word-wrap: break-word;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        color: #2563eb;
      }
      pre, code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
    </style>
  </head>
  <body>${cleaned}</body>
</html>`;
}

export function buildEmlFilename(subject: string, messageId: string): string {
  const slug = subject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const safeId = messageId.replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'message';
  return `${slug || 'email'}-${safeId}.eml`;
}


