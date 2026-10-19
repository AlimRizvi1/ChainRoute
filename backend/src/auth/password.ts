import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = 2 ** 17;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;
const MAX_PASSWORD_BYTES = 256;

export async function hashPassword(password: string): Promise<string> {
  assertPassword(password);
  const salt = randomBytes(16);
  const digest = await deriveKey(password, salt);
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string | null,
): Promise<boolean> {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return false;
  }

  const fields = encoded?.split("$");
  if (
    !fields ||
    fields.length !== 6 ||
    fields[0] !== "scrypt" ||
    Number(fields[1]) !== COST ||
    Number(fields[2]) !== BLOCK_SIZE ||
    Number(fields[3]) !== PARALLELIZATION
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(fields[4], "base64url");
    const expected = Buffer.from(fields[5], "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await deriveKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}

function assertPassword(password: string): void {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES
  ) {
    throw new Error("Password must contain 1–256 UTF-8 bytes.");
  }
}
