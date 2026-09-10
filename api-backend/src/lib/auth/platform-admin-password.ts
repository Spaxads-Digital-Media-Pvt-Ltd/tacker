import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

function encodeBase64(buf: Buffer): string {
 return buf.toString('base64url');
}

function decodeBase64(s: string): Buffer {
 return Buffer.from(s, 'base64url');
}

async function scrypt(password: string, salt: Buffer, keyLen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
 return new Promise((resolve, reject) => {
 crypto.scrypt(password, salt, keyLen, opts, (err, key) => {
 if (err) reject(err);
 else resolve(key);
 });
 });
}

export async function hashPassword(password: string): Promise<string> {
 const salt = crypto.randomBytes(SALT_LENGTH);
 const key = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p });
 return `scrypt$N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$${encodeBase64(salt)}$${encodeBase64(key)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
 const parts = storedHash.split('$');
 if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
 const salt = decodeBase64(parts[2]!);
 const expectedKey = decodeBase64(parts[3]!);
 const key = await scrypt(password, salt, expectedKey.length, { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p });
 return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expectedKey));
}
