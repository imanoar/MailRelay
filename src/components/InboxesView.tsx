import React, { useState, useMemo } from 'react';
import {
  Mail,
  Copy,
  Check,
  Plus,
  Trash2,
  Search,
  KeyRound,
  ExternalLink,
  Clock,
  Star,
  RefreshCw,
  ShieldCheck,
  Globe,
} from 'lucide-react';
import {
  CustomDomain,
  TempInbox,
  MailMessage,
  formatRemainingTtl,
  scanMessageForOtpTokens,
} from '../lib/mailEngine';
import { EmailBodyPreviewer } from './EmailBodyPreviewer';

interface InboxesViewProps {
  domains: CustomDomain[];
  inboxes: TempInbox[];
  messages: MailMessage[];
  selectedInboxId: string | 'all';
  onSelectInbox: (id: string | 'all') => void;
  selectedMessageId: string | null;
  onSelectMessage: (id: string | null) => void;
  onCreateInbox: (payload: {
    prefix: string;
    domainId: string;
    ttlMinutes: number;
    label: string;
  }) => Promise<TempInbox | null>;
  onDeleteInbox: (id: string) => Promise<void>;
  onToggleMessageMeta: (id: string, patch: { read?: boolean; starred?: boolean }) => Promise<void>;
  onDeleteMessage: (id: string) => Promise<void>;
  onNavigateToDomains: () => void;
  onRefreshStream: () => Promise<void>;
  nowTick: number;
}

export function InboxesView({
  domains,
  inboxes,
  messages,
  selectedInboxId,
  onSelectInbox,
  selectedMessageId,
  onSelectMessage,
  onCreateInbox,
  onDeleteInbox,
  onToggleMessageMeta,
  onDeleteMessage,
  onNavigateToDomains,
  onRefreshStream,
  nowTick,
}: InboxesViewProps) {
  const [prefixInput, setPrefixInput] = useState('');
  const [selectedDomainId, setSelectedDomainId] = useState<string>(domains[0]?.id ?? '');
  const [ttlMinutes, setTtlMinutes] = useState<number>(60);
  const [labelInput, setLabelInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [inboxSearch, setInboxSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [messageFilter, setMessageFilter] = useState<'all' | 'unread' | 'otp'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeDomainId = selectedDomainId || domains[0]?.id || '';

  const copyToClipboard = (value: string, key: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1600);
  };

  const filteredInboxes = useMemo(() => {
    const q = inboxSearch.trim().toLowerCase();
    if (!q) return inboxes;
    return inboxes.filter(
      (i) =>
        i.address.toLowerCase().includes(q) ||
        i.label.toLowerCase().includes(q) ||
        i.domainName.toLowerCase().includes(q)
    );
  }, [inboxes, inboxSearch]);

  const filteredMessages = useMemo(() => {
    let list = messages;
    if (selectedInboxId !== 'all') {
      list = list.filter((m) => m.inboxId === selectedInboxId);
    }
    if (messageFilter === 'unread') {
      list = list.filter((m) => !m.read);
    } else if (messageFilter === 'otp') {
      list = list.filter(
        (m) => Boolean(m.extracted.primaryOtp) || m.extracted.verificationLinks.length > 0
      );
    }
    const q = messageSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.subject.toLowerCase().includes(q) ||
          m.from.toLowerCase().includes(q) ||
          m.to.toLowerCase().includes(q) ||
          m.textBody.toLowerCase().includes(q) ||
          (m.extracted.primaryOtp && m.extracted.primaryOtp.toLowerCase().includes(q))
      );
    }
    return list;
  }, [messages, selectedInboxId, messageFilter, messageSearch]);

  const activeMessage = useMemo(() => {
    if (selectedMessageId) {
      const found = filteredMessages.find((m) => m.id === selectedMessageId);
      if (found) return found;
    }
    return filteredMessages[0] ?? null;
  }, [filteredMessages, selectedMessageId]);

  const activeOtpTokens = useMemo(() => {
    if (!activeMessage) return [];
    const scanned = scanMessageForOtpTokens(
      activeMessage.textBody,
      activeMessage.htmlBody,
      activeMessage.subject
    );
    return Array.from(new Set([...scanned, ...(activeMessage.extracted?.otpCodes ?? [])]));
  }, [activeMessage]);

  const selectedInboxObj = useMemo(
    () => inboxes.find((i) => i.id === selectedInboxId) ?? null,
    [inboxes, selectedInboxId]
  );

  const handleGenerateInbox = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const created = await onCreateInbox({
        prefix: prefixInput.trim(),
        domainId: activeDomainId,
        ttlMinutes,
        label: labelInput.trim(),
      });
      if (created) {
        setPrefixInput('');
        setLabelInput('');
        onSelectInbox(created.id);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create temp inbox.');
    } finally {
      setCreating(false);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshStream();
    } finally {
      setRefreshing(false);
    }
  };

  const formatTimestamp = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="space-y-6">
      {/* Temp Mail Generator Bar */}
      <section
        aria-label="Generate Temporary Inbox"
        className="bg-white border border-slate-200 rounded-xl p-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 mb-4 border-b border-slate-100">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Disposable Inboxes & Inbound Stream
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Generate temporary email addresses on your connected domains and receive real incoming messages via API or Cloudflare Email Routing.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap shrink-0">
            <span>Active Inboxes: {inboxes.length}</span>
            <span aria-hidden="true">·</span>
            <span>Messages Received: {messages.length}</span>
            <span aria-hidden="true">·</span>
            <span>Connected Domains: {domains.length}</span>
          </div>
        </div>

        {domains.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-blue-600 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  No custom domain connected yet
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Connect your domain first in the Domains tab to start generating temporary email addresses and receiving messages.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onNavigateToDomains}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Connect Your Domain</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleGenerateInbox} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <label htmlFor="inbox-prefix-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                Local Username (leave blank for random)
              </label>
              <input
                id="inbox-prefix-input"
                type="text"
                value={prefixInput}
                onChange={(e) => setPrefixInput(e.target.value)}
                placeholder="e.g. auth-test"
                className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="md:col-span-3">
              <label htmlFor="inbox-domain-select" className="block text-xs font-medium text-slate-700 mb-1.5">
                Connected Domain
              </label>
              <select
                id="inbox-domain-select"
                value={activeDomainId}
                onChange={(e) => setSelectedDomainId(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                {domains.map((dom) => (
                  <option key={dom.id} value={dom.id}>
                    @{dom.domain} ({dom.status === 'verified' ? 'Active' : 'Pending Setup'})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="inbox-ttl-select" className="block text-xs font-medium text-slate-700 mb-1.5">
                Auto-Expire TTL
              </label>
              <select
                id="inbox-ttl-select"
                value={ttlMinutes}
                onChange={(e) => setTtlMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                <option value={15}>15 Minutes</option>
                <option value={60}>1 Hour</option>
                <option value={240}>4 Hours</option>
                <option value={1440}>24 Hours</option>
                <option value={10080}>7 Days</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="inbox-label-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                Label (Optional)
              </label>
              <input
                id="inbox-label-input"
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="e.g. Project Testing"
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={creating || domains.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Generate Inbox</span>
              </button>
            </div>
          </form>
        )}

        {createError && (
          <p role="alert" className="mt-2.5 text-xs text-red-600 font-medium">
            {createError}
          </p>
        )}
      </section>

      {/* 3-Column Master Inspector Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Column 1: Inboxes List (3 cols) */}
        <aside
          aria-label="Temporary Inboxes"
          className="lg:col-span-3 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="p-3.5 border-b border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Temp Inboxes</h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {filteredInboxes.length} total
              </span>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search inboxes"
                value={inboxSearch}
                onChange={(e) => setInboxSearch(e.target.value)}
                placeholder="Filter address or label..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            <button
              type="button"
              onClick={() => onSelectInbox('all')}
              className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between cursor-pointer ${
                selectedInboxId === 'all'
                  ? 'bg-blue-50/70 text-blue-950'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div>
                <div className="text-xs font-semibold">All Catch-All & Temp Inboxes</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Unified stream across {domains.length} domains
                </div>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-600">
                {messages.length}
              </span>
            </button>

            {filteredInboxes.map((inbox) => {
              const isSelected = selectedInboxId === inbox.id;
              const inboxMsgCount = messages.filter((m) => m.inboxId === inbox.id).length;
              const unreadCount = messages.filter((m) => m.inboxId === inbox.id && !m.read).length;
              const ttl = formatRemainingTtl(inbox.expiresAt, nowTick);

              return (
                <div
                  key={inbox.id}
                  className={`group px-4 py-3 transition-colors ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectInbox(inbox.id)}
                      className="text-left flex-1 min-w-0 cursor-pointer"
                    >
                      <div className="text-xs font-mono font-semibold text-slate-900 truncate">
                        {inbox.address}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {inbox.label}
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(inbox.address, `inb-${inbox.id}`)}
                        aria-label={`Copy address ${inbox.address}`}
                        title="Copy email address"
                        className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors cursor-pointer"
                      >
                        {copiedKey === `inb-${inbox.id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteInbox(inbox.id)}
                        aria-label={`Delete inbox ${inbox.address}`}
                        title="Delete inbox"
                        className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-2 font-mono tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {ttl.label}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{inboxMsgCount} msgs</span>
                    {unreadCount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-blue-600 font-semibold">{unreadCount} unread</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredInboxes.length === 0 && (
              <div className="p-6 text-center">
                <p className="text-xs text-slate-500">
                  {domains.length === 0
                    ? 'Connect a domain first to generate inboxes.'
                    : 'No temporary inboxes generated yet.'}
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Column 2: Message Stream (4 cols) */}
        <section
          aria-label="Incoming Messages List"
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="p-3.5 border-b border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900 truncate">
                  {selectedInboxObj ? selectedInboxObj.address : 'Incoming Messages'}
                </h2>
              </div>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Search messages by subject, sender, or OTP"
                  value={messageSearch}
                  onChange={(e) => setMessageSearch(e.target.value)}
                  placeholder="Search subject, sender, OTP..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>

              <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md shrink-0">
                {(['all', 'unread', 'otp'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMessageFilter(mode)}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      messageFilter === mode
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {mode === 'all' ? 'All' : mode === 'unread' ? 'Unread' : 'Has OTP'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {filteredMessages.map((msg) => {
              const isSelected = activeMessage?.id === msg.id;
              return (
                <div
                  key={msg.id}
                  onClick={() => {
                    onSelectMessage(msg.id);
                    if (!msg.read) {
                      onToggleMessageMeta(msg.id, { read: true });
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectMessage(msg.id);
                    }
                  }}
                  className={`p-4 transition-colors cursor-pointer ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`truncate ${
                        !msg.read ? 'font-bold text-slate-900' : 'font-medium text-slate-700'
                      }`}
                    >
                      {msg.fromName}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                      {formatTimestamp(msg.receivedAt)}
                    </span>
                  </div>

                  <div
                    className={`text-sm mt-1 truncate ${
                      !msg.read ? 'font-semibold text-slate-900' : 'text-slate-800'
                    }`}
                  >
                    {msg.subject}
                  </div>

                  <div className="text-xs text-slate-500 mt-1 line-clamp-1">
                    {msg.textBody}
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-2.5 text-[11px] text-slate-500 font-mono">
                    <span className="truncate">To: {msg.to}</span>
                    {msg.extracted.primaryOtp && (
                      <span className="text-blue-700 font-semibold shrink-0">
                        OTP: {msg.extracted.primaryOtp}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredMessages.length === 0 && (
              <div className="p-8 text-center space-y-2">
                <Mail className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-sm font-medium text-slate-800">No incoming messages yet</p>
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  Messages sent to your connected domain via Cloudflare Email Worker or <code>POST /api/v1/inbound</code> will appear here automatically.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Column 3: Message Inspector & OTP Extractor (5 cols) */}
        <section
          aria-label="Message Inspector"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          {activeMessage ? (
            <div>
              {/* Prominent 'Extracted Tokens' Pill Bar at Top of Selected Message View */}
              {(activeOtpTokens.length > 0 ||
                activeMessage.extracted.verificationLinks.length > 0) && (
                <div
                  data-testid="extracted-tokens-pill"
                  className="px-5 py-3.5 bg-blue-50/90 border-b border-blue-200 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold tracking-tight shadow-xs">
                      <KeyRound className="w-3.5 h-3.5" />
                      Extracted Tokens
                    </span>
                    <span className="text-[11px] font-mono text-blue-900/80 hidden sm:inline">
                      Auto-scanned 4–8 digit OTPs
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {activeOtpTokens.map((token, idx) => {
                      const copyKey = `otp-token-${activeMessage.id}-${token}`;
                      const isCopied = copiedKey === copyKey;
                      return (
                        <button
                          key={`${token}-${idx}`}
                          type="button"
                          onClick={() => copyToClipboard(token, copyKey)}
                          aria-label={`Copy OTP token ${token}`}
                          title="Click to copy OTP token"
                          className="inline-flex items-center gap-2 bg-white hover:bg-blue-50 border border-blue-300 rounded-lg px-3 py-1.5 shadow-2xs transition-colors cursor-pointer group"
                        >
                          <code
                            data-testid="extracted-otp-code"
                            className="text-sm font-mono font-bold text-slate-900 tracking-wider"
                          >
                            {token}
                          </code>
                          {isCopied ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              Copied
                            </span>
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-colors" />
                          )}
                        </button>
                      );
                    })}

                    {activeMessage.extracted.verificationLinks.map((link, idx) => (
                      <div
                        key={idx}
                        className="inline-flex items-center gap-2 bg-white border border-blue-200 rounded-lg px-3 py-1.5 max-w-full"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="text-xs font-medium text-slate-800 truncate max-w-[160px]">
                          {link.label}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(link.url, `link-${activeMessage.id}-${idx}`)
                          }
                          aria-label={`Copy verification URL for ${link.label}`}
                          className="text-xs font-mono text-blue-600 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {copiedKey === `link-${activeMessage.id}-${idx}` ? 'Copied!' : 'Copy URL'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Message Header */}
              <div className="p-5 border-b border-slate-200 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-900 leading-snug">
                    {activeMessage.subject}
                  </h2>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onToggleMessageMeta(activeMessage.id, { starred: !activeMessage.starred })
                      }
                      aria-label={activeMessage.starred ? 'Unstar message' : 'Star message'}
                      className={`p-1.5 rounded transition-colors cursor-pointer ${
                        activeMessage.starred
                          ? 'text-amber-500 hover:bg-amber-50'
                          : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Star className="w-4 h-4 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteMessage(activeMessage.id)}
                      aria-label="Delete message"
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 w-12 shrink-0">From</span>
                    <span className="font-mono text-slate-800 truncate">{activeMessage.from}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 w-12 shrink-0">To</span>
                    <span className="font-mono text-slate-800 truncate">{activeMessage.to}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(activeMessage.to, `msg-to-${activeMessage.id}`)}
                      aria-label="Copy recipient address"
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {copiedKey === `msg-to-${activeMessage.id}` ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1 font-mono tabular-nums">
                    <span>{new Date(activeMessage.receivedAt).toLocaleString()}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeMessage.sizeBytes} bytes</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      SPF & DKIM Pass
                    </span>
                  </div>
                </div>
              </div>

              {/* Dedicated Sandboxed Email Body Previewer & EML Exporter */}
              <EmailBodyPreviewer message={activeMessage} />
            </div>
          ) : (
            <div className="p-12 text-center space-y-3">
              <Mail className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-800">
                No message selected
              </div>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Incoming messages routed from your domain will display their HTML body, extracted OTP codes, and headers here.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
