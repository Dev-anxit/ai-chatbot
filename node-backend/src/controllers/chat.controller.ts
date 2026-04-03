import { Request, Response } from 'express';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import Conversation from '../models/Conversation';

// Initialize Gemini
const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
const groqKey = process.env.GROQ_API_KEY?.trim() || "";
console.log(`[AI] Gemini Key: ${apiKey.length > 0 ? 'configured' : 'MISSING'}`);
console.log(`[AI] Groq Key: ${groqKey.length > 0 ? 'configured' : 'MISSING'}`);

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const SYSTEM_PROMPT =
  "You are Ehan AI — a friendly, highly intelligent AI research assistant. " +
  "You provide clear, helpful, well-structured answers. " +
  "For code, use markdown code blocks with the language specified. " +
  "For complex topics, break your answer into sections with headings. " +
  "Be concise but thorough.";

/**
 * Try Groq API as fallback (OpenAI-compatible REST API)
 */
async function streamWithGroq(
  userMessage: string,
  chatHistory: Array<{ role: string; content: string }>,
  res: Response
): Promise<boolean> {
  if (!groqKey) return false;

  const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

  for (const model of models) {
    try {
      console.log(`[Groq] Trying model: ${model}...`);

      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...chatHistory.slice(-10).map(m => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content
        })),
        { role: "user", content: userMessage }
      ];

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          max_tokens: 1500,
          temperature: 0.7,
        }),
      });

      if (!response.ok || !response.body) {
        console.error(`[Groq] ${model} returned ${response.status}`);
        continue;
      }

      // Parse OpenAI-compatible SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotContent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              gotContent = true;
              res.write(`data: ${JSON.stringify({ delta })}\n\n`);
            }
          } catch {}
        }
      }

      if (gotContent) {
        console.log(`[Groq] ✅ ${model} stream completed successfully`);
        return true;
      }
    } catch (err: any) {
      console.error(`[Groq] ${model} error:`, err.message);
      continue;
    }
  }
  return false;
}

/**
 * Try Gemini API with model fallback
 */
async function streamWithGemini(
  userMessage: string,
  chatHistory: Array<{ role: string; content: string }>,
  res: Response
): Promise<boolean> {
  if (!genAI) return false;

  const models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"];

  for (const modelName of models) {
    try {
      console.log(`[Gemini] Trying model: ${modelName}...`);

      const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ],
      });

      // Build Gemini chat history
      const geminiHistory: Array<{ role: string; parts: Array<{ text: string }> }> = [];
      geminiHistory.push(
        { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
        { role: "model", parts: [{ text: "Understood. I'll follow these instructions." }] }
      );

      for (const msg of chatHistory.slice(-12)) {
        const role = msg.role === "user" ? "user" : "model";
        if (msg.content?.trim()) {
          geminiHistory.push({ role, parts: [{ text: msg.content }] });
        }
      }

      const chat = model.startChat({
        history: geminiHistory,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
      });

      const result = await chat.sendMessageStream(userMessage);
      let gotContent = false;

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          gotContent = true;
          res.write(`data: ${JSON.stringify({ delta: chunkText })}\n\n`);
        }
      }

      if (gotContent) {
        console.log(`[Gemini] ✅ ${modelName} stream completed successfully`);
        return true;
      }
    } catch (err: any) {
      // If quota exceeded (429), try other models or fall through to Groq
      console.error(`[Gemini] ${modelName} error:`, err.message?.slice(0, 120));
      continue;
    }
  }
  return false;
}

/**
 * Unified streaming chat handler.
 * Accepts BOTH formats:
 *   - Vite frontend: { message: string, history: [{role, content}] }
 *   - Next.js frontend: { messages: [{role, content}], conversationId? }
 */
export const streamChat = async (req: Request, res: Response) => {
  // --- Normalize input from either frontend ---
  let userMessage: string;
  let chatHistory: Array<{ role: string; content: string }>;
  let conversationId: string | undefined;

  if (req.body.message) {
    userMessage = req.body.message.trim();
    chatHistory = Array.isArray(req.body.history) ? req.body.history : [];
    conversationId = req.body.conversationId;
  } else if (req.body.messages) {
    const msgs = req.body.messages as Array<{ role: string; content: string }>;
    userMessage = msgs[msgs.length - 1]?.content || "";
    chatHistory = msgs.slice(0, -1);
    conversationId = req.body.conversationId;
  } else {
    res.status(400).json({ error: "Missing 'message' or 'messages' in request body" });
    return;
  }

  if (!userMessage) {
    res.status(400).json({ error: "Empty message" });
    return;
  }

  // --- SSE Setup ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  console.log(`\n[Chat] Request: "${userMessage.slice(0, 80)}..."`);

  // --- Provider Cascade: Gemini → Groq ---
  let success = false;

  // 1. Try Gemini (primary)
  if (!success) {
    success = await streamWithGemini(userMessage, chatHistory, res);
  }

  // 2. Try Groq (fallback)
  if (!success) {
    success = await streamWithGroq(userMessage, chatHistory, res);
  }

  // 3. All failed
  if (!success) {
    console.error("[Chat] 🚨 ALL PROVIDERS FAILED");
    res.write(`data: ${JSON.stringify({ delta: "⚠️ All AI providers are currently unavailable. Your Gemini API quota may be exhausted, and Groq may be unreachable. Please try again in a few minutes or update your API keys." })}\n\n`);
  }

  // Persist to DB if conversationId provided
  if (conversationId) {
    try {
      await Conversation.findByIdAndUpdate(conversationId, {
        $push: {
          messages: [
            { role: 'user', content: userMessage },
            { role: 'model', content: '(streamed)' }
          ]
        }
      });
    } catch {}
  }

  res.write('data: [DONE]\n\n');
  res.end();
};
