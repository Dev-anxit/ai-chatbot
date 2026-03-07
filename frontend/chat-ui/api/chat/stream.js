export const config = { runtime: "edge" };

const SYSTEM_PROMPT =
  "You are Ehan AI — a smart, accurate, and efficient assistant. " +
  "Be clear and well-structured. " +
  "For simple questions, give brief direct answers. " +
  "For complex topics, explain step by step with examples. " +
  "Use markdown (bold, lists, code blocks) when it helps. " +
  "Never make up facts.";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message } = await req.json();
  if (!message || !message.trim()) {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const upstream = await fetch(
    "https://text.pollinations.ai/openai/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message.trim() },
        ],
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
