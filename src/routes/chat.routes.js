import { Router } from 'express';
import { handleChat, listModels, getChatSessions, getChatHistory, createNewChat, updateChatTitle, deleteChat } from '../controllers/chat.controller.js';
import upload from '../middlewares/upload.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// Rutas de chat que requieren autenticación
router.post('/chat', requireAuth, upload.array('files', 5), handleChat);
router.get('/sessions', requireAuth, getChatSessions);
router.get('/sessions/:sessionId/history', requireAuth, getChatHistory);
router.post('/sessions', requireAuth, createNewChat);
router.put('/sessions/:sessionId/title', requireAuth, updateChatTitle);
router.delete('/sessions/:sessionId', requireAuth, deleteChat);

// Listar modelos disponibles (no requiere autenticación)
router.get('/models', listModels);

export default router;
