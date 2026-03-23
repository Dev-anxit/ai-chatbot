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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const dataStr = decoder.decode(value);
        const lines = dataStr.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace('data: ', '');
            if (jsonStr === '[DONE]') break;

            try {
              const { text, error: apiError } = JSON.parse(jsonStr);
              if (apiError) throw new Error(apiError);
              if (text) {
                fullText += text;
                onChunk(text);
              }
            } catch (e) {
              // Ignore partial JSON chunks
            }
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
