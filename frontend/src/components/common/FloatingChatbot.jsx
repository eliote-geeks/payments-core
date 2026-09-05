import React, { useEffect, useRef, useState } from "react";
import { Bot, Send, X, User as UserIcon, RefreshCw } from "lucide-react";
import { api } from "../../api/client";

async function askKoboAI(message, history) {
  const { data } = await api.post("/chat", { message, history });
  return data.reply;
}

export function FloatingChatbot() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [msgs, setMsgs] = useState([
    { role: "assistant", text: "Bonjour ! Je suis l'assistant Kobo. Comment puis-je vous aider ?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setTimeout(() => inputRef.current?.focus(), 200);
    } else {
      const t = setTimeout(() => setVisible(false), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, [open, msgs.length, loading]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", text };
    setMsgs((prev) => [...prev, userMsg]);
    setInput("");
    setError(null);
    setLoading(true);

    // Historique pour le contexte (6 derniers échanges)
    const history = msgs
      .filter((m) => m.role !== "system")
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.text }));

    try {
      const reply = await askKoboAI(text, history);
      setMsgs((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch (err) {
      const detail = err?.response?.data?.detail || "Je rencontre un problème. Réessayez ou contactez le support.";
      setError(detail);
      setMsgs((prev) => [...prev, { role: "assistant", text: detail, isError: true }]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setMsgs([{ role: "assistant", text: "Bonjour ! Je suis l'assistant Kobo. Comment puis-je vous aider ?" }]);
    setError(null);
    setInput("");
  };

  const hasUnread = msgs.length > 1 && !open;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 h-[52px] w-[52px] rounded-full bg-primary text-white shadow-xl flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-primary/40 ${open ? "rotate-90" : "rotate-0"}`}
        aria-label="Assistant Kobo"
      >
        <div className="transition-all duration-300">
          {open ? <X size={20} /> : <Bot size={22} />}
        </div>
        {hasUnread && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-green-500 border-2 border-white animate-pulse" />
        )}
      </button>

      {/* Chat window */}
      {visible && (
        <div
          className={`fixed bottom-20 right-4 md:bottom-24 md:right-6 z-50 w-[calc(100vw-32px)] max-w-[340px] shadow-2xl rounded-2xl overflow-hidden border border-border bg-background flex flex-col transition-all duration-250 origin-bottom-right ${
            open ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2 pointer-events-none"
          }`}
          style={{ maxHeight: 500 }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-primary to-primary/80 text-white shrink-0">
            <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold leading-tight">Assistant Kobo</p>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                <p className="text-[10px] opacity-80">Propulsé par FatherPaul AI</p>
              </div>
            </div>
            <button onClick={reset} title="Nouvelle conversation" className="opacity-60 hover:opacity-100 transition-opacity mr-1">
              <RefreshCw size={13} />
            </button>
            <button onClick={() => setOpen(false)} className="opacity-60 hover:opacity-100 transition-opacity">
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ minHeight: 220, maxHeight: 360 }}>
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 items-end ${m.role === "user" ? "justify-end" : "justify-start"}`}
                style={{ animation: "fadeSlideUp 0.2s ease" }}
              >
                {m.role === "assistant" && (
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mb-0.5">
                    <Bot size={11} className="text-primary" />
                  </div>
                )}
                <div className={`px-3 py-2 rounded-2xl text-xs leading-relaxed max-w-[82%] shadow-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-primary text-white rounded-br-sm"
                    : m.isError
                      ? "bg-destructive/10 text-destructive rounded-bl-sm"
                      : "bg-secondary text-foreground rounded-bl-sm"
                }`}>
                  {m.text}
                </div>
                {m.role === "user" && (
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mb-0.5">
                    <UserIcon size={11} className="text-primary" />
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex gap-2 items-end justify-start" style={{ animation: "fadeSlideUp 0.2s ease" }}>
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot size={11} className="text-primary" />
                </div>
                <div className="px-3 py-2.5 rounded-2xl rounded-bl-sm bg-secondary flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={send} className="border-t border-border px-3 py-2.5 flex gap-2 shrink-0 bg-background">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question…"
              disabled={loading}
              className="flex-1 text-xs bg-secondary rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-primary/40 transition-shadow disabled:opacity-60"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="h-8 w-8 rounded-xl bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 transition-all disabled:scale-95"
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      )}

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
