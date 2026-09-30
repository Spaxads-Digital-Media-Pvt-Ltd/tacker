/**
 * Country-aware postal/ZIP code formats for offer targeting. Values are matched case-insensitively
 * after trimming. Countries without a specific rule use GENERIC.
 */
const FORMATS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
  GB: /^([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}|GIR ?0AA)$/i,
  IN: /^[1-9]\d{5}$/,
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  ES: /^\d{5}$/,
  IT: /^\d{5}$/,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  BR: /^\d{5}-?\d{3}$/,
  MX: /^\d{5}$/,
  JP: /^\d{3}-?\d{4}$/,
  IE: /^[A-Z]\d[\dW] ?[A-Z\d]{4}$/i,
  SG: /^\d{6}$/,
  ZA: /^\d{4}$/,
  PK: /^\d{5}$/,
  NG: /^\d{6}$/,
  VN: /^\d{6}$/,
};

export const GENERIC_POSTAL = /^[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]$/i;

/**
 * Validate one postal code. When `countries` is non-empty, the code must match the format of at
 * least one of them (countries without a specific rule fall back to the generic format).
 */
export function isValidPostal(code: string, countries: string[] = []): boolean {
  const v = normalizePostal(code);
  if (!v) return false;
  const targets = Array.from(new Set(countries.map((c) => c.toUpperCase())));
  if (targets.length === 0) return GENERIC_POSTAL.test(v);
  return targets.some((c) => (FORMATS[c] ?? GENERIC_POSTAL).test(v));
}

export function normalizePostal(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, ' ');
}
