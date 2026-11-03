import { IntegrityError, ValidationError } from "@/lib/errors";
import { bufferToHex, sha256Hex } from "@/lib/hash";
import { ENCRYPTED_BACKUP_MAGIC } from "@/lib/version";

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBackupFile {
  bytes: Uint8Array;
  sha256: string;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  if (passphrase.length < 10) {
    throw new ValidationError("عبارة الاسترداد يجب أن تكون 10 أحرف على الأقل.");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackupPayload(plainText: string, passphrase: string): Promise<EncryptedBackupFile> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plainText),
  );
  const magic = new TextEncoder().encode(ENCRYPTED_BACKUP_MAGIC);
  const iter = new Uint8Array(new Uint32Array([PBKDF2_ITERATIONS]).buffer);
  const bytes = concat([magic, salt, iv, iter, new Uint8Array(cipher)]);
  return { bytes, sha256: await sha256Hex(bytes) };
}

export async function decryptBackupPayload(bytes: Uint8Array, passphrase: string): Promise<string> {
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== ENCRYPTED_BACKUP_MAGIC) {
    throw new IntegrityError("ملف النسخة الاحتياطية تالف أو ليس بالصيغة المعتمدة.");
  }
  const salt = bytes.slice(4, 4 + SALT_BYTES);
  const iv = bytes.slice(4 + SALT_BYTES, 4 + SALT_BYTES + IV_BYTES);
  const iterBytes = bytes.slice(4 + SALT_BYTES + IV_BYTES, 4 + SALT_BYTES + IV_BYTES + 4);
  const iterations = new DataView(iterBytes.buffer, iterBytes.byteOffset, 4).getUint32(0, true);
  const cipher = bytes.slice(4 + SALT_BYTES + IV_BYTES + 4);
  try {
    const key = await deriveKey(passphrase, salt, iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new IntegrityError("فشل فك التشفير. تحقق من عبارة الاسترداد وسلامة الملف.");
  }
}

export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string; iterations: number }> {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new ValidationError("رمز PIN يجب أن يكون بين 4 و8 أرقام.");
  }
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 210_000, hash: "SHA-256" },
    material,
    256,
  );
  return { hash: bufferToHex(bits), salt: bufferToHex(salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength)), iterations: 210_000 };
}

export async function verifyPin(pin: string, hash: string, salt: string, iterations: number): Promise<boolean> {
  const derived = await hashPin(pin, salt);
  if (derived.iterations !== iterations) return false;
  if (derived.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) diff |= derived.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
