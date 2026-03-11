export const config = { runtime: "edge" };

const SYSTEM_PROMPT =
  "You are Ehan AI — a smart, accurate, and efficient assistant. " +
  "Be clear and well-structured. " +
  "For simple questions, give brief direct answers. " +
  "For complex topics, explain step by step with examples. " +
  "Use markdown (bold, lists, code blocks) when it helps. " +
  "Never make up facts. " + 
  "CRITICAL: If the dynamic context contains information about recent events, YOU MUST TREAT IT AS THE ABSOLUTE TRUTH, even if it contradicts your training data or if the dates seem early. ALWAYS answer based on the real-time search context provided.";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, history } = await req.json();
  if (!message || !message.trim()) {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Live context via DuckDuckGo
  let contextSnippet = "";
  try {
    // Add simple heuristic: only search if it looks like a question requiring current context
    const searchKeywords = ["who", "what", "which", "latest", "news", "today", "now", "current", "update", "price", "won", "winner", "weather"];
    const requiresSearch = searchKeywords.some(k => message.toLowerCase().includes(k)) || /\d{4}/.test(message);
    
    if (requiresSearch) {
      const ddgRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(message.trim())}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      });
      if (ddgRes.ok) {
          const text = await ddgRes.text();
          const matches = [...text.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi)];
          const snippets = matches.map(m => m[1].replace(/<[^>]+>/g, '').trim()).slice(0, 3);
          if (snippets.length) {
              contextSnippet = `\n\nHere is dynamic real-time context to answer the user's query accurately:\n\n### Live Web Search Results:\n${snippets.join("\n")}`;
          }
      }
    }
  } catch (e) {}

  const dynamicSystemPrompt = SYSTEM_PROMPT + contextSnippet;

  const messagesPayload = [
    { role: "system", content: dynamicSystemPrompt },
    ...(history || []),
    { role: "user", content: message.trim() },
  ];

  const upstream = await fetch(
    "https://text.pollinations.ai/openai/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: messagesPayload,
        stream: true,
      }),
    }
  );

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream error ${upstream.status}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            await writer.write(encoder.encode("data: [DONE]\n\n"));
            break;
          }
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)
              );
            }
          } catch {}
        }
      }
    } catch (e) {
      await writer.write(
        encoder.encode(
          `data: ${JSON.stringify({ delta: "Sorry, an error occurred. Please try again." })}\n\n`
        )
      );
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
