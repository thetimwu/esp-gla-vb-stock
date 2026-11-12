import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const DUMMY_HASH = argon2.hash(randomBytes(32), {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  const hash = passwordHash ?? (await DUMMY_HASH);
  const matches = await argon2.verify(hash, password);
  return passwordHash !== null && matches;
}
