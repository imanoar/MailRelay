import React, { useState } from 'react';
import {
  Globe,
  Plus,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Code2,
  Download,
} from 'lucide-react';
import { CustomDomain, ApiKeyRecord } from '../lib/mailEngine';

interface DomainsViewProps {
  domains: CustomDomain[];
  apiKeys: ApiKeyRecord[];
  onAddDomain: (payload: {
    domain: string;
    description: string;
    catchAll: boolean;
  }) => Promise<CustomDomain | null>;
  onVerifyDomain: (id: string, mode?: 'cloudflare' | 'dns') => Promise<void>;
  onToggleCatchAll: (id: string, catchAll: boolean) => Promise<void>;
  onDeleteDomain: (id: string) => Promise<void>;
}

type SetupModeTab = 'cloudflare' | 'webhooks' | 'dns';

export function DomainsView({
  domains,
  apiKeys,
  onAddDomain,
  onVerifyDomain,
  onToggleCatchAll,
  onDeleteDomain,
}: DomainsViewProps) {
  const [domainInput, setDomainInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [catchAllInput, setCatchAllInput] = useState(true);
  const [selectedDomainId, setSelectedDomainId] = useState<string>(domains[0]?.id ?? '');
  const [setupTab, setSetupTab] = useState<SetupModeTab>('cloudflare');

  const [adding, setAdding] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeDomain =
    domains.find((d) => d.id === selectedDomainId) ?? domains[0] ?? null;

  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const inboundEndpoint = `${baseUrl}/api/v1/inbound`;
  const activeApiKey = apiKeys[0]?.token ?? '';

  const copyText = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1600);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!domainInput.trim()) {
      setError('Please enter your domain or subdomain (e.g. mail.yourdomain.com).');
      return;
    }
    setAdding(true);
    try {
      const created = await onAddDomain({
        domain: domainInput.trim(),
        description: descriptionInput.trim(),
        catchAll: catchAllInput,
      });
      if (created) {
        setDomainInput('');
        setDescriptionInput('');
        setSelectedDomainId(created.id);
        setSetupTab('cloudflare');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect domain.');
    } finally {
      setAdding(false);
    }
  };

  const handleVerify = async (id: string, mode: 'cloudflare' | 'dns') => {
    setVerifyingId(id);
    try {
      await onVerifyDomain(id, mode);
    } finally {
      setVerifyingId(null);
    }
  };

  const cloudflareWorkerScript = activeDomain
    ? `/**
 * Cloudflare Email Worker for @${activeDomain.domain}
 * Forwards incoming emails (*@${activeDomain.domain}) to MailRelay
 */
export default {
  async email(message, env, ctx) {
    const rawMime = await new Response(message.raw).text();

    const response = await fetch("${inboundEndpoint}", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"${
          activeApiKey ? `,\n        "Authorization": "Bearer ${activeApiKey}"` : ''
        }
      },
      body: JSON.stringify({
        provider: "cloudflare-worker",
        to: message.to,
        from: message.from,
        subject: message.headers.get("subject") || "(No subject)",
        rawMime,
        headers: {
          "Message-ID": message.headers.get("message-id") || "",
          "X-Cloudflare-Domain": "${activeDomain.domain}"
        }
      })
    });

    if (!response.ok) {
      console.error("MailRelay forward failed:", await response.text());
    }
  }
};`
    : '';

  return (
    <div className="space-y-6">
      {/* Connect New Custom Domain Form */}
      <section
        aria-label="Connect Custom Domain"
        className="bg-white border border-slate-200 rounded-xl p-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 mb-4 border-b border-slate-100">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Custom Domains & Cloudflare Email Worker Setup
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Connect your domain via Cloudflare Email Routing (free) or configure inbound webhooks and DNS records.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
            <span>Connected Domains: {domains.length}</span>
            <span aria-hidden="true">·</span>
            <span>Storage: Persistent Disk JSON</span>
            <span aria-hidden="true">·</span>
            <a
              href="/api/v1/export"
              download="mailrelay-workspace-backup.json"
              className="inline-flex items-center gap-1 font-sans font-medium text-blue-600 hover:underline"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Backup</span>
            </a>
          </div>
        </div>

        <form onSubmit={handleAddSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-4">
            <label htmlFor="custom-domain-input" className="block text-xs font-medium text-slate-700 mb-1.5">
              Domain or Subdomain Name
            </label>
            <input
              id="custom-domain-input"
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="e.g. mail.yourdomain.com"
              className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div className="md:col-span-4">
            <label htmlFor="domain-desc-input" className="block text-xs font-medium text-slate-700 mb-1.5">
              Project / Environment Purpose (Optional)
            </label>
            <input
              id="domain-desc-input"
              type="text"
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              placeholder="e.g. Production / Staging Auth Testing"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <div className="md:col-span-2">
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={catchAllInput}
                onChange={(e) => setCatchAllInput(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span className="text-xs font-medium text-slate-800 whitespace-nowrap">
                Enable Catch-All (*@)
              </span>
            </label>
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={adding}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Domain</span>
            </button>
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-2.5 text-xs text-red-600 font-medium">
            {error}
          </p>
        )}
      </section>

      {/* Split Domain Selector + Interactive Setup Wizard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Connected Domains List (4 cols) */}
        <section
          aria-label="Connected Domains List"
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Your Domains</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {domains.length} configured
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {domains.map((dom) => {
              const isSelected = activeDomain?.id === dom.id;
              return (
                <div
                  key={dom.id}
                  onClick={() => setSelectedDomainId(dom.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedDomainId(dom.id);
                    }
                  }}
                  className={`p-4 transition-colors cursor-pointer ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="text-sm font-mono font-bold text-slate-900 truncate">
                          {dom.domain}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-1">
                        {dom.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDomain(dom.id);
                      }}
                      aria-label={`Remove domain ${dom.domain}`}
                      className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mt-3 text-xs font-mono tabular-nums text-slate-600">
                    {dom.status === 'verified' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        Pending Setup
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{dom.catchAll ? 'Catch-All Active' : 'Explicit Inboxes'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{dom.messageCount ?? 0} msgs</span>
                  </div>
                </div>
              );
            })}

            {domains.length === 0 && (
              <div className="p-8 text-center space-y-2">
                <Globe className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-medium text-slate-700">No domains connected</p>
                <p className="text-xs text-slate-500">
                  Enter your domain above and click Add Domain to generate your Cloudflare Worker script.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Right Panel: Interactive Cloudflare Email Worker Wizard & DNS Configuration (8 cols) */}
        <section
          aria-label="Domain Setup & DNS Configuration"
          className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          {activeDomain ? (
            <div>
              {/* Domain Header & Mode Selector */}
              <div className="p-5 border-b border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-bold font-mono text-slate-900">
                        {activeDomain.domain}
                      </h2>
                      <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                      {activeDomain.status === 'verified' ? (
                        <span
                          data-testid="domain-verified-status"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          Active & Receiving Mail
                        </span>
                      ) : (
                        <span
                          data-testid="domain-pending-status"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"
                        >
                          <Clock className="w-4 h-4" />
                          Awaiting Worker or DNS Setup
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Route incoming emails for <strong>*@{activeDomain.domain}</strong> into this workspace.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeDomain.catchAll}
                        onChange={(e) => onToggleCatchAll(activeDomain.id, e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      <span>Catch-All (*@{activeDomain.domain})</span>
                    </label>
                  </div>
                </div>

                {/* Setup Method Segmented Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setSetupTab('cloudflare')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        setupTab === 'cloudflare'
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Cloudflare Email Worker (Recommended · Free)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSetupTab('webhooks')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        setupTab === 'webhooks'
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Postmark / SendGrid / Mailgun
                    </button>
                    <button
                      type="button"
                      onClick={() => setSetupTab('dns')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        setupTab === 'dns'
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Direct DNS Records (MX / SPF / DKIM)
                    </button>
                  </div>
                </div>
              </div>

              {/* TAB 1: Cloudflare Email Worker 3-Step Setup Wizard */}
              {setupTab === 'cloudflare' && (
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <div className="text-xs font-bold text-slate-900">
                        01. Enable Email Routing
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        In your Cloudflare dashboard for <strong>{activeDomain.domain}</strong>, open{' '}
                        <strong>Email → Email Routing</strong> and click Enable to add Cloudflare's free MX records.
                      </p>
                    </div>

                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <div className="text-xs font-bold text-slate-900">
                        02. Paste Email Worker Script
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Open <strong>Email Workers → Create Worker</strong>, paste the script below, and click <strong>Save and Deploy</strong>.
                      </p>
                    </div>

                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <div className="text-xs font-bold text-slate-900">
                        03. Bind Catch-All Rule
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Under <strong>Routing Rules → Catch-All address</strong>, set Action to{' '}
                        <strong>Send to a Worker</strong> and select your deployed Worker.
                      </p>
                    </div>
                  </div>

                  {/* Pre-configured Worker Code Block */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                        <Code2 className="w-4 h-4 text-blue-600" />
                        <span>
                          Cloudflare Email Worker (<code>worker.js</code>) for @{activeDomain.domain}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(cloudflareWorkerScript, 'cf-worker-code')}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                      >
                        {copiedKey === 'cf-worker-code' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied Worker Script!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Worker Script</span>
                          </>
                        )}
                      </button>
                    </div>

                    <pre className="bg-slate-950 text-slate-100 rounded-lg p-4 font-mono text-xs overflow-x-auto leading-relaxed max-h-[300px]">
                      {cloudflareWorkerScript}
                    </pre>
                  </div>

                  {/* Ingestion URL Quick Reference */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-xs font-semibold text-slate-900">
                        Your Live HTTPS Inbound Ingestion Endpoint
                      </div>
                      <div className="text-xs font-mono text-slate-600 truncate">
                        POST {inboundEndpoint}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyText(inboundEndpoint, 'cf-inbound-url')}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                      >
                        {copiedKey === 'cf-inbound-url' ? 'Copied URL!' : 'Copy Endpoint URL'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleVerify(activeDomain.id, 'cloudflare')}
                        disabled={verifyingId === activeDomain.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${verifyingId === activeDomain.id ? 'animate-spin' : ''}`}
                        />
                        <span>
                          {activeDomain.status === 'verified'
                            ? 'Cloudflare Routing Active'
                            : 'Activate Cloudflare Routing'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Postmark / SendGrid / Mailgun Webhook Relay */}
              {setupTab === 'webhooks' && (
                <div className="p-5 space-y-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-slate-900">
                      Universal Inbound Webhook URL (Postmark, SendGrid, & Mailgun)
                    </div>
                    <p className="text-xs text-slate-600">
                      Paste this URL into your provider's Inbound Webhook setting. Our parser normalizes Postmark (<code>TextBody</code>/<code>HtmlBody</code>), SendGrid Inbound Parse (<code>body-plain</code>/<code>email</code>), and Mailgun Routes:
                    </p>
                    <div className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3.5 py-2 font-mono text-xs text-slate-800">
                      <span className="truncate">{inboundEndpoint}</span>
                      <button
                        type="button"
                        onClick={() => copyText(inboundEndpoint, 'provider-webhook-url')}
                        className="text-blue-600 hover:underline font-sans font-medium shrink-0 cursor-pointer"
                      >
                        {copiedKey === 'provider-webhook-url' ? 'Copied!' : 'Copy Webhook URL'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="p-3.5 border border-slate-200 rounded-lg space-y-1">
                      <div className="font-bold text-slate-900">Postmark Inbound</div>
                      <p className="text-slate-600 leading-relaxed">
                        In Postmark → <strong>Servers → Inbound → Webhook</strong>, paste the URL above and enable <em>Include raw email content</em>.
                      </p>
                    </div>
                    <div className="p-3.5 border border-slate-200 rounded-lg space-y-1">
                      <div className="font-bold text-slate-900">SendGrid Inbound Parse</div>
                      <p className="text-slate-600 leading-relaxed">
                        In SendGrid → <strong>Settings → Inbound Parse → Add Host & URL</strong>, select <strong>{activeDomain.domain}</strong> and paste the URL above.
                      </p>
                    </div>
                    <div className="p-3.5 border border-slate-200 rounded-lg space-y-1">
                      <div className="font-bold text-slate-900">Mailgun Receiving Routes</div>
                      <p className="text-slate-600 leading-relaxed">
                        Create a Route matching <code>match_recipient(".*@{activeDomain.domain}")</code> with action <code>forward("{inboundEndpoint}")</code>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Direct DNS Records Table */}
              {setupTab === 'dns' && (
                <div>
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs text-slate-600">
                      DNS records for <strong>{activeDomain.domain}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleVerify(activeDomain.id, 'dns')}
                      disabled={verifyingId === activeDomain.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${verifyingId === activeDomain.id ? 'animate-spin' : ''}`}
                      />
                      <span>Check Live DNS Records</span>
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/60 text-[11px] font-semibold text-slate-600">
                          <th className="py-2.5 px-4">Purpose</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Host / Name</th>
                          <th className="py-2.5 px-4">Required Value / Target</th>
                          <th className="py-2.5 px-4 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {activeDomain.dnsRecords.map((rec) => (
                          <tr key={rec.id} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-medium text-slate-800 whitespace-nowrap">
                              {rec.purpose}
                            </td>
                            <td className="py-3 px-3 font-mono font-semibold text-slate-700 whitespace-nowrap">
                              {rec.type}
                              {rec.priority !== undefined ? ` (${rec.priority})` : ''}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-800 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span>{rec.host}</span>
                                <button
                                  type="button"
                                  onClick={() => copyText(rec.host, `host-${rec.id}`)}
                                  aria-label={`Copy DNS host ${rec.host}`}
                                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                >
                                  {copiedKey === `host-${rec.id}` ? (
                                    <Check className="w-3 h-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-600 max-w-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate" title={rec.value}>
                                  {rec.value}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyText(rec.value, `val-${rec.id}`)}
                                  aria-label={`Copy DNS value for ${rec.purpose}`}
                                  className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
                                >
                                  {copiedKey === `val-${rec.id}` ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {rec.verified ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Verified
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                  <Clock className="w-3.5 h-3.5" />
                                  Pending
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center space-y-3">
              <Globe className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-800">
                Connect your domain to get started
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Enter your domain or subdomain in the form above (for example, <code>mail.yourdomain.com</code>) to generate your custom Cloudflare Email Worker script and webhook ingestion endpoint.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
