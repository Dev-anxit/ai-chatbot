import { Request, Response } from 'express';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import Conversation from '../models/Conversation';

// Initialize Gemini with safety filters
const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
console.log(`[DEBUG] Loading Gemini Key: Length=${apiKey.length}, Prefix=${apiKey.substring(0, 4)}...`);
const genAI = new GoogleGenerativeAI(apiKey);

export const streamChat = async (req: Request, res: Response) => {
  const { messages, userId, conversationId } = req.body;

  // SSE Setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-flash-latest", // Switching to Flash to ensure stable quota availability
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
      ]
    });

    const contextMessages = messages.slice(-15); // Context windowing
    const lastUserMsg = contextMessages[contextMessages.length - 1].content;
    
    // Start Gemini Chat session
    const chat = model.startChat({
      history: contextMessages.slice(0, -1).map((m: any) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.7,
      }
    });

    const result = await chat.sendMessageStream(lastUserMsg);
    let fullResponse = "";

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullResponse += chunkText;
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    // Post-Stream: PERSIST TO DB
    if (conversationId) {
      await Conversation.findByIdAndUpdate(conversationId, {
        $push: { 
          messages: [
            { role: 'user', content: lastUserMsg },
            { role: 'model', content: fullResponse }
          ]
        }
      });
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error: any) {
    console.error("Gemini Failure:", error);
    res.write(`data: ${JSON.stringify({ error: error.message || "Internal AI Error" })}\n\n`);
    res.end();
  }
};
