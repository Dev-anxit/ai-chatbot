"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Sidebar } from '../components/Sidebar';
import { useStreaming, ChatMessage } from '../hooks/useStreaming';
import { Send, Sparkles, User, Database, ArrowRight } from 'lucide-react';

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([
    { id: '1', title: 'Deep Knowledge Retrieval', timestamp: 'Today, 2:45 PM' },
    { id: '2', title: 'System Architecture Design', timestamp: 'Yesterday' }
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Connect to the Node/Express backend on port 5001
  const { streamResponse, isStreaming } = useStreaming("http://localhost:5001");

  // Auto-scroll logic
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMsg: ChatMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");

    // Start streaming from Node backend
    await streamResponse(
      newMessages,
      undefined, // Start of session
      (chunk) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last.role === 'model') {
            return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
          } else {
            return [...prev, { role: 'model', content: chunk }];
          }
        });
      }
    );
  };

  return (
    <div className="flex w-full h-screen bg-[#050505] text-white overflow-hidden selection:bg-blue-500/30">
      <Sidebar 
        history={history} 
        onNewChat={() => setMessages([])} 
        onSelectChat={(id) => console.log('Selected chat:', id)} 
      />

      <main className="flex-1 flex flex-col relative">
        {/* Header Ribbon */}
        <header className="h-16 border-b border-white/5 bg-black/20 backdrop-blur-3xl flex items-center justify-between px-8 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
            <h1 className="text-sm font-semibold tracking-wide text-white/80">Ehan AI <span className="text-white/20 px-2">|</span> <span className="text-blue-400">Node Nexus</span></h1>
          </div>
          <div className="flex items-center gap-4 text-white/40 hover:text-white transition-all cursor-pointer">
            <Database size={16} />
            <span className="text-[10px] font-medium tracking-tighter">CONNECTED TO MONGODB ATLAS</span>
          </div>
        </header>

        {/* Message Container */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-12 custom-scrollbar space-y-12"
        >
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center opacity-30 select-none">
              <Sparkles size={48} className="mb-4 text-blue-400 animate-bounce" />
              <p className="text-lg font-medium tracking-widest text-white/80">HOW CAN I ASSIST YOUR JOURNEY?</p>
            </div>
          )}

          {messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[70%] group relative ${m.role === 'user' ? 'ml-auto' : 'mr-auto'}`}>
                <div className={`
                   flex items-start gap-4 p-5 rounded-2xl border transition-all duration-500
                   ${m.role === 'user' 
                     ? 'bg-blue-600/10 border-blue-500/30 hover:bg-blue-600/15' 
                     : 'bg-white/5 border-white/10 hover:bg-white/10 shadow-[inner_0_0_20px_rgba(255,255,255,0.02)]'}
                `}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-white/10 ${m.role === 'user' ? 'bg-blue-600' : 'bg-pink-600 shadow-[0_0_15px_rgba(219,39,119,0.3)]'}`}>
                    {m.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                  </div>
                  <div className="flex-1 text-[15px] leading-relaxed font-light text-white/90">
                    {m.content}
                    {isStreaming && idx === messages.length - 1 && m.role === 'model' && (
                      <span className="inline-block w-1.5 h-4 ml-1 bg-white animate-pulse rounded-full align-middle" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Input Dock */}
        <footer className="h-28 flex items-center justify-center px-12 z-10 shrink-0">
          <div className="w-full max-w-4xl relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask Ehan AI about current news, code, or knowledge retrieval..."
              className="w-full py-5 px-8 pr-16 rounded-2xl bg-white/5 border border-white/10 focus:border-blue-500/50 outline-none transition-all placeholder:text-white/20 select-none backdrop-blur-lg group-hover:border-white/20"
            />
            <button 
              onClick={handleSend}
              disabled={isStreaming}
              className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-xl transition-all active:scale-95 ${isStreaming ? 'opacity-0 scale-50' : 'opacity-100 scale-100 bg-blue-600 hover:bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)]'}`}
            >
              {isStreaming ? <ArrowRight size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
