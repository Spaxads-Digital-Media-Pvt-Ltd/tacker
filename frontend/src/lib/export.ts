/**
 * Client-side data export for the report screens. Rows come from the backend export endpoint (which
 * also logs the export); here we turn them into a downloadable CSV or Excel (.xlsx) file. Column
 * order follows the first row's keys.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One CSV cell. Text a spreadsheet would run as a formula (=, +, -, @, tab or CR first) gets a
 * leading apostrophe — partner/offer names are user-controlled — while real numbers like "-5.0000"
 * stay numeric. Quotes, commas and line breaks are quoted per RFC 4180.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text for `rows` (column order = the first row's keys). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  return [headers.map(csvCell).join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n');
}

/**
 * Report exports keep money as plain decimal strings ("1.05", no symbol) so a spreadsheet still
 * reads them as numbers; the currency those amounts are in goes in its own trailing `currency`
 * column (the name the Click and Conversion exports use). A row that already carries its own
 * `currency` (per-row money) keeps it.
 */
export function withCurrencyColumn(rows: Record<string, unknown>[], currency: string): Record<string, unknown>[] {
  return rows.map((r) => ('currency' in r ? r : { ...r, currency }));
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  triggerDownload(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename);
}

/** Excel export. xlsx is loaded on demand so it isn't in the Reports bundle until Excel is used. */
export async function downloadXlsx(filename: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  triggerDownload(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
