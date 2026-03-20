import { resolve } from "node:path";

export function redactSensitive(text: string, secrets: Array<string | undefined>): string {
  let redacted = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const variants = new Set([secret, secret.replace(/^0x/, "")]);
    for (const variant of variants) {
      if (!variant) continue;
      redacted = redacted.split(variant).join("[REDACTED_PRIVATE_KEY]");
    }
  }
  return redacted;
}

export function isSensitivePath(path: string, privateKeyFile?: string): boolean {
  if (!privateKeyFile) return false;
  try {
    return resolve(path) === resolve(privateKeyFile);
  } catch {
    return false;
  }
}
