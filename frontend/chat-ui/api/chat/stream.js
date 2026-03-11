export const config = { runtime: "edge" };

const SYSTEM_PROMPT =
  "You are Ehan AI — a smart, accurate, and efficient assistant. " +
  "Be clear and well-structured. " +
  "For simple questions, give brief direct answers. " +
  "For complex topics, explain step by step with examples. " +
  "Use markdown (bold, lists, code blocks) when it helps. " +
  "Never make up facts. " +
  "CRITICAL RULE: You will receive real-time web search results in the dynamic context. " +
  "You MUST use ONLY the information from those search results to answer questions about current events, recent news, sports results, and anything time-sensitive. " +
  "Your training data is outdated. The search results are ALWAYS correct and override your training data. " +
  "DO NOT guess or use your training data for recent events. ONLY use the search results provided.";

// ── Search Method 1: Wikipedia API (very reliable from edge) ──────────────────
async function searchWikipedia(query, maxResults = 3) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${maxResults}&format=json&origin=*`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    const results = (data?.query?.search || []).map((item) => {
      const snippet = item.snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#039;/g, "'");
      return `[Wikipedia: ${item.title}] ${snippet}`;
    });
    return results;
  } catch {
    return [];
  }
}

// ── Search Method 2: Wikipedia page extract for a specific topic ──────────────
async function getWikipediaExtract(title) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return "";
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    if (page && page.extract && page.extract.length > 20) {
      return page.extract.substring(0, 1500);
    }
    return "";
  } catch {
    return "";
  }
}

// ── Search Method 3: DuckDuckGo lite (fallback) ──────────────────────────────
async function searchDDGLite(query, maxResults = 5) {
  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: `q=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const html = await res.text();
    
    // lite.duckduckgo.com uses <td> class="result-snippet" for snippets
    const snippetRegex = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
    const snippets = [];
    let match;
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
      const clean = match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
      if (clean.length > 20) snippets.push(`[Web] ${clean}`);
    }
    return snippets;
  } catch {
    return [];
  }
}

// ── Search Method 4: DuckDuckGo HTML (fallback) ──────────────────────────────
async function searchDDGHTML(query, maxResults = 5) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippets = [];
    let match;
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
      const clean = match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
      if (clean.length > 20) snippets.push(`[Web] ${clean}`);
    }
    return snippets;
  } catch {
    return [];
  }
}

// ── Combined search: try all sources ─────────────────────────────────────────
async function gatherContext(query) {
  // Run all searches in parallel
  const [wikiSearch, ddgLite, ddgHTML] = await Promise.all([
    searchWikipedia(query, 3),
    searchDDGLite(query, 3),
    searchDDGHTML(query, 3),
  ]);

  // Also try to get a Wikipedia extract from the first search result title
  let wikiExtract = "";
  if (wikiSearch.length > 0) {
    // Extract title from first result
    const titleMatch = wikiSearch[0].match(/\[Wikipedia: (.+?)\]/);
    if (titleMatch) {
      wikiExtract = await getWikipediaExtract(titleMatch[1]);
    }
  }

  const allResults = [];
  
  if (wikiExtract) allResults.push(`[Wikipedia Full Article]\n${wikiExtract}`);
  allResults.push(...wikiSearch);
  allResults.push(...ddgLite);
  allResults.push(...ddgHTML);

  return allResults;
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

  // Always gather context from multiple sources
  let contextBlock = "";
  try {
    const results = await gatherContext(message.trim());
    if (results.length > 0) {
      contextBlock =
        "\n\n===== REAL-TIME SEARCH RESULTS (THIS IS THE TRUTH — USE THIS TO ANSWER) =====\n" +
        `Current Date: ${new Date().toISOString().split("T")[0]}\n\n` +
        results.join("\n\n") +
        "\n\n===== END OF SEARCH RESULTS =====\n" +
        "\nREMINDER: Base your answer ONLY on the search results above for any factual or current-event questions.";
    }
  } catch {}

  const dynamicSystemPrompt = SYSTEM_PROMPT + contextBlock;

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
