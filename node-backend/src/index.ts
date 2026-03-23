import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import chatRoutes from './routes/chat.routes';

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/chat', chatRoutes);

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'live', engine: 'Gemini Pro Node' });
});

// DB Connection (Resilient Strategy)
const mongoURI = process.env.MONGODB_URI;

if (mongoURI && mongoURI.length > 5) {
  mongoose
    .connect(mongoURI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));
} else {
  console.warn('⚠️  MONGODB_URI not provided. Chat history will not be persisted.');
}

app.listen(PORT, () => console.log(`🚀 Node Nexus Server Spinning on port ${PORT}`));
