"use client";

import React from 'react';
import { Plus, History, Settings, MoreHorizontal } from 'lucide-react';

interface ChatHistoryItem {
  id: string;
  title: string;
  timestamp: string;
}

export const Sidebar = ({ 
  history, 
  onNewChat, 
  onSelectChat,
  activeChatId 
}: { 
  history: ChatHistoryItem[], 
  onNewChat: () => void, 
  onSelectChat: (id: string) => void,
  activeChatId?: string 
}) => {
  return (
    <aside className="w-80 h-full bg-black/40 backdrop-blur-3xl border-r border-white/10 flex flex-col p-4">
      {/* New Chat Button */}
      <button 
        onClick={onNewChat}
        className="w-full flex items-center justify-center gap-2 p-3 mb-6 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-all transform hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(37,99,235,0.3)]"
      >
        <Plus size={18} />
        New Session
      </button>

      {/* History List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest px-2 mb-2 flex items-center gap-2">
          <History size={12} /> Recent History
        </h3>
        
        {history.map((item) => (
          <div 
            key={item.id}
            onClick={() => onSelectChat(item.id)}
            className={`
              group w-full flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all
              ${activeChatId === item.id ? 'bg-white/10 border border-white/20' : 'hover:bg-white/5 border border-transparent'}
            `}
          >
            <div className="flex-1 truncate">
              <p className="text-sm font-medium text-white/90 truncate">{item.title}</p>
              <p className="text-[10px] text-white/40 mt-0.5">{item.timestamp}</p>
            </div>
            <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded-md transition-all">
              <MoreHorizontal size={14} className="text-white/60" />
            </button>
          </div>
        ))}
      </div>

      {/* Footer Settings */}
      <div className="mt-auto pt-4 border-t border-white/5">
        <button className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all text-white/60 hover:text-white">
          <Settings size={18} />
          <span className="text-sm font-medium">Settings & API</span>
        </button>
      </div>
    </aside>
  );
};
