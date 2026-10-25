import React, { useState } from 'react';
import {
  Webhook,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import {
  CustomDomain,
  WebhookEndpoint,
  WebhookDeliveryLog,
  WebhookEventType,
} from '../lib/mailEngine';

interface WebhooksViewProps {
  domains: CustomDomain[];
  webhooks: WebhookEndpoint[];
  deliveries: WebhookDeliveryLog[];
  onCreateWebhook: (payload: {
    name: string;
    url: string;
    domainId: string;
    events: WebhookEventType[];
  }) => Promise<WebhookEndpoint | null>;
  onToggleWebhook: (id: string, active: boolean) => Promise<void>;
  onDeleteWebhook: (id: string) => Promise<void>;
}

const ALL_EVENTS: Array<{ id: WebhookEventType; label: string }> = [
  { id: 'message.received', label: 'message.received' },
  { id: 'otp.extracted', label: 'otp.extracted' },
  { id: 'inbox.created', label: 'inbox.created' },
  { id: 'inbox.expired', label: 'inbox.expired' },
];

export function WebhooksView({
  domains,
  webhooks,
  deliveries,
  onCreateWebhook,
  onToggleWebhook,
  onDeleteWebhook,
}: WebhooksViewProps) {
  const [nameInput, setNameInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [domainScope, setDomainScope] = useState<string>('all');
  const [selectedEvents, setSelectedEvents] = useState<WebhookEventType[]>([
    'message.received',
    'otp.extracted',
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string>(
    deliveries[0]?.id ?? ''
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeDelivery =
    deliveries.find((d) => d.id === selectedDeliveryId) ?? deliveries[0] ?? null;

  const copyText = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1500);
  };

  const toggleEventSelection = (event: WebhookEventType) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!nameInput.trim()) {
      setError('Please enter a descriptive name for the webhook endpoint.');
      return;
    }
    if (!urlInput.trim() || (!urlInput.startsWith('http://') && !urlInput.startsWith('https://'))) {
      setError('Please enter a valid http:// or https:// destination URL.');
      return;
    }
    if (selectedEvents.length === 0) {
      setError('Select at least one webhook event trigger.');
      return;
    }

    setCreating(true);
    try {
      const created = await onCreateWebhook({
        name: nameInput.trim(),
        url: urlInput.trim(),
        domainId: domainScope,
        events: selectedEvents,
      });
      if (created) {
        setNameInput('');
        setUrlInput('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register webhook.');
    } finally {
      setCreating(false);
    }
  };

  React.useEffect(() => {
    if (deliveries.length > 0 && !deliveries.some((d) => d.id === selectedDeliveryId)) {
      setSelectedDeliveryId(deliveries[0].id);
    }
  }, [deliveries, selectedDeliveryId]);

  return (
    <div className="space-y-6">
      {/* Register New Webhook Form */}
      <section
        aria-label="Register Webhook Endpoint"
        className="bg-white border border-slate-200 rounded-xl p-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 mb-4 border-b border-slate-100">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Webhook Dispatchers & Delivery Logs
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Push real-time JSON payloads signed with HMAC-SHA256 whenever your temp inboxes receive messages or OTP codes.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
            <span>Active Endpoints: {webhooks.filter((w) => w.active).length}</span>
            <span aria-hidden="true">·</span>
            <span>Deliveries Logged: {deliveries.length}</span>
          </div>
        </div>

        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <label htmlFor="wh-name-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                Endpoint Name
              </label>
              <input
                id="wh-name-input"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Project Webhook Receiver"
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="md:col-span-4">
              <label htmlFor="wh-url-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                Target Webhook URL
              </label>
              <input
                id="wh-url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://api.yourproject.com/webhooks/mail"
                className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="md:col-span-3">
              <label htmlFor="wh-domain-select" className="block text-xs font-medium text-slate-700 mb-1.5">
                Domain Scope
              </label>
              <select
                id="wh-domain-select"
                value={domainScope}
                onChange={(e) => setDomainScope(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                <option value="all">All Connected Domains</option>
                {domains.map((dom) => (
                  <option key={dom.id} value={dom.id}>
                    @{dom.domain}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Webhook</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <span className="text-xs font-medium text-slate-700">Subscribed Events:</span>
            {ALL_EVENTS.map((ev) => (
              <label key={ev.id} className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(ev.id)}
                  onChange={() => toggleEventSelection(ev.id)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>{ev.label}</span>
              </label>
            ))}
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-2.5 text-xs text-red-600 font-medium">
            {error}
          </p>
        )}
      </section>

      {/* Configured Webhooks List */}
      <section
        aria-label="Configured Webhook Endpoints"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Configured Webhook Endpoints</h2>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            HMAC-SHA256 Signed
          </span>
        </div>

        <div className="divide-y divide-slate-200">
          {webhooks.map((wh) => {
            const scopeDomain =
              wh.domainId === 'all'
                ? 'All Domains'
                : `@${domains.find((d) => d.id === wh.domainId)?.domain ?? wh.domainId}`;

            return (
              <div
                key={wh.id}
                className="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 hover:bg-slate-50 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <Webhook className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-sm font-bold text-slate-900">{wh.name}</span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-xs font-mono text-slate-700 truncate">{wh.url}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                    <span>Scope: {scopeDomain}</span>
                    <span aria-hidden="true">·</span>
                    <span>Events: {wh.events.join(', ')}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      Secret: {wh.secret.slice(0, 12)}...
                      <button
                        type="button"
                        onClick={() => copyText(wh.secret, `sec-${wh.id}`)}
                        aria-label={`Copy signing secret for ${wh.name}`}
                        className="text-blue-600 hover:underline font-sans cursor-pointer"
                      >
                        {copiedKey === `sec-${wh.id}` ? 'Copied' : 'Copy'}
                      </button>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wh.active}
                      onChange={(e) => onToggleWebhook(wh.id, e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>{wh.active ? 'Active' : 'Paused'}</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => onDeleteWebhook(wh.id)}
                    aria-label={`Delete webhook ${wh.name}`}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {webhooks.length === 0 && (
            <div className="p-8 text-center space-y-1">
              <Webhook className="w-7 h-7 text-slate-300 mx-auto mb-1" />
              <p className="text-xs font-medium text-slate-700">No webhook endpoints registered</p>
              <p className="text-xs text-slate-500">
                Add your HTTPS endpoint URL above to receive signed JSON events when emails arrive.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Delivery Logs & Payload Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <section
          aria-label="Recent Webhook Deliveries"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Webhook Deliveries</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {deliveries.length} events
            </span>
          </div>

          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {deliveries.map((del) => {
              const isSelected = activeDelivery?.id === del.id;
              return (
                <button
                  key={del.id}
                  type="button"
                  onClick={() => setSelectedDeliveryId(del.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-900">
                      {del.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      )}
                      <span>HTTP {del.statusCode}</span>
                      <span className="text-slate-400" aria-hidden="true">·</span>
                      <span>{del.event}</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500">
                      {del.durationMs}ms
                    </span>
                  </div>

                  <div className="text-xs text-slate-700 font-medium mt-1 truncate">
                    {del.webhookName}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-1">
                    {new Date(del.timestamp).toLocaleTimeString()} · ID: {del.id}
                  </div>
                </button>
              );
            })}

            {deliveries.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No webhook deliveries recorded yet.
              </div>
            )}
          </div>
        </section>

        <section
          aria-label="Webhook Payload Inspector"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          {activeDelivery ? (
            <div className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-mono">
                    POST {activeDelivery.targetUrl}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                    <span
                      className={
                        activeDelivery.success
                          ? 'text-emerald-700 font-semibold'
                          : 'text-red-700 font-semibold'
                      }
                    >
                      Status {activeDelivery.statusCode}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Latency {activeDelivery.durationMs}ms</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-slate-700">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      HMAC-SHA256 Signed
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(activeDelivery.requestPayload, `payload-${activeDelivery.id}`)
                  }
                  className="text-xs font-medium text-blue-600 hover:underline self-start sm:self-auto cursor-pointer"
                >
                  {copiedKey === `payload-${activeDelivery.id}`
                    ? 'Copied JSON!'
                    : 'Copy Request JSON'}
                </button>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1.5">
                  Request Headers (Including HMAC Signature)
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[11px] text-slate-700 space-y-1 overflow-x-auto">
                  {Object.entries(activeDelivery.requestHeaders).map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="font-semibold text-slate-900">{k}:</span> {v}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1.5">
                    Dispatched JSON Body
                  </div>
                  <pre className="bg-slate-900 text-slate-100 rounded-lg p-3.5 font-mono text-[11px] overflow-x-auto max-h-[260px]">
                    {activeDelivery.requestPayload}
                  </pre>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1.5">
                    Endpoint Response Body
                  </div>
                  <pre className="bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3.5 font-mono text-[11px] overflow-x-auto max-h-[260px]">
                    {activeDelivery.responseBody}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-10 text-center text-xs text-slate-500">
              When a webhook is triggered by an incoming email or inbox event, its headers and payload will appear here.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
