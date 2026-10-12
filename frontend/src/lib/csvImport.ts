/**
 * Pasted / uploaded CSV text → rows keyed by header name (RFC 4180, a little lenient). Used by
 * Reporting › Conversion Imports. No dependency: this app has no other CSV *parsing* need.
 *
 * - a leading UTF-8 BOM (Excel "CSV UTF-8") is stripped, so the first header isn't `\uFEFFname`
 * - fields may be double-quoted; a quoted field can hold commas, CR/LF line breaks and `""` (→ `"`)
 * - records end at CRLF, LF or a lone CR
 * - header names and values are trimmed; empty header names are ignored; extra cells are dropped
 * - completely blank records (no text in any field — an empty line or Excel's trailing `,,,`) are
 *   skipped rather than becoming empty rows
 * - an unterminated quote runs to the end of the text (nothing is silently lost)
 */

/** The raw records (arrays of fields) in `text`, blank records included. */
export function parseCsvRecords(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') { field = ''; inQuotes = true; continue; } // opening quote (leading spaces dropped)
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); records.push(row); row = []; field = '';
      if (c === '\r' && s[i + 1] === '\n') i++;
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length > 0 || inQuotes) { row.push(field); records.push(row); }
  return records;
}

const isBlank = (record: string[]) => record.every((f) => f.trim() === '');

/** Header row + data rows → one object per non-blank data row, keyed by trimmed header name. */
export function parseCsv(text: string): Record<string, string>[] {
  const records = parseCsvRecords(text).filter((r) => !isBlank(r));
  const [header, ...data] = records;
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return data.map((cells) => {
    const row: Record<string, string> = {};
    names.forEach((name, i) => { if (name) row[name] = (cells[i] ?? '').trim(); });
    return row;
  });
}
