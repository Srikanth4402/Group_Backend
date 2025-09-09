import express from 'express';
import { replyChatBot } from '../controllers/ChatBotController.js';
const router = express.Router();


router.post('/api/chatbot', replyChatBot);


export default router;