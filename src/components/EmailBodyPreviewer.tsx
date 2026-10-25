import React, { useState, useMemo } from 'react';
import {
  Eye,
  FileText,
  FileCode,
  ListTree,
  Download,
  Copy,
  Check,
  Monitor,
  Smartphone,
  ShieldCheck,
} from 'lucide-react';
import {
  MailMessage,
  sanitizeAndWrapEmailHtml,
  buildEmlFilename,
} from '../lib/mailEngine';

interface EmailBodyPreviewerProps {
  message: MailMessage;
}

type PreviewTab = 'html' | 'text' | 'mime' | 'headers';
type PreviewViewport = 'desktop' | 'mobile';

export function EmailBodyPreviewer({ message }: EmailBodyPreviewerProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>('html');
  const [viewportMode, setViewportMode] = useState<PreviewViewport>('desktop');
  const [copiedMime, setCopiedMime] = useState(false);

  const sanitizedSrcDoc = useMemo(
    () => sanitizeAndWrapEmailHtml(message.htmlBody || `<p>${message.textBody}</p>`),
    [message.htmlBody, message.textBody]
  );

  const emlFilename = useMemo(
    () => buildEmlFilename(message.subject, message.id),
    [message.subject, message.id]
  );

  const handleDownloadEml = () => {
    const blob = new Blob([message.rawMime], { type: 'message/rfc822;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = emlFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCopyMime = () => {
    navigator.clipboard?.writeText(message.rawMime).catch(() => {});
    setCopiedMime(true);
    setTimeout(() => setCopiedMime(false), 1600);
  };

  return (
    <div data-testid="email-body-previewer" className="flex flex-col">
      {/* Previewer Controls & Download as EML Toolbar */}
      <div className="px-5 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-white">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('html')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'html'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Rendered HTML</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('text')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'text'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Plain Text</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mime')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'mime'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Raw MIME</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('headers')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'headers'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            <span>Headers</span>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeTab === 'html' && (
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setViewportMode('desktop')}
                aria-label="Desktop email preview width"
                title="Desktop width (100%)"
                className={`p-1 rounded transition-colors cursor-pointer ${
                  viewportMode === 'desktop'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewportMode('mobile')}
                aria-label="Mobile email preview width"
                title="Mobile width (375px)"
                className={`p-1 rounded transition-colors cursor-pointer ${
                  viewportMode === 'mobile'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleDownloadEml}
            aria-label="Download as EML"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span>Download as EML</span>
          </button>
        </div>
      </div>

      {/* Sandboxed Email Body Viewport */}
      <div className="p-5 min-h-[360px] max-h-[480px] overflow-y-auto bg-slate-50/50">
        {activeTab === 'html' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Sandboxed iframe preview (scripts & inline event handlers blocked)
              </span>
              <span className="font-mono">{emlFilename}</span>
            </div>

            <div
              className={`mx-auto bg-white border border-slate-200 rounded-lg overflow-hidden transition-all ${
                viewportMode === 'mobile' ? 'max-w-[375px]' : 'w-full'
              }`}
            >
              <iframe
                title={`Sandboxed Email HTML Preview: ${message.subject}`}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                srcDoc={sanitizedSrcDoc}
                data-testid="email-preview-iframe"
                className="w-full min-h-[320px] border-0 bg-white block"
              />
            </div>
          </div>
        )}

        {activeTab === 'text' && (
          <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed bg-white p-4 rounded-lg border border-slate-200">
            {message.textBody}
          </pre>
        )}

        {activeTab === 'mime' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                RFC 5322 Multipart MIME Source ({emlFilename})
              </span>
              <button
                type="button"
                onClick={handleCopyMime}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
              >
                {copiedMime ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied MIME</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Raw MIME</span>
                  </>
                )}
              </button>
            </div>
            <pre className="text-[11px] font-mono text-slate-800 whitespace-pre-wrap break-all leading-relaxed bg-white p-4 rounded-lg border border-slate-200">
              {message.rawMime}
            </pre>
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden bg-white">
            {Object.entries(message.headers).map(([key, value]) => (
              <div
                key={key}
                className="grid grid-cols-12 gap-2 px-3.5 py-2.5 text-xs hover:bg-slate-50"
              >
                <div className="col-span-4 font-mono font-semibold text-slate-700 break-all">
                  {key}
                </div>
                <div className="col-span-8 font-mono text-slate-600 break-all">
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
