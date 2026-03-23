"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamChat = void 0;
const generative_ai_1 = require("@google/generative-ai");
const Conversation_1 = __importDefault(require("../models/Conversation"));
// Initialize Gemini with safety filters
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const streamChat = async (req, res) => {
    const { messages, userId, conversationId } = req.body;
    // SSE Setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            safetySettings: [
                { category: generative_ai_1.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: generative_ai_1.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
            ]
        });
        const contextMessages = messages.slice(-15); // Context windowing
        const lastUserMsg = contextMessages[contextMessages.length - 1].content;
        // Start Gemini Chat session
        const chat = model.startChat({
            history: contextMessages.slice(0, -1).map((m) => ({
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
            await Conversation_1.default.findByIdAndUpdate(conversationId, {
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
    }
    catch (error) {
        console.error("Gemini Failure:", error);
        res.write(`data: ${JSON.stringify({ error: error.message || "Internal AI Error" })}\n\n`);
        res.end();
    }
};
exports.streamChat = streamChat;
