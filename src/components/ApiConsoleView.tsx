import React, { useState } from 'react';
import {
  Terminal,
  Play,
  Copy,
  Check,
  KeyRound,
  Plus,
  Trash2,
  Code2,
} from 'lucide-react';
import {
  CustomDomain,
  TempInbox,
  ApiKeyRecord,
} from '../lib/mailEngine';

interface ApiConsoleViewProps {
  domains: CustomDomain[];
  inboxes: TempInbox[];
  apiKeys: ApiKeyRecord[];
  onCreateApiKey: (name: string) => Promise<void>;
  onDeleteApiKey: (id: string) => Promise<void>;
  onRefreshState: () => Promise<void>;
}

interface ApiEndpointPreset {
  id: string;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  defaultBody?: string;
}

export function ApiConsoleView({
  domains,
  inboxes,
  apiKeys,
  onCreateApiKey,
  onDeleteApiKey,
  onRefreshState,
}: ApiConsoleViewProps) {
  const defaultDomain = domains[0]?.domain ?? 'yourdomain.com';

  const endpointPresets: ApiEndpointPreset[] = [
    {
      id: 'ep-list-messages',
      label: 'GET /api/v1/messages (List Messages & OTPs)',
      method: 'GET',
      path: '/api/v1/messages',
    },
    {
      id: 'ep-list-inboxes',
      label: 'GET /api/v1/inboxes (List Active Inboxes)',
      method: 'GET',
      path: '/api/v1/inboxes',
    },
    {
      id: 'ep-list-domains',
      label: 'GET /api/v1/domains (List Connected Domains)',
      method: 'GET',
      path: '/api/v1/domains',
    },
    {
      id: 'ep-create-inbox',
      label: 'POST /api/v1/inboxes (Generate Temp Inbox)',
      method: 'POST',
      path: '/api/v1/inboxes',
      defaultBody: JSON.stringify(
        {
          prefix: 'auth-test',
          domainId: domains[0]?.id ?? defaultDomain,
          ttlMinutes: 60,
          label: 'API Inbox',
        },
        null,
        2
      ),
    },
  ];

  const [selectedPresetId, setSelectedPresetId] = useState(endpointPresets[0].id);
  const [method, setMethod] = useState<'GET' | 'POST'>(endpointPresets[0].method);
  const [pathInput, setPathInput] = useState(endpointPresets[0].path);
  const [bodyInput, setBodyInput] = useState(endpointPresets[0].defaultBody ?? '');
  const [runningRequest, setRunningRequest] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(200);
  const [responseLatencyMs, setResponseLatencyMs] = useState<number | null>(10);
  const [responseJson, setResponseJson] = useState<string>(() =>
    JSON.stringify(
      {
        ready: true,
        endpoint: '/api/v1/messages',
        connectedDomains: domains.length,
        activeInboxes: inboxes.length,
      },
      null,
      2
    )
  );

  const [sdkTab, setSdkTab] = useState<'playwright' | 'curl' | 'webhook'>('playwright');
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1500);
  };

  const handleSelectEndpoint = (preset: ApiEndpointPreset) => {
    setSelectedPresetId(preset.id);
    setMethod(preset.method);
    setPathInput(preset.path);
    setBodyInput(preset.defaultBody ?? '');
  };

  const handleExecuteRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunningRequest(true);
    const start = performance.now();
    try {
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKeys[0]?.token ? { Authorization: `Bearer ${apiKeys[0].token}` } : {}),
        },
      };
      if (method === 'POST' && bodyInput.trim()) {
        init.body = bodyInput;
      }
      const res = await fetch(pathInput, init);
      const elapsed = Math.round(performance.now() - start);
      setResponseStatus(res.status);
      setResponseLatencyMs(elapsed);
      const data = await res.json();
      setResponseJson(JSON.stringify(data, null, 2));
      if (method === 'POST') {
        await onRefreshState();
      }
    } catch (err) {
      setResponseStatus(500);
      setResponseJson(
        JSON.stringify(
          { error: err instanceof Error ? err.message : 'Request failed' },
          null,
          2
        )
      );
    } finally {
      setRunningRequest(false);
    }
  };

  const handleAddKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    await onCreateApiKey(newKeyName.trim());
    setNewKeyName('');
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const activeToken = apiKeys[0]?.token ?? '<YOUR_API_KEY>';

  const playwrightSnippet = `import { test, expect } from '@playwright/test';

const MAILRELAY_API = '${baseUrl}/api/v1';
const API_KEY = '${activeToken}';

test('sign-up verification flow using custom domain temp mail', async ({ page, request }) => {
  // 1. Provision an isolated temp mail inbox on your connected domain
  const createRes = await request.post(\`\${MAILRELAY_API}/inboxes\`, {
    headers: { Authorization: \`Bearer \${API_KEY}\` },
    data: { domainId: '${defaultDomain}', ttlMinutes: 30, label: 'Playwright Run' }
  });
  const { inbox } = await createRes.json();

  // 2. Submit your application's registration form with the generated email
  await page.goto('https://${defaultDomain}/signup');
  await page.getByLabel('Email').fill(inbox.address);
  await page.getByRole('button', { name: 'Continue' }).click();

  // 3. Query MailRelay API for the incoming message and extracted OTP
  const msgRes = await request.get(\`\${MAILRELAY_API}/inboxes/\${inbox.id}/messages\`, {
    headers: { Authorization: \`Bearer \${API_KEY}\` }
  });
  const { messages } = await msgRes.json();
  const otpCode = messages[0].extracted.primaryOtp;
  expect(otpCode).toBeTruthy();

  // 4. Complete verification in your app
  await page.getByLabel('Verification Code').fill(otpCode);
  await page.getByRole('button', { name: 'Verify' }).click();
});`;

  const curlSnippet = `# 1. Generate a disposable inbox on your domain (${defaultDomain})
curl -X POST "${baseUrl}/api/v1/inboxes" \\
  -H "Authorization: Bearer ${activeToken}" \\
  -H "Content-Type: application/json" \\
  -d '{"prefix": "test-user", "domainId": "${defaultDomain}", "ttlMinutes": 60}'

# 2. Poll messages for an inbox and read extracted.primaryOtp
curl -s "${baseUrl}/api/v1/messages?inboxId=test-user@${defaultDomain}" \\
  -H "Authorization: Bearer ${activeToken}"`;

  const webhookSnippet = `import crypto from 'node:crypto';
import express from 'express';

const app = express();
app.use(express.json());

// Verify X-MailRelay-Signature (t=<timestamp>,v1=<hmac_sha256>)
app.post('/webhooks/mailrelay', (req, res) => {
  const sigHeader = String(req.headers['x-mailrelay-signature'] || '');
  const [tPart, v1Part] = sigHeader.split(',');
  const timestamp = tPart?.replace('t=', '');
  const receivedHmac = v1Part?.replace('v1=', '');

  const rawBody = JSON.stringify(req.body, null, 2);
  const expectedHmac = crypto
    .createHmac('sha256', process.env.MAILRELAY_WEBHOOK_SECRET!)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');

  if (receivedHmac !== expectedHmac) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const { event, inbox, message, extracted } = req.body;
  console.log(\`[\${event}] Inbox: \${inbox.address} | OTP: \${extracted?.primaryOtp}\`);
  res.status(200).json({ received: true });
});`;

  return (
    <div className="space-y-6">
      {/* Live REST API Playground */}
      <section
        aria-label="Interactive REST API Playground"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              REST API Explorer & SDK Reference
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Query your live inboxes and messages via REST API and integrate with your automated test runners.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-600">
            <span>Base URL: {baseUrl}/api/v1</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Request Builder (6 cols) */}
          <form onSubmit={handleExecuteRequest} className="lg:col-span-6 p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Select Endpoint
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {endpointPresets.map((ep) => (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => handleSelectEndpoint(ep)}
                    className={`p-2.5 text-left rounded-lg border text-xs transition-colors cursor-pointer ${
                      selectedPresetId === ep.id
                        ? 'border-blue-600 bg-blue-50/70 text-blue-950 font-semibold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="font-mono truncate">{ep.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="HTTP Method"
                value={method}
                onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
                className="px-3 py-2 text-xs font-mono font-bold bg-slate-100 border border-slate-200 rounded-lg text-slate-900"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
              <input
                type="text"
                aria-label="API Endpoint Path"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
              <button
                type="submit"
                disabled={runningRequest}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{runningRequest ? 'Running...' : 'Send API Request'}</span>
              </button>
            </div>

            {method === 'POST' && (
              <div>
                <label htmlFor="api-req-body" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Request JSON Payload
                </label>
                <textarea
                  id="api-req-body"
                  rows={6}
                  value={bodyInput}
                  onChange={(e) => setBodyInput(e.target.value)}
                  className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>
            )}
          </form>

          {/* Live Response Output (6 cols) */}
          <div className="lg:col-span-6 p-5 bg-slate-950 text-slate-100 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <Terminal className="w-4 h-4 text-blue-400" />
                  <span>Live Server Response</span>
                </div>
                {responseStatus !== null && (
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                    <span
                      data-testid="api-response-status"
                      className={
                        responseStatus >= 200 && responseStatus < 300
                          ? 'text-emerald-400 font-semibold'
                          : 'text-red-400 font-semibold'
                      }
                    >
                      HTTP {responseStatus}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-400">{responseLatencyMs}ms</span>
                  </div>
                )}
              </div>

              <pre
                data-testid="api-response-json"
                className="text-xs font-mono text-slate-200 overflow-x-auto max-h-[280px] leading-relaxed"
              >
                {responseJson}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Code Integration Examples & API Keys */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* SDK Code Snippets (7 cols) */}
        <section
          aria-label="Integration Code Examples"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Project Integration Examples
              </h2>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSdkTab('playwright')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sdkTab === 'playwright'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Playwright E2E
              </button>
              <button
                type="button"
                onClick={() => setSdkTab('curl')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sdkTab === 'curl'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                cURL CLI
              </button>
              <button
                type="button"
                onClick={() => setSdkTab('webhook')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sdkTab === 'webhook'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Webhook Consumer
              </button>
            </div>
          </div>

          <div className="p-5 bg-slate-900 text-slate-100 relative">
            <button
              type="button"
              onClick={() =>
                copyText(
                  sdkTab === 'playwright'
                    ? playwrightSnippet
                    : sdkTab === 'curl'
                    ? curlSnippet
                    : webhookSnippet,
                  `sdk-${sdkTab}`
                )
              }
              className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md cursor-pointer"
            >
              {copiedKey === `sdk-${sdkTab}` ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Snippet</span>
                </>
              )}
            </button>

            <pre className="text-xs font-mono leading-relaxed overflow-x-auto pt-2">
              {sdkTab === 'playwright'
                ? playwrightSnippet
                : sdkTab === 'curl'
                ? curlSnippet
                : webhookSnippet}
            </pre>
          </div>
        </section>

        {/* API Keys Manager (5 cols) */}
        <section
          aria-label="API Keys Management"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Scoped API Keys</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Generate Bearer tokens for your Cloudflare Worker and automated test suites.
            </p>

            <form onSubmit={handleAddKeySubmit} className="flex items-center gap-2 mt-3">
              <input
                type="text"
                aria-label="New API Key Name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Cloudflare Worker Key"
                className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Key</span>
              </button>
            </form>
          </div>

          <div className="divide-y divide-slate-100">
            {apiKeys.map((key) => (
              <div key={key.id} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 truncate">{key.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-600">
                    <span className="truncate">{key.token.slice(0, 20)}...</span>
                    <button
                      type="button"
                      onClick={() => copyText(key.token, `key-${key.id}`)}
                      className="text-blue-600 hover:underline font-sans text-[11px] shrink-0 cursor-pointer"
                    >
                      {copiedKey === `key-${key.id}` ? 'Copied!' : 'Copy Token'}
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Scopes: {key.scopes.join(' · ')}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onDeleteApiKey(key.id)}
                  aria-label={`Revoke API key ${key.name}`}
                  className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {apiKeys.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No API keys generated yet. Create a key above to include it in your Cloudflare Worker or API calls.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
