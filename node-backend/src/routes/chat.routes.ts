import { Router } from 'express';
import { streamChat } from '../controllers/chat.controller';

const router = Router();

// /api/chat/stream
router.post('/stream', streamChat);

export default router;
