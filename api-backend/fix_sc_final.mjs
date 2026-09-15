import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/surfaces/tracking/conversions/record.ts';
let content = readFileSync(path, 'utf8');

// The exact bytes we need to replace (CRLF file, 4-space indent for if, 6-space for body)
const oldBlock = " if (required && input.secureCode !== required) {\r\n await redis.del(idemKey); // let a correctly-signed retry through\r\n return { outcome: 'security_failed' };\r\n }";

// New block: split into required check + timing-safe comparison
const newBlock = " if (required) {\r\n const cmp = timingSafeCompare(input.secureCode, required);\r\n if (!cmp.ok) {\r\n await redis.del(idemKey); // let a correctly-signed retry through\r\n return { outcome: 'security_failed' };\r\n }\r\n }";

console.log('Found old block:', content.includes(oldBlock));

if (content.includes(oldBlock)) {
 content = content.replace(oldBlock, newBlock);
 writeFileSync(path, content, 'utf8');
 console.log('REPLACED OK');
} else {
 // Find the !== and show surrounding context
 const idx = content.indexOf('secureCode !== required');
 if (idx >= 0) {
 console.log('!== found at', idx);
 console.log('Context:', JSON.stringify(content.slice(idx - 10, idx + 100)));
 }
}
