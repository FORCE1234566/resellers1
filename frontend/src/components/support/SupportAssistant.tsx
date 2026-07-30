import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { HelpCircle, MessageCircle, Send, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { readStoreRef } from '@/lib/reseller-store-ref';
import {
  type AssistantSessionState,
  type ChatMessage,
  type ChatResponse,
  resolveAssistantContext,
  sendSupportMessage,
} from '@/lib/support-assistant';
import { cn } from '@/lib/utils';

const INITIAL_SESSION: AssistantSessionState = { step: 'idle' };

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Shrink/reposition panel when the mobile keyboard opens (iOS Safari). */
function useMobileViewportLayout(open: boolean) {
  const [layout, setLayout] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setLayout(null);
      return;
    }

    const mq = window.matchMedia('(max-width: 639px)');
    const vv = window.visualViewport;

    const sync = () => {
      if (!mq.matches || !vv) {
        setLayout(null);
        return;
      }
      setLayout({ top: vv.offsetTop, height: vv.height });
    };

    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    mq.addEventListener('change', sync);

    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      mq.removeEventListener('change', sync);
    };
  }, [open]);

  return layout;
}

export default function SupportAssistant() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const storeSlug = readStoreRef(searchParams, pathname);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<AssistantSessionState>(INITIAL_SESSION);
  const [supportSessionToken, setSupportSessionToken] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [actions, setActions] = useState<ChatResponse['actions']>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const greetedRef = useRef(false);
  const mobileLayout = useMobileViewportLayout(open);

  const context = resolveAssistantContext(
    pathname,
    storeSlug,
    user?.role,
    user?.id
  );

  const appendAssistant = useCallback((replies: string[]) => {
    setMessages((prev) => [
      ...prev,
      ...replies.map((text) => ({ id: uid(), role: 'assistant' as const, text })),
    ]);
  }, []);

  const runChat = useCallback(
    async (payload: {
      message?: string;
      action?: string;
      resetSession?: boolean;
    }) => {
      setLoading(true);
      try {
        const res = await sendSupportMessage({
          message: payload.message || '',
          action: payload.action,
          context,
          session: payload.resetSession ? INITIAL_SESSION : session,
          supportSessionToken,
        });
        setSession(res.session);
        if (res.sessionToken) setSupportSessionToken(res.sessionToken);
        appendAssistant(res.replies);
        setActions(res.actions);
      } catch (err) {
        appendAssistant([err instanceof Error ? err.message : 'Something went wrong']);
      } finally {
        setLoading(false);
      }
    },
    [appendAssistant, context, session, supportSessionToken]
  );

  useEffect(() => {
    if (!open || greetedRef.current) return;
    greetedRef.current = true;
    void runChat({ message: '', resetSession: true });
  }, [open, runChat]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, loading, mobileLayout]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    setSession(INITIAL_SESSION);
    setSupportSessionToken(undefined);
    setMessages([]);
    setActions([]);
    greetedRef.current = false;
  }, [pathname, storeSlug, user?.role]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setMessages((prev) => [...prev, { id: uid(), role: 'user', text }]);
    setInput('');
    void runChat({ message: text });
  };

  const onAction = (actionId: string, label: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: 'user', text: label }]);
    void runChat({ action: actionId });
  };

  const isDashboard =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/agent') ||
    pathname.startsWith('/reseller');

  const isHomeLanding = pathname === '/' && !storeSlug;

  const isStorePage = pathname.startsWith('/store/');

  const fabClass = isDashboard
    ? 'bottom-5 right-3 sm:bottom-6 sm:right-6 w-11 h-11 bg-navy-light border border-navy-border text-gold hover:border-gold/50'
    : isHomeLanding
      ? 'bottom-24 left-3 sm:bottom-28 sm:left-6 w-12 h-12 bg-gold text-navy hover:bg-gold-hover'
      : 'bottom-5 left-3 sm:bottom-6 sm:left-6 w-12 h-12 bg-gold text-navy hover:bg-gold-hover';

  const panelAnchorClass = isDashboard
    ? 'sm:bottom-20 sm:right-3 sm:right-6'
    : isHomeLanding
      ? 'sm:bottom-36 sm:left-3 sm:left-6'
      : 'sm:bottom-20 sm:left-3 sm:left-6';

  const panelStyle = mobileLayout
    ? { top: mobileLayout.top, height: mobileLayout.height, left: 0, right: 0, width: '100%' }
    : undefined;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open help assistant"
          className={cn(
            'fixed z-50 flex items-center justify-center rounded-full transition-all duration-200',
            isStorePage ? 'shadow-none' : 'shadow-lg',
            isHomeLanding && 'shadow-gold/25',
            fabClass
          )}
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-[55] bg-black/60 sm:hidden"
            aria-hidden
            onClick={() => setOpen(false)}
          />

          <div
            className={cn(
              'fixed z-[60] flex flex-col bg-navy-light border-navy-border shadow-2xl shadow-black/40 overflow-hidden',
              mobileLayout ? 'border-0 rounded-none' : cn('rounded-2xl border', panelAnchorClass, 'w-[min(100vw-1.5rem,380px)] h-[min(70dvh,520px)]')
            )}
            style={panelStyle}
            role="dialog"
            aria-label="Help Assistant"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-navy-border bg-navy/80 shrink-0 safe-top">
              <MessageCircle className="w-5 h-5 text-gold shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">Help Assistant</p>
                <p className="text-[11px] text-gray-500 truncate">topdealsgh support</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close help assistant"
                className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 space-y-2.5"
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'max-w-[92%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'ml-auto bg-gold/15 text-gold border border-gold/25'
                      : 'mr-auto bg-white/5 text-gray-200 border border-white/10'
                  )}
                >
                  {m.text}
                </div>
              ))}
              {loading && (
                <div className="mr-auto px-3 py-2 rounded-xl text-sm text-gray-500 bg-white/5 border border-white/10">
                  Typing…
                </div>
              )}
            </div>

            {actions.length > 0 && (
              <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0 max-h-24 overflow-y-auto">
                {actions.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={loading}
                    onClick={() => onAction(a.id, a.label)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-violet-500/15 text-violet-200 border border-violet-400/30 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={onSubmit}
              className="p-3 border-t border-navy-border flex gap-2 shrink-0 safe-bottom bg-navy-light"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  window.setTimeout(() => {
                    inputRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    if (scrollRef.current) {
                      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    }
                  }, 300);
                }}
                placeholder="Type your question…"
                enterKeyHint="send"
                autoComplete="off"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-navy/80 border border-navy-border text-base sm:text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/40"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="shrink-0 p-2.5 rounded-lg bg-gold text-navy disabled:opacity-40 hover:bg-gold-hover transition-colors"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
