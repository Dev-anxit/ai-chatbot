export const config = { runtime: "edge" };

const SYSTEM_PROMPT =
  "You are Ehan AI — a smart, accurate, and efficient assistant. " +
  "Be clear and well-structured. " +
  "For simple questions, give brief direct answers. " +
  "For complex topics, explain step by step with examples. " +
  "Use markdown (bold, lists, code blocks) when it helps. " +
  "Never make up facts. " +
  "CRITICAL RULE: You will receive real-time web search results below. " +
  "You MUST use ONLY the information from those search results to answer questions about current events, recent news, sports results, and anything time-sensitive. " +
  "Your training data is outdated. The search results are ALWAYS correct and override your training data. " +
  "DO NOT guess or use your training data for recent events. ONLY use the search results provided.";

async function fetchDDGSnippets(query, maxResults = 5) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return [];

    const html = await res.text();

    // Extract snippets
    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const titleRegex = /class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
    const linkRegex = /class="result__url"[^>]*href="([^"]*)"[^>]*>/gi;

    const snippets = [];
    let match;
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
      snippets.push(match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim());
    }

    const titles = [];
    while ((match = titleRegex.exec(html)) !== null && titles.length < maxResults) {
      titles.push(match[1].replace(/<[^>]+>/g, "").trim());
    }

    if (snippets.length === 0) return [];

    const results = snippets.map((s, i) => {
      const title = titles[i] || "";
      return `[${i + 1}] ${title}: ${s}`;
    });

    return results;
  } catch (e) {
    return [];
  }
}

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

  // Always perform a web search to get up-to-date info
  let contextBlock = "";
  try {
    const snippets = await fetchDDGSnippets(message.trim(), 5);
    if (snippets.length > 0) {
      contextBlock =
        "\n\n===== REAL-TIME WEB SEARCH RESULTS (USE THESE AS THE TRUTH) =====\n" +
        `Current Date: ${new Date().toISOString().split("T")[0]}\n\n` +
        snippets.join("\n\n") +
        "\n===== END OF SEARCH RESULTS =====\n" +
        "\nREMINDER: Base your answer ONLY on the search results above for any factual or current-event questions. Do NOT contradict them.";
    }
  } catch (e) {}

  const dynamicSystemPrompt = SYSTEM_PROMPT + contextBlock;

  // Build messages: system + history + current user message
  const messagesPayload = [
    { role: "system", content: dynamicSystemPrompt },
    ...(Array.isArray(history) ? history : []),
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
