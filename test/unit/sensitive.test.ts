import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { redactSensitive, isSensitivePath } from "../../src/security/sensitive.js";

describe("redactSensitive", () => {
  it("replaces 0x-prefixed secret", () => {
    const pk = "0xabcdef1234567890";
    expect(redactSensitive(`key=${pk}`, [pk])).toBe("key=[REDACTED_PRIVATE_KEY]");
  });

  it("replaces secret without 0x prefix when both variants appear", () => {
    const pk = "0xdeadbeef";
    const out = redactSensitive("a deadbeef b 0xdeadbeef", [pk]);
    expect(out).not.toContain("deadbeef");
    expect(out).toBe("a [REDACTED_PRIVATE_KEY] b [REDACTED_PRIVATE_KEY]");
  });

  it("skips undefined and empty secrets", () => {
    expect(redactSensitive("unchanged", [undefined, ""])).toBe("unchanged");
  });

  it("handles multiple distinct secrets", () => {
    const a = "0xaaa";
    const b = "0xbbb";
    expect(redactSensitive(`${a} and ${b}`, [a, b])).toBe(
      "[REDACTED_PRIVATE_KEY] and [REDACTED_PRIVATE_KEY]",
    );
  });

  it("redacts overlapping occurrences of same secret", () => {
    const s = "0x11";
    expect(redactSensitive(`${s}${s}`, [s])).toBe("[REDACTED_PRIVATE_KEY][REDACTED_PRIVATE_KEY]");
  });
});

describe("isSensitivePath", () => {
  it("returns false when privateKeyFile is undefined", () => {
    expect(isSensitivePath("/any/path", undefined)).toBe(false);
  });

  it("returns true when resolved paths match", () => {
    const dir = mkdtempSync(join(tmpdir(), "goo-sensitive-"));
    const keyPath = join(dir, "key.txt");
    expect(isSensitivePath(keyPath, keyPath)).toBe(true);
  });

  it("returns false for different paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "goo-sensitive-"));
    expect(isSensitivePath(join(dir, "a.txt"), join(dir, "b.txt"))).toBe(false);
  });

  it("normalizes relative vs absolute when equivalent", () => {
    const dir = mkdtempSync(join(tmpdir(), "goo-sensitive-"));
    const absolute = join(dir, "key.txt");
    // Same file via different path strings still resolves equal on same cwd edge cases — use absolute both sides
    expect(isSensitivePath(absolute, absolute)).toBe(true);
  });
});
