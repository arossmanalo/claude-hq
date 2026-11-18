const MASK = "••••••";

/**
 * Patterns for credentials that commonly show up in tool output and prompts. The office masks
 * them before any text leaves the server, so a screen share or screenshot never shows a key.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/** `password=hunter2`, `API_KEY: abc123`, `"token": "abc"`: keep the name, hide the value. */
const ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|password|passwd)[A-Za-z0-9_]*)("?\s*[:=]\s*"?)([^\s"',;]{4,})/gi;

export function maskSecrets(text: string): string {
  let masked = text;
  for (const pattern of SECRET_PATTERNS) masked = masked.replace(pattern, MASK);
  return masked.replace(ASSIGNMENT, (_match, name: string, separator: string) => {
    return `${name}${separator}${MASK}`;
  });
}
