import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import NeuralBackground from "./NeuralBackground";
import "./App.css";

const SESSIONS_KEY = "ehan_ai_sessions";
const API_BASE = import.meta.env.VITE_API_BASE || "";

function stripAds(text) {
  return text
    .replace(/🌸.*?Pollinations.*?(?:\.|$)/gis, "")
    .replace(/\*\*Support Pollinations.*$/gim, "")
    .replace(/Support Pollinations.*$/gim, "")
    .replace(/Powered by Pollinations.*$/gim, "")
    .replace(/---\s*\n.*?Pollinations.*$/gims, "")
    .replace(/\n+\s*\*?\s*(?:Ad|Advertisement)\s*\*?\s*\n.*$/gims, "")
    .replace(/\[.*?pollinations.*?\].*$/gim, "")
    .trimEnd();
}

function formatTime(date) {
  return date?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function loadSessions() {
  try {
    let saved = localStorage.getItem(SESSIONS_KEY);
    if (!saved) {
      // Migrate old chats
      const old = sessionStorage.getItem("ehan_ai_messages");
      if (old) {
        const msgs = JSON.parse(old).map(m => ({ ...m, time: new Date(m.time) }));
        if (msgs.length > 0) {
          const newSession = {
            id: Date.now().toString(),
            title: msgs.find(m => m.role === 'user')?.text.slice(0,30) || "Old Chat",
            updatedAt: Date.now(),
            messages: msgs
          };
          localStorage.setItem(SESSIONS_KEY, JSON.stringify([newSession]));
          return [newSession];
        }
      }
      return [];
    }
    return JSON.parse(saved).map(s => ({
      ...s,
      messages: s.messages.map(m => ({ ...m, time: new Date(m.time) }))
    }));
  } catch {
    return [];
  }
}

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

const mdComponents = {
  code({ inline, className, children, ...props }) {
    const lang = /language-(\w+)/.exec(className || "")?.[1];
    const code = String(children).replace(/\n$/, "");
    if (!inline && lang) return <CodeBlock language={lang}>{code}</CodeBlock>;
    return <code className="inline-code" {...props}>{children}</code>;
  },
};

export default function Chat() {
  const [sessions, setSessions]           = useState(loadSessions);
  const [currentSessionId, setCurrentSessionId] = useState(() => sessions.length > 0 ? sessions[0].id : null);
  const [messages, setMessages]           = useState(() => sessions.length > 0 ? sessions[0].messages : []);
  
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [isStreaming, setIsStreaming]     = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [copiedMsgId, setCopiedMsgId]     = useState(null);
  const [reactions, setReactions]         = useState({});
  const [showClearModal, setShowClearModal] = useState(false);
  const [isListening, setIsListening]     = useState(false);
  const [speakingId, setSpeakingId]       = useState(null);
  const [sidebarOpen, setSidebarOpen]     = useState(false); // for mobile

  const messagesEndRef  = useRef(null);
  const messagesAreaRef = useRef(null);
  const textareaRef     = useRef(null);
  const abortRef        = useRef(null);
  const streamingIdRef  = useRef(null);

  // Sync messages to sessions array
  useEffect(() => {
    if (messages.length === 0) return; 
    
    let targetSessionId = currentSessionId;
    if (!targetSessionId) {
       targetSessionId = Date.now().toString();
       setCurrentSessionId(targetSessionId);
    }
    
    setSessions(prev => {
       const existingIdx = prev.findIndex(s => s.id === targetSessionId);
       let nextSessions = [...prev];
       
       let title = "New Chat";
       const firstUserMsg = messages.find(m => m.role === 'user');
       if (firstUserMsg) {
         title = firstUserMsg.text.slice(0, 30) + (firstUserMsg.text.length > 30 ? "..." : "");
       }

       if (existingIdx === -1) {
         nextSessions = [{ id: targetSessionId, title, updatedAt: Date.now(), messages }, ...nextSessions];
       } else {
         nextSessions[existingIdx] = { 
           ...nextSessions[existingIdx], 
           messages,
           updatedAt: Date.now(),
           title: nextSessions[existingIdx].title === "New Chat" ? title : nextSessions[existingIdx].title
         };
       }
       return nextSessions;
    });
  }, [messages, currentSessionId]);

  // Persist sessions
  useEffect(() => {
    const toSave = sessions.map(s => ({
      ...s,
      messages: s.messages.filter(m => m.text && !m.streaming)
    })).filter(s => s.messages.length > 0);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(toSave));
  }, [sessions]);

  const handleNewChat = () => {
    if (isStreaming) return;
    setCurrentSessionId(null);
    setMessages([]);
    setReactions({});
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const selectSession = (id) => {
    if (isStreaming) return;
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    setCurrentSessionId(id);
    setMessages(session.messages);
    setReactions({});
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const deleteSession = (e, id) => {
    e.stopPropagation();
    if (isStreaming) return;
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id || sessions.length === 1) {
      setCurrentSessionId(null);
      setMessages([]);
    }
  };

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, loading]);

  const handleScroll = () => {
    const el = messagesAreaRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 180);
  };

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.speechSynthesis?.cancel();
    };
  }, [messages.length]);

  useEffect(() => { textareaRef.current?.focus(); }, []);

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
              const cleanText = stripAds(accumulated);
              setMessages((p) =>
                p.map((m) => m.id === botId ? { ...m, text: cleanText, streaming: false } : m)
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
  }, [isStreaming, messages]);

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
    if (currentSessionId) {
       deleteSession({ stopPropagation:()=>{} }, currentSessionId);
    } else {
       setMessages([]);
    }
    setShowClearModal(false);
  };

  const copyMessage = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input is not supported in your browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    setIsListening(true);
    recognition.onresult = (e) => {
      setInput((prev) => prev + (prev ? " " : "") + e.results[0][0].transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const readAloud = (msgId, text) => {
    if (speakingId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const regenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || isStreaming) return;
    setMessages((p) => p.filter((m) => !(m.role === "bot" && p.indexOf(m) === p.length - 1)));
    sendMessage(lastUser.text, false);
  };

  const toggleReaction = (msgId, type) => {
    setReactions((prev) => {
      const current = prev[msgId];
      if (current === type) {
        const next = { ...prev };
        delete next[msgId];
        return next;
      }
      return { ...prev, [msgId]: type };
    });
  };

  const exportChat = () => {
    const text = messages
      .map((m) => `[${formatTime(m.time)}] ${m.role === "user" ? "You" : "Ehan AI"}: ${m.text}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ehan-ai-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLastBotMessage = (m, i) =>
    m.role === "bot" && i === messages.length - 1;

  const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0;

  return (
    <div className="app-layout">
      <NeuralBackground />

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <span className="header-title" style={{ fontSize: '18px' }}>Ehan AI</span>
          </div>
          
          <button className="sidebar-item new-chat" onClick={handleNewChat}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>New chat</span>
          </button>

          <button className="sidebar-item search-btn" onClick={() => alert("Search functionality coming soon!")}>
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
             <span>Search chats</span>
          </button>

          <button className="sidebar-item plugin-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>Images</span>
          </button>
          
          <button className="sidebar-item plugin-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/><rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/></svg>
            <span>Apps</span>
          </button>
          
          <div className="sidebar-divider"></div>

          <button className="sidebar-item plugin-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2a10 10 0 0110 10v4a2 2 0 01-2 2h-4v-6h4a8 8 0 10-16 0h4v6H4a2 2 0 01-2-2v-4a10 10 0 0110-10z" stroke="currentColor" strokeWidth="2"/></svg>
            <span>Codex</span>
          </button>

          <button className="sidebar-item plugin-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" strokeWidth="2"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="2"/></svg>
            <span>GPTs</span>
          </button>
        </div>

        <div className="sidebar-history">
          <div className="history-title">Recent Chats</div>
          {sessions.map(s => (
            <div key={s.id} className={`history-item-wrap ${currentSessionId === s.id ? 'active' : ''}`}>
               <button className="history-item" onClick={() => selectSession(s.id)}>
                 {s.title}
               </button>
               <button className="history-delete" onClick={(e) => deleteSession(e, s.id)} title="Delete Chat">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
               </button>
            </div>
          ))}
        </div>
      </div>

      {showClearModal && (
        <div className="modal-overlay" onClick={() => setShowClearModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 className="modal-title">Clear conversation?</h3>
            <p className="modal-desc">This will delete all messages in this chat. This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setShowClearModal(false)}>Cancel</button>
              <button className="modal-confirm" onClick={clearHistory}>Clear All</button>
            </div>
          </div>
        </div>
      )}

      <div className="chat-wrapper">
        <div className="chat-container">
          <div className="chat-header">
            <div className="header-left">
              <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 12h18M3 6h18M3 18h18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
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
                <>
                  <button className="export-btn" onClick={exportChat} title="Export chat">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button className="clear-btn" onClick={() => setShowClearModal(true)} title="Delete chat">Delete</button>
                </>
              )}
            </div>
          </div>

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
                <p className="empty-sub">Ask anything — I search the web in real-time for the latest info.</p>
                <div className="feature-grid">
                  {[
                    { icon: "🌐", title: "Real-time search", desc: "Live data from the web" },
                    { icon: "🧠", title: "Deep reasoning", desc: "Step-by-step explanations" },
                    { icon: "💻", title: "Code generation", desc: "Any language, syntax highlighted" },
                    { icon: "💬", title: "Context aware", desc: "Remembers your conversation" },
                  ].map((f) => (
                    <div className="feature-card" key={f.title}>
                      <span className="feature-icon">{f.icon}</span>
                      <strong>{f.title}</strong>
                      <span>{f.desc}</span>
                    </div>
                  ))}
                </div>
                <div className="suggestion-chips">
                  {[
                    "Latest news today",
                    "Write a Python script",
                    "Explain quantum computing",
                    "Current weather in Delhi",
                  ].map((s) => (
                    <button key={s} className="chip" onClick={() => sendMessage(s)}>
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
                      {m.role === "bot" && (
                        <>
                          <button
                            className={`action-btn${reactions[m.id] === "up" ? " reacted" : ""}`}
                            onClick={() => toggleReaction(m.id, "up")}
                            title="Good response"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={reactions[m.id] === "up" ? "#22c55e" : "none"}>
                              <path d="M7 22V11l3-8a2 2 0 014 0v3h5.5a2 2 0 012 2.3l-1.5 9A2 2 0 0118 19H7z" stroke={reactions[m.id] === "up" ? "#22c55e" : "currentColor"} strokeWidth="1.8" strokeLinejoin="round"/>
                              <path d="M3 11h2v11H3a1 1 0 01-1-1V12a1 1 0 011-1z" stroke={reactions[m.id] === "up" ? "#22c55e" : "currentColor"} strokeWidth="1.8"/>
                            </svg>
                          </button>
                          <button
                            className={`action-btn${reactions[m.id] === "down" ? " reacted-bad" : ""}`}
                            onClick={() => toggleReaction(m.id, "down")}
                            title="Bad response"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={reactions[m.id] === "down" ? "#ef4444" : "none"}>
                              <path d="M17 2v11l-3 8a2 2 0 01-4 0v-3H4.5a2 2 0 01-2-2.3l1.5-9A2 2 0 016 5h12z" stroke={reactions[m.id] === "down" ? "#ef4444" : "currentColor"} strokeWidth="1.8" strokeLinejoin="round"/>
                              <path d="M21 13h-2V2h2a1 1 0 011 1v9a1 1 0 01-1 1z" stroke={reactions[m.id] === "down" ? "#ef4444" : "currentColor"} strokeWidth="1.8"/>
                            </svg>
                          </button>
                          <button
                            className={`action-btn${speakingId === m.id ? " speaking" : ""}`}
                            onClick={() => readAloud(m.id, m.text)}
                            title={speakingId === m.id ? "Stop reading" : "Read aloud"}
                          >
                            {speakingId === m.id ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            )}
                          </button>
                        </>
                      )}
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

          {showScrollBtn && (
            <button className="scroll-btn" onClick={() => scrollToBottom()} title="Scroll to bottom">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}

          <div className="chat-input-area">
            <div className="quick-actions-bar">
              {[
                { label: "Summarize", text: "Summarize this in a few bullet points:\n\n" },
                { label: "Explain Code", text: "Explain how this code works:\n\n" },
                { label: "Fix Grammar", text: "Fix the grammar and rewrite professionally:\n\n" },
                { label: "Translate", text: "Translate the following to English:\n\n" }
              ].map(action => (
                <button key={action.label} className="quick-action-btn" onClick={() => { setInput(action.text); textareaRef.current?.focus(); }}>
                  {action.label}
                </button>
              ))}
            </div>
            <div className="input-shell">
              <div className="scan-line" />
              <button 
                className={`mic-btn${isListening ? " listening" : ""}`} 
                onClick={startListening}
                title={isListening ? "Listening..." : "Voice Input"}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="2"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Ehan AI…  (⌘K to focus)"
                rows={1}
              />
              {input.length > 0 && (
                <span className="char-count">{wordCount}w</span>
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
      
      {/* Mobile Sidebar overlay backdrop */}
      {sidebarOpen && window.innerWidth <= 768 && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)}></div>
      )}
    </div>
  );
}
