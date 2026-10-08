/**
 * Escape user input for a LIKE / ILIKE pattern so `%` and `_` match literally instead of acting as
 * wildcards. Pair it with an explicit escape clause:  `col ILIKE $n ESCAPE '\'`
 * (inside a JS template literal write `ESCAPE '\\'` so Postgres receives a single backslash), and
 * wrap the escaped value yourself, e.g. `%${escapeLike(q)}%`. The value is still bound as a
 * parameter — this only neutralises pattern metacharacters, it is not SQL escaping.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%term%` with the term's LIKE metacharacters escaped — the common "contains" search. */
export function containsPattern(s: string): string {
  return `%${escapeLike(s)}%`;
}
