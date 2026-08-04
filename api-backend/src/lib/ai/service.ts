/**
 * AI ops service (spec §11). Runs a manual tool-use loop against Claude with READ-ONLY,
 * tenant-scoped tools. The model reads real data through tools (never fabricates numbers), and any
 * change it suggests is returned as TEXT for a human to approve — no tool mutates anything and
 * money is never moved (non-negotiable #8). Conversations are logged for audit (§11). All keys are
 * server-side; if ANTHROPIC_API_KEY is unset the caller gets a clean "not configured" error.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { AppError } from '../http/errors.js';
import { pool, query } from '../db/pool.js';
import { logger } from '../logger.js';
import { AI_TOOLS, toolByName, type ToolContext } from './tools.js';

const MODEL = 'claude-opus-4-8';
const MAX_ITERATIONS = 6;

export function isAiConfigured(): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!isAiConfigured()) {
    throw new AppError('bad_request', 'AI is not configured (ANTHROPIC_API_KEY missing).');
  }
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
  return client;
}

function systemPrompt(networkId: string): string {
  return [
    'You are the AI operations assistant for an affiliate tracking network (network id ' + networkId + ').',
    'You help the admin understand and run their network: reporting/analytics, anomaly & fraud triage,',
    'and offer-optimization suggestions.',
    '',
    'HARD RULES:',
    '- For ANY numeric question (clicks, conversions, CR, payout, revenue, margin, EPC), you MUST call a',
    '  tool to get exact figures. NEVER estimate or invent numbers. If a tool returns nothing, say so.',
    '- You can only see THIS network\'s data. Do not claim knowledge of other networks.',
    '- You may READ freely, but you may NOT make changes. If you recommend a change (new offer, cap',
    '  adjustment, geo rule, pausing an offer, a payout), present it as a clear, reviewable suggestion',
    '  for the admin to approve and apply themselves. Never imply you executed it.',
    '- Never move money or approve payouts.',
    '',
    'Be concise. Lead with the answer, then a short interpretation. When you cite a figure, it must come',
    'from a tool call in this conversation.',
  ].join('\n');
}

interface ChatArgs {
  networkId: string;
  userId?: string;
  conversationId?: string;
  message: string;
}
export interface ChatResult {
  conversationId: string;
  reply: string;
  toolCalls: { name: string; input: unknown }[];
}

async function loadHistory(networkId: string, conversationId: string): Promise<Anthropic.MessageParam[]> {
  const { rows } = await query<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content FROM ai_messages
      WHERE network_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 40`,
    [networkId, conversationId],
  );
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

export async function runChat(args: ChatArgs): Promise<ChatResult> {
  const anthropic = getClient();
  const ctx: ToolContext = { networkId: args.networkId };

  // Ensure a conversation exists.
  let conversationId = args.conversationId;
  if (conversationId) {
    // Ownership check: the conversation must belong to this network (deny-by-default, spec §3A).
    const { rows } = await query(`SELECT id FROM ai_conversations WHERE id = $1 AND network_id = $2`, [conversationId, args.networkId]);
    if (rows.length === 0) throw new AppError('not_found', 'Conversation not found');
  } else {
    conversationId = (await query<{ id: string }>(
      `INSERT INTO ai_conversations (network_id, user_id, title) VALUES ($1, $2, $3) RETURNING id`,
      [args.networkId, args.userId ?? null, args.message.slice(0, 80)],
    )).rows[0]!.id;
  }

  const history = await loadHistory(args.networkId, conversationId);
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: args.message }];
  const toolCalls: { name: string; input: unknown }[] = [];
  const tools = AI_TOOLS.map((t) => t.definition);

  let reply = '';
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Adaptive thinking (`thinking: { type: 'adaptive' }`) improves reasoning on Opus 4.8 but
      // isn't typed by this SDK version; enable it when the SDK is upgraded. Tool-returned numbers
      // are exact regardless, so answer correctness doesn't depend on it.
      system: systemPrompt(args.networkId),
      tools,
      messages,
    });
    // Echo the full assistant content (thinking + tool_use blocks) back on the next turn.
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason !== 'tool_use') {
      reply = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const tool = toolByName.get(block.name);
      let result: unknown;
      try {
        result = tool ? await tool.execute(ctx, block.input as Record<string, unknown>) : { error: 'unknown_tool' };
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'tool_failed' };
      }
      toolCalls.push({ name: block.name, input: block.input });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result).slice(0, 20_000), // bound tool output size
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (!reply) reply = 'I could not complete that request within the tool-call limit. Please narrow the question.';

  // Persist the exchange (audit + history, spec §11).
  await query(
    `INSERT INTO ai_messages (network_id, conversation_id, role, content) VALUES ($1,$2,'user',$3)`,
    [args.networkId, conversationId, args.message],
  );
  await query(
    `INSERT INTO ai_messages (network_id, conversation_id, role, content, tool_calls) VALUES ($1,$2,'assistant',$3,$4)`,
    [args.networkId, conversationId, reply, JSON.stringify(toolCalls)],
  );

  logger.info({ networkId: args.networkId, conversationId, tools: toolCalls.map((t) => t.name) }, 'ai chat');
  return { conversationId, reply, toolCalls };
}

void pool; // reserved for future transactional persistence
