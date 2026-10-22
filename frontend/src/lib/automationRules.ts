/**
 * Automation › Alerts: the conditions builder's model ⇄ the conditions text the API stores and the
 * worker evaluates (api-backend lib/automation/alert-rules.ts parseConditions): "cr > 5 AND clicks >= 100
 * per offer in 24h". Pure (no React), so `node --test` / Vitest run the real code.
 */
export type RuleOp = '>' | '>=' | '<' | '<=' | '=' | '!=';
export interface RuleClause { metric: string; op: RuleOp; value: string }
export interface RuleModel {
  clauses: RuleClause[];
  /** null = the whole network. */
  scope: 'offer' | 'partner' | 'advertiser' | null;
  window: { amount: number; unit: 'm' | 'h' | 'd' };
}

export const DEFAULT_RULE: RuleModel = { clauses: [{ metric: 'clicks', op: '>=', value: '' }], scope: null, window: { amount: 24, unit: 'h' } };
const OPS: readonly RuleOp[] = ['>=', '<=', '!=', '>', '<', '='];

/** The model as the API's conditions text. */
export function buildConditions(m: RuleModel): string {
  const clauses = m.clauses.filter((c) => c.value.trim() !== '').map((c) => `${c.metric} ${c.op} ${c.value.trim()}`);
  return [clauses.join(' AND '), m.scope ? `per ${m.scope}` : '', `in ${m.window.amount}${m.window.unit}`].filter(Boolean).join(' ');
}

/**
 * Conditions text → the model, for editing a saved rule. Returns null for text the builder can't show
 * (an older rule written by hand with aliases or "&&") — the form then keeps it as text.
 */
export function parseConditionsText(raw: string): RuleModel | null {
  let text = ` ${raw.trim()} `;
  let scope: RuleModel['scope'] = null;
  let window: RuleModel['window'] = { amount: 24, unit: 'h' };
  const per = /\s+per\s+(offer|partner|publisher|advertiser)(?=\s)/i.exec(text);
  if (per) {
    const s = per[1]!.toLowerCase();
    scope = s === 'publisher' ? 'partner' : (s as RuleModel['scope']);
    text = text.replace(per[0], ' ');
  }
  const win = /\s+in\s+(\d+)\s*([mhd])(?=\s)/i.exec(text);
  if (win) {
    window = { amount: Number(win[1]), unit: win[2]!.toLowerCase() as 'm' | 'h' | 'd' };
    text = text.replace(win[0], ' ');
  }
  const parts = text.trim().split(/\s+AND\s+/i).filter(Boolean);
  if (!parts.length) return null;
  const clauses: RuleClause[] = [];
  for (const part of parts) {
    const m = /^([a-z_]+)\s*(>=|<=|!=|>|<|=)\s*(\d+(?:\.\d+)?)$/i.exec(part.trim());
    if (!m || !OPS.includes(m[2] as RuleOp)) return null;
    clauses.push({ metric: m[1]!.toLowerCase(), op: m[2] as RuleOp, value: m[3]! });
  }
  return { clauses, scope, window };
}

/** A webhook's stored events ("a,b" or "*") ⇄ the checkboxes. */
export const parseEvents = (raw: string): string[] => raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
export const buildEvents = (events: string[]): string => (events.includes('*') ? '*' : events.join(','));
