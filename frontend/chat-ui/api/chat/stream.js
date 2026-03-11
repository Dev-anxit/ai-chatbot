export const config = { runtime: "edge" };

const SYSTEM_PROMPT =
  "You are Ehan AI — a world-class, professional AI assistant. " +
  "You provide accurate, well-researched, and beautifully formatted responses. " +
  "Rules: " +
  "1. For simple questions, give brief direct answers. " +
  "2. For complex topics, explain step by step with examples. " +
  "3. Use markdown formatting (bold, lists, code blocks, tables) to make responses clear and scannable. " +
  "4. Never make up facts. If unsure, say so. " +
  "5. NEVER include any promotional text, advertisements, watermarks, or third-party attributions in your response. " +
  "6. Do NOT mention any AI provider, API service, or platform name in your response. " +
  "7. You will receive real-time web search results in the dynamic context. " +
  "You MUST use ONLY the information from those search results to answer questions about current events, recent news, sports results, and anything time-sensitive. " +
  "Your training data is outdated. The search results are ALWAYS correct and override your training data. " +
  "DO NOT guess or use your training data for recent events. ONLY use the search results provided.";

// ── Ad / watermark stripping ─────────────────────────────────────────────────
function stripAds(text) {
  const patterns = [
    /🌸.*?Pollinations.*?(?:\.|$)/gis,
    /\*\*Support Pollinations.*$/gim,
    /Support Pollinations.*$/gim,
    /Powered by Pollinations.*$/gim,
    /---\s*\n.*?Pollinations.*$/gims,
    /\n+\s*\*?\s*(?:Ad|Advertisement)\s*\*?\s*\n.*$/gims,
    /\[.*?pollinations.*?\].*$/gim,
    /<.*?pollinations.*?>.*$/gim,
  ];
  for (const pat of patterns) {
    text = text.replace(pat, "");
  }
  return text.trimEnd();
}

// ── Search Method 1: Wikipedia API (very reliable from edge) ──────────────────
async function searchWikipedia(query, maxResults = 3) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${maxResults}&format=json&origin=*`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.query?.search || []).map((item) => {
      const snippet = item.snippet
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'");
      return `[Wikipedia: ${item.title}] ${snippet}`;
    });
  } catch {
    return [];
  }
}

// ── Search Method 2: Wikipedia page extract ──────────────────────────────────
async function getWikipediaExtract(title) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return "";
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    if (page?.extract?.length > 20) return page.extract.substring(0, 1500);
    return "";
  } catch {
    return "";
  }
}

// ── Search Method 3: DuckDuckGo lite ─────────────────────────────────────────
async function searchDDGLite(query, maxResults = 5) {
  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: `q=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const re = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
    const snippets = [];
    let match;
    while ((match = re.exec(html)) !== null && snippets.length < maxResults) {
      const clean = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
      if (clean.length > 20) snippets.push(`[Web] ${clean}`);
    }
    return snippets;
  } catch {
    return [];
  }
}

// ── Search Method 4: DuckDuckGo HTML ─────────────────────────────────────────
async function searchDDGHTML(query, maxResults = 5) {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippets = [];
    let match;
    while ((match = re.exec(html)) !== null && snippets.length < maxResults) {
      const clean = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (clean.length > 20) snippets.push(`[Web] ${clean}`);
    }
    return snippets;
  } catch {
    return [];
  }
}

// ── Combined search ──────────────────────────────────────────────────────────
async function gatherContext(query) {
  const [wikiSearch, ddgLite, ddgHTML] = await Promise.all([
    searchWikipedia(query, 3),
    searchDDGLite(query, 3),
    searchDDGHTML(query, 3),
  ]);

  let wikiExtract = "";
  if (wikiSearch.length > 0) {
    const titleMatch = wikiSearch[0].match(/\[Wikipedia: (.+?)\]/);
    if (titleMatch) wikiExtract = await getWikipediaExtract(titleMatch[1]);
  }

  const all = [];
  if (wikiExtract) all.push(`[Wikipedia Full Article]\n${wikiExtract}`);
  all.push(...wikiSearch, ...ddgLite, ...ddgHTML);
  return all;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, history } = await req.json();
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Context gathering
  let contextBlock = "";
  try {
    const results = await gatherContext(message.trim());
    if (results.length > 0) {
      contextBlock =
        "\n\n===== REAL-TIME SEARCH RESULTS (THIS IS THE TRUTH — USE THIS TO ANSWER) =====\n" +
        `Current Date: ${new Date().toISOString().split("T")[0]}\n\n` +
        results.join("\n\n") +
        "\n\n===== END OF SEARCH RESULTS =====\n" +
        "\nREMINDER: Base your answer ONLY on the search results above for any factual or current-event questions. Do NOT include any promotional text.";
    }
  } catch {}

  const dynamicSystemPrompt = SYSTEM_PROMPT + contextBlock;

  const messagesPayload = [
    { role: "system", content: dynamicSystemPrompt },
    ...(Array.isArray(history) ? history : []),
    { role: "user", content: message.trim() },
  ];

  // ── Try providers (buffer full response → strip ads → stream to client) ────
  const endpoints = [
    { model: "openai", stream: true },
    { model: "mistral", stream: true },
    { model: "openai", stream: false },
  ];

  for (const ep of endpoints) {
    try {
      const upstream = await fetch(
        "https://text.pollinations.ai/openai/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ep.model,
            messages: messagesPayload,
            stream: ep.stream,
          }),
        }
      );
      if (!upstream.ok) continue;

      if (!ep.stream) {
        // Non-streaming: parse JSON, strip ads, send as SSE
        const data = await upstream.json();
        let reply = data?.choices?.[0]?.message?.content || "";
        reply = stripAds(reply);
        if (!reply) continue;

        const encoder = new TextEncoder();
        const body = encoder.encode(
          `data: ${JSON.stringify({ delta: reply })}\n\ndata: [DONE]\n\n`
        );
        return new Response(body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Streaming: buffer all chunks → strip ads → re-stream clean text
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;
          } catch {}
        }
      }

      if (!accumulated) continue;

      // Strip ads and re-stream the clean response
      const cleanText = stripAds(accumulated);
      if (!cleanText) continue;

      const encoder = new TextEncoder();
      const words = cleanText.split(" ");
      const chunks = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i] + (i < words.length - 1 ? " " : "");
        chunks.push(`data: ${JSON.stringify({ delta: w })}\n\n`);
      }
      chunks.push("data: [DONE]\n\n");
      const body = encoder.encode(chunks.join(""));

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch {
      continue;
    }
  }

  return new Response(
    JSON.stringify({ error: "All upstream providers failed" }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
