import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner } from '../../components/ui';
import { Icon } from '../../components/icons';

interface ChatResult {
  conversationId: string;
  reply: string;
  toolCalls: { name: string; input: unknown }[];
}
interface Msg { role: 'user' | 'assistant'; content: string; tools?: string[] }

const SUGGESTIONS = [
  'Give me a 30-day summary of the network.',
  'Which offers have the highest margin this month?',
  'Are there any open fraud alerts I should look at?',
  'Top publishers by conversions in the last 7 days.',
];

export default function AiOps() {
  const status = useQuery<{ configured: boolean }>('/api/ai/status');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    try {
      const res = await api.post<ChatResult>('/api/ai/chat', { message: text, ...(conversationId ? { conversationId } : {}) });
      setConversationId(res.conversationId);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, tools: res.toolCalls.map((t) => t.name) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(input); };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      <PageHeader title="AI Ops" subtitle="Ask about your network in plain language. Numbers come from your real data — never estimated." />

      {status.loading ? <div className="grid flex-1 place-items-center"><Spinner /></div>
        : status.data && !status.data.configured ? (
          <div className="card border-dashed">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700 ">Setup</span>
              <span className="text-sm font-medium">AI is not configured yet</span>
            </div>
            <p className="mt-2 text-small text-fg-secondary">
              Add <code className="font-mono text-tiny">ANTHROPIC_API_KEY</code> to the backend environment to enable the AI ops assistant. Everything else is ready.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface/50 p-4">
              {messages.length === 0 && (
                <div className="grid h-full place-items-center">
                  <div className="max-w-md text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white"><Icon.spark /></div>
                    <p className="mt-3 text-small text-fg-secondary">Ask anything about your network. Try one of these:</p>
                    <div className="mt-4 grid gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} onClick={() => void send(s)} className="rounded-lg border border-border px-3 py-2 text-left text-small hover:border-accent">{s}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-small ${m.role === 'user' ? 'bg-accent text-white' : 'border border-border bg-surface'}`}>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    {m.tools && m.tools.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.tools.map((t, j) => <span key={j} className="rounded bg-page px-1.5 py-0.5 text-[10px] font-medium text-fg-secondary">{t}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && <div className="flex justify-start"><div className="rounded-2xl border border-border bg-surface px-4 py-3"><Spinner /></div></div>}
              <div ref={endRef} />
            </div>

            {error && <p className="mt-2 text-small text-danger-text">{error}</p>}
            <form onSubmit={onSubmit} className="mt-3 flex gap-2">
              <input className="input flex-1" placeholder="Ask about clicks, conversions, margin, alerts…" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
              <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>Send</button>
            </form>
          </>
        )}
    </div>
  );
}
