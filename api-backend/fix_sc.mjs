import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/surfaces/tracking/conversions/record.ts';
const content = readFileSync(path, 'utf8');

const oldStr = " if (required && input.secureCode !== required) {\n await redis.del(idemKey); // let a correctly-signed retry through\n return { outcome: 'security_failed' };\n }";

const newStr = " if (required) {\n const cmp = timingSafeCompare(input.secureCode, required);\n if (!cmp.ok) {\n await redis.del(idemKey); // let a correctly-signed retry through\n return { outcome: 'security_failed' };\n }\n }";

if (content.includes(oldStr)) {
 writeFileSync(path, content.replace(oldStr, newStr), 'utf8');
 console.log('REPLACED');
} else {
 console.log('NOT FOUND');
}
