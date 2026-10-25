import React, { useState, useEffect, useCallback } from 'react';
import {
  CustomDomain,
  TempInbox,
  MailMessage,
  WebhookEndpoint,
  WebhookDeliveryLog,
  ApiKeyRecord,
  WebhookEventType,
} from './lib/mailEngine';
import { InboxesView } from './components/InboxesView';
import { DomainsView } from './components/DomainsView';
import { WebhooksView } from './components/WebhooksView';
import { ApiConsoleView } from './components/ApiConsoleView';

type ActiveSection = 'inboxes' | 'domains' | 'webhooks' | 'api';

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('inboxes');
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [inboxes, setInboxes] = useState<TempInbox[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryLog[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);

  const [selectedInboxId, setSelectedInboxId] = useState<string | 'all'>('all');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setBannerNotice(msg);
    setTimeout(() => {
      setBannerNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const fetchServerState = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/state');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.domains)) setDomains(data.domains);
      if (Array.isArray(data.inboxes)) setInboxes(data.inboxes);
      if (Array.isArray(data.messages)) setMessages(data.messages);
      if (Array.isArray(data.webhooks)) setWebhooks(data.webhooks);
      if (Array.isArray(data.deliveries)) setDeliveries(data.deliveries);
      if (Array.isArray(data.apiKeys)) setApiKeys(data.apiKeys);
    } catch {
      // Ignore transient network errors during poll
    }
  }, []);

  useEffect(() => {
    fetchServerState();
    // Poll every 5 seconds for new incoming emails forwarded by Cloudflare Worker or webhooks
    const pollTimer = setInterval(() => {
      fetchServerState();
    }, 5000);
    return () => clearInterval(pollTimer);
  }, [fetchServerState]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleCreateInbox = async (payload: {
    prefix: string;
    domainId: string;
    ttlMinutes: number;
    label: string;
  }): Promise<TempInbox | null> => {
    const res = await fetch('/api/v1/inboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create temp inbox.');
    }
    await fetchServerState();
    showNotice(`Created temp inbox ${data.inbox.address}`);
    return data.inbox;
  };

  const handleDeleteInbox = async (id: string) => {
    await fetch(`/api/v1/inboxes/${id}`, { method: 'DELETE' });
    if (selectedInboxId === id) {
      setSelectedInboxId('all');
    }
    await fetchServerState();
  };

  const handleToggleMessageMeta = async (
    id: string,
    patch: { read?: boolean; starred?: boolean }
  ) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
    await fetch(`/api/v1/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  };

  const handleDeleteMessage = async (id: string) => {
    await fetch(`/api/v1/messages/${id}`, { method: 'DELETE' });
    await fetchServerState();
  };

  const handleAddDomain = async (payload: {
    domain: string;
    description: string;
    catchAll: boolean;
  }): Promise<CustomDomain | null> => {
    const res = await fetch('/api/v1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to connect domain.');
    }
    await fetchServerState();
    showNotice(`Connected custom domain ${data.domain.domain}`);
    return data.domain;
  };

  const handleVerifyDomain = async (id: string, mode: 'cloudflare' | 'dns' = 'cloudflare') => {
    const res = await fetch(`/api/v1/domains/${id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json();
    await fetchServerState();
    if (data.domain) {
      showNotice(
        data.domain.status === 'verified'
          ? `Domain ${data.domain.domain} is active and ready to receive mail`
          : `Checked DNS records for ${data.domain.domain}`
      );
    }
  };

  const handleToggleCatchAll = async (id: string, catchAll: boolean) => {
    await fetch(`/api/v1/domains/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catchAll }),
    });
    await fetchServerState();
  };

  const handleDeleteDomain = async (id: string) => {
    await fetch(`/api/v1/domains/${id}`, { method: 'DELETE' });
    await fetchServerState();
  };

  const handleCreateWebhook = async (payload: {
    name: string;
    url: string;
    domainId: string;
    events: WebhookEventType[];
  }): Promise<WebhookEndpoint | null> => {
    const res = await fetch('/api/v1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create webhook.');
    }
    await fetchServerState();
    showNotice(`Registered webhook "${data.webhook.name}"`);
    return data.webhook;
  };

  const handleToggleWebhook = async (id: string, active: boolean) => {
    await fetch(`/api/v1/webhooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    await fetchServerState();
  };

  const handleDeleteWebhook = async (id: string) => {
    await fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
    await fetchServerState();
  };

  const handleCreateApiKey = async (name: string) => {
    await fetch('/api/v1/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await fetchServerState();
    showNotice(`Created API key "${name}"`);
  };

  const handleDeleteApiKey = async (id: string) => {
    await fetch(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
    await fetchServerState();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#inboxes"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('inboxes');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0"
        >
          MailRelay
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav
          aria-label="Primary Workspace Navigation"
          className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto"
        >
          <a
            href="#inboxes"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('inboxes');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'inboxes'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Inboxes ({inboxes.length})
          </a>
          <a
            href="#domains"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('domains');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'domains'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Domains ({domains.length})
          </a>
          <a
            href="#webhooks"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('webhooks');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'webhooks'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Webhooks ({webhooks.length})
          </a>
          <a
            href="#api"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('api');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'api'
                ? 'border-blue-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            API & SDK
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setActiveSection('domains')}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Connect Domain
          </button>
        </div>
      </header>

      {/* Action Confirmation Banner */}
      {bannerNotice && (
        <div
          role="status"
          className="bg-slate-900 text-white px-6 py-2 text-xs font-medium flex items-center justify-between"
        >
          <span>{bannerNotice}</span>
          <button
            type="button"
            onClick={() => setBannerNotice(null)}
            className="text-slate-400 hover:text-white text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
        {activeSection === 'inboxes' && (
          <InboxesView
            domains={domains}
            inboxes={inboxes}
            messages={messages}
            selectedInboxId={selectedInboxId}
            onSelectInbox={setSelectedInboxId}
            selectedMessageId={selectedMessageId}
            onSelectMessage={setSelectedMessageId}
            onCreateInbox={handleCreateInbox}
            onDeleteInbox={handleDeleteInbox}
            onToggleMessageMeta={handleToggleMessageMeta}
            onDeleteMessage={handleDeleteMessage}
            onNavigateToDomains={() => setActiveSection('domains')}
            onRefreshStream={fetchServerState}
            nowTick={nowTick}
          />
        )}

        {activeSection === 'domains' && (
          <DomainsView
            domains={domains}
            apiKeys={apiKeys}
            onAddDomain={handleAddDomain}
            onVerifyDomain={handleVerifyDomain}
            onToggleCatchAll={handleToggleCatchAll}
            onDeleteDomain={handleDeleteDomain}
          />
        )}

        {activeSection === 'webhooks' && (
          <WebhooksView
            domains={domains}
            webhooks={webhooks}
            deliveries={deliveries}
            onCreateWebhook={handleCreateWebhook}
            onToggleWebhook={handleToggleWebhook}
            onDeleteWebhook={handleDeleteWebhook}
          />
        )}

        {activeSection === 'api' && (
          <ApiConsoleView
            domains={domains}
            inboxes={inboxes}
            apiKeys={apiKeys}
            onCreateApiKey={handleCreateApiKey}
            onDeleteApiKey={handleDeleteApiKey}
            onRefreshState={fetchServerState}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>MailRelay · Custom Domain Temp Mail, OTP Parser & Webhook Engine</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveSection('api')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              REST API (/api/v1)
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/v1/clear', { method: 'POST' });
                await fetchServerState();
                showNotice('Cleared all workspace data.');
              }}
              className="hover:text-red-600 transition-colors cursor-pointer"
            >
              Clear All Data
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
