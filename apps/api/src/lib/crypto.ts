import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedPayload {
  encrypted: string; // hex
  iv: string;        // hex
  authTag: string;   // hex
}

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function encryptionAvailable(): boolean {
  return !!process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === 64;
}
