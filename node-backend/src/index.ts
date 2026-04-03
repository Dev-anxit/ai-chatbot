import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import chatRoutes from './routes/chat.routes';

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Routes - mount at BOTH paths so both frontends work
app.use('/api/chat', chatRoutes);   // Next.js frontend: /api/chat/stream
app.use('/chat', chatRoutes);       // Vite frontend: /chat/stream

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'live', 
    engine: 'Gemini Pro Node',
    geminiKey: process.env.GEMINI_API_KEY ? 'configured' : 'MISSING'
  });
});

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Ehan AI Backend is running', status: 'online' });
});

// DB Connection (Resilient - won't crash if MongoDB is unavailable)
const mongoURI = process.env.MONGODB_URI;

if (mongoURI && mongoURI.length > 10 && !mongoURI.includes('localhost')) {
  mongoose
    .connect(mongoURI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch((err) => console.error('❌ MongoDB Connection Error (non-fatal):', err.message));
} else {
  console.warn('⚠️  MongoDB not configured or using localhost. Chat history will not be persisted.');
}

app.listen(PORT, () => {
  console.log(`\n🚀 Ehan AI Server running on http://localhost:${PORT}`);
  console.log(`   - Vite frontend endpoint:   POST /chat/stream`);
  console.log(`   - Next.js frontend endpoint: POST /api/chat/stream`);
  console.log(`   - Health check:             GET /health\n`);
});
