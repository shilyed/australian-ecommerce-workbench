import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** 邮箱既是登录账号，也是成员通知地址；统一小写可避免大小写重复账号。 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function assertPasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`密码不能超过 ${PASSWORD_MAX_LENGTH} 个字符`);
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("密码必须同时包含字母和数字");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordStrength(password);
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  try {
    const [algorithm, n, r, p, saltText, hashText] = encoded.split("$");
    if (algorithm !== "scrypt" || !n || !r || !p || !saltText || !hashText) {
      return false;
    }

    const expected = Buffer.from(hashText, "base64url");
    const actual = await deriveKey(
      password,
      Buffer.from(saltText, "base64url"),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: MAX_MEMORY,
      }
    );

    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

/** 对不存在的账号也执行一次同等成本的散列，降低通过响应时间枚举邮箱的可能。 */
export async function consumePasswordCheck(password: string): Promise<void> {
  await deriveKey(password, randomBytes(16), KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  });
}
