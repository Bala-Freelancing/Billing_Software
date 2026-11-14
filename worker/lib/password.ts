// Password hashing with PBKDF2-SHA256 from the Web Crypto API (native in
// workerd, so it runs fast enough for the Workers Free plan CPU budget).
//
// Stored format: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
// The iteration count travels with each hash, so raising the configured work
// factor later upgrades users transparently on their next successful login.
//
// scripts/owner.mjs implements the same format with Node's crypto module;
// test/password.test.ts checks the two stay compatible.
import { MAX_PASSWORD_HASH_ITERATIONS, MIN_PASSWORD_HASH_ITERATIONS } from "./config";
import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from "./encoding";

const SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  // NFKC so the same password typed on different keyboards/OSes matches.
  const key = await crypto.subtle.importKey("raw", encoder.encode(password.normalize("NFKC")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function assertIterations(iterations: number): void {
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PASSWORD_HASH_ITERATIONS ||
    iterations > MAX_PASSWORD_HASH_ITERATIONS
  ) {
    throw new Error(`Invalid PBKDF2 iteration count: ${iterations}`);
  }
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  assertIterations(iterations);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${SCHEME}$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) return null;
  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PASSWORD_HASH_ITERATIONS ||
    iterations > MAX_PASSWORD_HASH_ITERATIONS
  ) {
    return null;
  }
  const salt = base64UrlToBytes(parts[2] ?? "");
  const hash = base64UrlToBytes(parts[3] ?? "");
  if (!salt || salt.length < SALT_BYTES || !hash || hash.length !== HASH_BYTES) return null;
  return { iterations, salt, hash };
}

export interface VerifyResult {
  valid: boolean;
  /** True when the hash was made with a different work factor than configured. */
  needsRehash: boolean;
}

export async function verifyPassword(
  password: string,
  stored: string,
  configuredIterations: number,
): Promise<VerifyResult> {
  const parsed = parseHash(stored);
  if (!parsed) {
    // A corrupt hash must never authenticate. Still spend the same CPU so the
    // response time does not reveal anything.
    await derive(password, new Uint8Array(SALT_BYTES), configuredIterations);
    return { valid: false, needsRehash: false };
  }
  const candidate = await derive(password, parsed.salt, parsed.iterations);
  const valid = timingSafeEqual(candidate, parsed.hash);
  return { valid, needsRehash: valid && parsed.iterations !== configuredIterations };
}

/**
 * Burns the same CPU as a real verification. Used when the username does not
 * exist, so attackers cannot discover valid usernames from response timing.
 */
export async function simulatePasswordCheck(password: string, iterations: number): Promise<void> {
  await derive(password, new Uint8Array(SALT_BYTES), iterations);
}
