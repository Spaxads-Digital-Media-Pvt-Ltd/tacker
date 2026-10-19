/**
 * AI ops endpoints (spec §11) — admin-only. Chat runs the tenant-scoped tool loop; conversations
 * are readable for history. Every chat is audit-logged. The Anthropic key never leaves the backend.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { runChat, isAiConfigured } from '../../../lib/ai/service.js';
import { aiQuota } from '../../../lib/ai/quota.js';
import { requireRole } from '../auth.js';

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

export function aiRoutes(): Router {
  const r = Router();

  // configured + today's AI budget for this network (F-25·F-28: chats / tokens per UTC day).
  r.get('/status', asyncHandler(async (req, res) => sendOk(res, { configured: isAiConfigured(), quota: await aiQuota(req.scope!.networkId) })));

  r.get(
    '/conversations',
    asyncHandler(async (req, res) => {
      const rows = await dbForRequest(req).selectMany('ai_conversations', { orderBy: 'created_at', limit: 50 });
      sendOk(res, rows);
    }),
  );

  r.get(
    '/conversations/:id',
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const conv = await db.selectOne('ai_conversations', { id: req.params.id });
      if (!conv) throw notFound('Conversation not found');
      const messages = await db.selectMany('ai_messages', {
        where: { conversation_id: req.params.id }, orderBy: 'created_at', limit: 200,
      });
      sendOk(res, { conversation: conv, messages });
    }),
  );

  // Each chat spends the network's Anthropic budget — admin/manager only (F-13).
  r.post(
    '/chat',
    requireRole('admin', 'manager'),
    validateBody(chatSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof chatSchema>;
      const userId = req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : undefined;
      const result = await runChat({
        networkId: req.scope!.networkId,
        ...(userId ? { userId } : {}),
        ...(b.conversationId ? { conversationId: b.conversationId } : {}),
        message: b.message,
      });
      await writeAudit(req, { action: 'ai.chat', entityType: 'ai_conversation', entityId: result.conversationId, after: { tools: result.toolCalls.map((t) => t.name) } });
      sendOk(res, result);
    }),
  );

  return r;
}
