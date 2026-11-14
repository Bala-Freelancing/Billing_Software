import { describe, expect, it } from "vitest";
import { passwordProblems } from "../shared/auth";
import { getConfig } from "../worker/lib/config";
import { hashPassword, verifyPassword } from "../worker/lib/password";
// @ts-expect-error -- plain JS module without type declarations
import { hashPasswordNode } from "../scripts/owner.mjs";

const ITER = 10_000;

describe("password hashing", () => {
  it("verifies the correct password and rejects others", async () => {
    const hash = await hashPassword("blue phone shop since 1998", ITER);
    expect(hash).toMatch(/^pbkdf2-sha256\$10000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect((await verifyPassword("blue phone shop since 1998", hash, ITER)).valid).toBe(true);
    expect((await verifyPassword("blue phone shop since 1999", hash, ITER)).valid).toBe(false);
    expect((await verifyPassword("", hash, ITER)).valid).toBe(false);
  });

  it("uses a unique salt for every hash", async () => {
    const a = await hashPassword("same password here", ITER);
    const b = await hashPassword("same password here", ITER);
    expect(a).not.toBe(b);
  });

  it("never authenticates against a corrupt or foreign hash", async () => {
    for (const stored of [
      "",
      "plaintext",
      "pbkdf2-sha256$abc$salt$hash",
      "pbkdf2-sha256$999999999$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "bcrypt$10$whatever$x",
      "pbkdf2-sha256$10000$!!!$???",
    ]) {
      expect((await verifyPassword("anything", stored, ITER)).valid).toBe(false);
    }
  });

  it("flags hashes made with a different work factor for upgrade", async () => {
    const hash = await hashPassword("upgrade me please", ITER);
    expect(await verifyPassword("upgrade me please", hash, ITER)).toEqual({ valid: true, needsRehash: false });
    expect(await verifyPassword("upgrade me please", hash, 20_000)).toEqual({ valid: true, needsRehash: true });
    // A wrong password never reports needsRehash (no upgrade without proof).
    expect(await verifyPassword("wrong", hash, 20_000)).toEqual({ valid: false, needsRehash: false });
  });

  it("treats Unicode-equivalent passwords as the same (NFKC)", async () => {
    const composed = "café counter billing"; // é as one code point
    const decomposed = "café counter billing"; // e + combining accent
    const hash = await hashPassword(composed, ITER);
    expect((await verifyPassword(decomposed, hash, ITER)).valid).toBe(true);
  });

  it("refuses iteration counts the Workers runtime cannot run", async () => {
    await expect(hashPassword("x".repeat(12), 100_001)).rejects.toThrow();
    await expect(hashPassword("x".repeat(12), 9_999)).rejects.toThrow();
  });

  it("accepts hashes produced by the owner CLI script (Node crypto)", async () => {
    const hash: string = hashPasswordNode("made by the cli tool", ITER);
    expect((await verifyPassword("made by the cli tool", hash, ITER)).valid).toBe(true);
    expect((await verifyPassword("made by the cli tool!", hash, ITER)).valid).toBe(false);
  });
});

describe("password policy", () => {
  it("requires 12+ characters", () => {
    expect(passwordProblems("short pass")).toContain("Use at least 12 characters");
    expect(passwordProblems("long enough phrase")).toEqual([]);
  });

  it("rejects low-variety, padded and username-containing passwords", () => {
    expect(passwordProblems("aaaaaaaaaaaaaaa").length).toBeGreaterThan(0);
    expect(passwordProblems(" padded phrase here").length).toBeGreaterThan(0);
    expect(passwordProblems("i am the owner of shop", "owner").length).toBeGreaterThan(0);
  });
});

describe("config", () => {
  it("accepts valid iteration counts and rejects unsafe ones", () => {
    expect(getConfig({ PASSWORD_HASH_ITERATIONS: "30000" }).passwordHashIterations).toBe(30_000);
    for (const bad of ["", "abc", "5000", "100001", "30000.5", "-1"]) {
      expect(() => getConfig({ PASSWORD_HASH_ITERATIONS: bad })).toThrow();
    }
  });
});
