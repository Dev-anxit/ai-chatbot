import { useState, useCallback } from 'react';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export const useStreaming = (apiBase: string) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamResponse = useCallback(async (
    messages: ChatMessage[],
    conversationId: string | undefined,
    onChunk: (text: string) => void,
    onComplete?: (fullText: string) => void
  ) => {
    setIsStreaming(true);
    setError(null);
    let fullText = "";

    try {
      const response = await fetch(`${apiBase}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, conversationId }),
      });

      if (!response.ok || !response.body) throw new Error("Connection failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.error) throw new Error(parsed.error);
            // Handle both 'text' (node-backend) and 'delta' (python backend) keys
            const chunk = parsed.text || parsed.delta;
            if (chunk) {
              fullText += chunk;
              onChunk(chunk);
            }
          } catch (e) {
            // Ignore partial JSON chunks
          }
        }
      }

      if (onComplete) onComplete(fullText);

    } catch (err: any) {
      setError(err.message || "An error occurred");
      console.error(err);
    } finally {
      setIsStreaming(false);
    }
  }, [apiBase]);

  return { streamResponse, isStreaming, error };
};
