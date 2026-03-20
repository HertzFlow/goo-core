import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

function validateMode(path: string, mode: number, expectedMask: number, kind: string): void {
  if ((mode & expectedMask) !== 0) {
    throw new Error(`${kind} permissions too open for ${path}; expected owner-only access`);
  }
}

export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    throw new Error("Private key file must contain a single 32-byte hex private key");
  }
  return prefixed;
}

export function loadPrivateKeyFromFile(privateKeyFile: string): string {
  const fullPath = resolve(privateKeyFile);
  const fileStat = statSync(fullPath);
  if (!fileStat.isFile()) {
    throw new Error(`Private key path is not a file: ${fullPath}`);
  }
  validateMode(fullPath, fileStat.mode, 0o077, "Private key file");

  const dirPath = dirname(fullPath);
  const dirStat = statSync(dirPath);
  if (!dirStat.isDirectory()) {
    throw new Error(`Private key parent is not a directory: ${dirPath}`);
  }
  validateMode(dirPath, dirStat.mode, 0o077, "Private key directory");

  return normalizePrivateKey(readFileSync(fullPath, "utf-8"));
}
