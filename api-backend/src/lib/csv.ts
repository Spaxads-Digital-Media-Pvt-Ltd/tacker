/** One CSV cell — as the SPA's export (frontend lib/export.ts): text a spreadsheet would run as a
 *  formula (=, +, -, @, tab or CR first) gets a leading apostrophe, since partner / offer names are
 *  user-controlled; real numbers like "-5.0000" stay numeric. RFC 4180 quoting. Arrays join with |,
 *  dates are ISO. */
export const csvCell = (v: unknown): string => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('|') : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
