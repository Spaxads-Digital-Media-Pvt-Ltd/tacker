import { readFileSync, writeFileSync } from 'fs';
const p = 'test/helpers/tokens.ts';
const lines = readFileSync(p, 'utf8').split('\n');
const target = lines[9];
console.log('Before fix:', target);
// Replace //+$/ (two slashes + + $ /) with /+$/ (slash + + $ /)
const fixed = target.replace('//+$/', '/\\/+$/');
lines[9] = fixed;
writeFileSync(p, lines.join('\n'));
console.log('After fix:', lines[9]);
