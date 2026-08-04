/** Random postback secure_code generator (Everflow/Trackog-style, e.g. "prTkFRxJsg"). */
import { randomBytes } from 'node:crypto';

// Unambiguous base-56 alphabet (no 0/O/1/I/l).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateSecureCode(len = 12): string {
  const b = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[b[i]! % ALPHABET.length];
  return out;
}
