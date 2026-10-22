/** "What's new" read state — per browser (localStorage), so the Help menu can show a dot for unread entries. */
const KEY = 'tracker.changelogSeenAt';
export function changelogSeenAt(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
export function markChangelogSeen(at: string): void { try { localStorage.setItem(KEY, at); } catch { /* storage unavailable */ } }
/** Is the newest entry (its published_at) newer than what was last seen? */
export const hasUnread = (latest: string | null | undefined, seen: string | null): boolean => Boolean(latest && (!seen || Date.parse(latest) > Date.parse(seen)));
