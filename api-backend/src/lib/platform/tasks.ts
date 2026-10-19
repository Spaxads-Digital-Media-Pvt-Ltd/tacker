/**
 * The platform team's tasks (Super Admin › Tasks) — what the routes and the Overview share: a member's open
 * tasks at a glance (open, past due, due later today).
 */
import { query } from '../db/pool.js';

export interface TaskCounts { open: number; overdue: number; due_today: number }

export async function myTaskCounts(memberId: string): Promise<TaskCounts> {
  return (await query<TaskCounts>(
    `SELECT COUNT(*)::int AS open, COUNT(*) FILTER (WHERE due_at < now())::int AS overdue,
            COUNT(*) FILTER (WHERE due_at >= now() AND due_at < date_trunc('day', now()) + interval '1 day')::int AS due_today
       FROM platform_tasks WHERE assignee_id = $1 AND status = 'open'`, [memberId])).rows[0]!;
}
