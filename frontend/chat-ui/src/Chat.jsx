import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import NeuralBackground from "./NeuralBackground";
import "./App.css";

const STORAGE_KEY = "ehan_ai_messages";
const API_BASE = import.meta.env.VITE_API_BASE || "";

function formatTime(date) {
  return date?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function loadMessages() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    return JSON.parse(saved).map((m) => ({ ...m, time: new Date(m.time) }));
  } catch {
    return [];
  }
}

// ── Code block with copy button ──────────────────────────────────────────────
function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="code-block-wrap">
      <div className="code-block-bar">
        <span className="code-lang-badge">{language || "code"}</span>
        <button className="code-copy-btn" onClick={copy}>
          {copied ? (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg> Copied</>
          ) : (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2"/></svg> Copy</>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: "0 0 10px 10px", fontSize: "13px", background: "rgba(0,0,0,0.55)" }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

// ── Markdown renderer config ─────────────────────────────────────────────────
const mdComponents = {
  code({ inline, className, children, ...props }) {
    const lang = /language-(\w+)/.exec(className || "")?.[1];
    const code = String(children).replace(/\n$/, "");
    if (!inline && lang) return <CodeBlock language={lang}>{code}</CodeBlock>;
    return <code className="inline-code" {...props}>{children}</code>;
  },
};

export default function Chat() {
  const [messages, setMessages]     = useState(loadMessages);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [copiedMsgId, setCopiedMsgId]     = useState(null);

  const messagesEndRef  = useRef(null);
  const messagesAreaRef = useRef(null);
  const textareaRef     = useRef(null);
  const abortRef        = useRef(null);
  const streamingIdRef  = useRef(null);

  // Persist to sessionStorage
  useEffect(() => {
    const toSave = messages.filter((m) => m.text); // skip empty streaming placeholders
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [messages]);

  // Scroll to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, loading]);

  // Show/hide scroll-to-bottom button
  const handleScroll = () => {
    const el = messagesAreaRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 180);
  };

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  // Keyboard shortcut: Cmd/Ctrl + K → focus input
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-focus on mount
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // ── Core send (streaming) ────────────────────────────────────────────────
  const sendMessage = useCallback(async (userText, addUserMsg = true) => {
    if (!userText?.trim() || isStreaming) return;
    const text = userText.trim();
    setInput("");
    setLoading(true);

    const botId  = Date.now() + 1;
    const botMsg = { id: botId, role: "bot", text: "", time: new Date(), streaming: true };
    streamingIdRef.current = botId;

    if (addUserMsg) {
      const userMsg = { id: Date.now(), role: "user", text, time: new Date() };
      setMessages((p) => [...p, userMsg, botMsg]);
    } else {
      setMessages((p) => [...p, botMsg]);
    }

    abortRef.current = new AbortController();

    try {
      // ── Build previous context ──
      // filter out errors, ongoing streams, or system placeholders; limit to last 8 messages
      const historyMsg = messages
        .filter(m => !m.isError && m.text && !m.streaming)
        .slice(-8)
        .map(m => ({
          role: m.role === "bot" ? "assistant" : "user",
          content: String(m.text)
        }));

      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyMsg }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        setMessages((p) =>
          p.map((m) => m.id === botId ? { ...m, text: `Server error (${res.status}). Please try again.`, isError: true, streaming: false } : m)
        );
        setLoading(false);
        setIsStreaming(false);
        streamingIdRef.current = null;
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let firstChunk  = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const { delta } = JSON.parse(payload);
            if (delta) {
              if (firstChunk) { setLoading(false); setIsStreaming(true); firstChunk = false; }
              accumulated += delta;
              setMessages((p) =>
                p.map((m) => m.id === botId ? { ...m, text: accumulated, streaming: false } : m)
              );
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages((p) =>
          p.map((m) => m.id === botId ? { ...m, text: "Connection error. Please try again.", isError: true, streaming: false } : m)
        );
      }
    }

    setLoading(false);
    setIsStreaming(false);
    streamingIdRef.current = null;
  }, [isStreaming]);

  const handleSend = () => sendMessage(input);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setLoading(false);
  };

  const clearHistory = () => {
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  const copyMessage = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const regenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || isStreaming) return;
    setMessages((p) => p.filter((m) => !(m.role === "bot" && p.indexOf(m) === p.length - 1)));
    sendMessage(lastUser.text, false);
  };

  const isLastBotMessage = (m, i) =>
    m.role === "bot" && i === messages.length - 1;

  return (
    <div className="chat-wrapper">
      <NeuralBackground />

      <div className="chat-container">
        {/* ── Header ── */}
        <div className="chat-header">
          <div className="header-left">
            <div className="ai-logo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="header-text">
              <h1 className="header-title">Ehan AI</h1>
              <span className="header-status">
                <span className="status-dot" />
                {isStreaming ? "Generating…" : "Online"}
              </span>
            </div>
          </div>
          <div className="header-actions">
            {messages.length > 0 && (
              <button className="clear-btn" onClick={clearHistory} title="Clear chat  (or Ctrl+L)">New Chat</button>
            )}
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="chat-messages" ref={messagesAreaRef} onScroll={handleScroll}>
          {messages.length === 0 && !loading && (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="54" height="54" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="url(#eg)" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M2 17L12 22L22 17" stroke="url(#eg)" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M2 12L12 17L22 12" stroke="url(#eg)" strokeWidth="1.5" strokeLinejoin="round" />
                  <defs><linearGradient id="eg" x1="2" y1="2" x2="22" y2="22"><stop stopColor="#00d4ff"/><stop offset="1" stopColor="#a855f7"/></linearGradient></defs>
                </svg>
              </div>
              <h2 className="empty-title">How can I help you today?</h2>
              <p className="empty-sub">Ask anything — code, math, writing, analysis.</p>
              <div className="feature-grid">
                {[
                  { icon: "⚡", title: "Fast answers", desc: "Instant replies with caching" },
                  { icon: "🧠", title: "Deep reasoning", desc: "Explains complex topics clearly" },
                  { icon: "💻", title: "Code generation", desc: "Any language with syntax highlight" },
                  { icon: "📊", title: "Data analysis", desc: "Tables, math, structured output" },
                ].map((f) => (
                  <div key={f.title} className="feature-card">
                    <span className="feature-icon">{f.icon}</span>
                    <strong>{f.title}</strong>
                    <span>{f.desc}</span>
                  </div>
                ))}
              </div>
              <div className="suggestion-chips">
                {["Explain quantum computing", "Write a Python script", "Debug my code"].map((s) => (
                  <button key={s} className="chip" onClick={() => { setInput(s); textareaRef.current?.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={m.id ?? i} className={`msg-row ${m.role}`}>
              {m.role === "bot" && (
                <div className="bot-avatar">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
              <div className="msg-col">
                <div className={`msg-bubble ${m.role}${m.isError ? " error" : ""}`}>
                  {m.streaming ? (
                    <div className="typing-dot-wrap"><span /><span /><span /></div>
                  ) : (
                    <div className="msg-body">
                      <ReactMarkdown components={mdComponents}>{m.text}</ReactMarkdown>
                    </div>
                  )}
                  <span className="msg-time">{formatTime(m.time)}</span>
                </div>

                {/* Message action bar */}
                {!m.streaming && m.text && (
                  <div className={`msg-actions ${m.role}`}>
                    <button
                      className="action-btn"
                      onClick={() => copyMessage(m.id, m.text)}
                      title="Copy message"
                    >
                      {copiedMsgId === m.id ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2"/></svg>
                      )}
                    </button>
                    {m.role === "bot" && isLastBotMessage(m, i) && !isStreaming && (
                      <button className="action-btn" onClick={regenerate} title="Regenerate response">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator — only show if no streaming bot message exists yet */}
          {loading && !messages.some((m) => m.streaming) && (
            <div className="msg-row bot">
              <div className="bot-avatar">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="msg-bubble bot">
                <div className="typing-dot-wrap"><span /><span /><span /></div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Scroll-to-bottom floating button */}
        {showScrollBtn && (
          <button className="scroll-btn" onClick={() => scrollToBottom()} title="Scroll to bottom">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        {/* ── Input ── */}
        <div className="chat-input-area">
          <div className="input-shell">
            <div className="scan-line" />
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Ehan AI…  (⌘K to focus)"
              rows={1}
              disabled={loading}
            />
            {input.length > 0 && (
              <span className="char-count">{input.length}</span>
            )}
            {isStreaming ? (
              <button className="stop-btn" onClick={stopGeneration} title="Stop generating">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                </svg>
              </button>
            ) : (
              <button
                className={`send-btn${!input.trim() || loading ? " send-disabled" : ""}`}
                onClick={handleSend}
                disabled={!input.trim() || loading}
                aria-label="Send message"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
          <p className="input-hint">Enter to send · Shift+Enter for new line · ⌘K to focus</p>
        </div>
      </div>
    </div>
  );
}
