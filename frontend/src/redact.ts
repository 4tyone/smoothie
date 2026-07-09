// Secret redaction (spec 06 · §2) — secrets never enter the BC, the fact pool, or
// logs. Two defences the producer owns:
//   • a fact-text redactor (configured `policy.secrets.redact_patterns` plus a
//     built-in set of common secret shapes), applied before facts are cached; and
//   • an env sanitizer that strips credential-shaped variables from the environment
//     handed to processor subprocesses, so a third-party processor never sees the
//     operator's API keys.

const PLACEHOLDER = "[REDACTED]";

/** Built-in secret shapes — a safety net independent of configured patterns:
 *  OpenAI/Anthropic-style keys, AWS access key ids, bearer tokens, and PEM
 *  private-key headers. Deliberately conservative (secret-shaped, not PII). */
const BUILTIN_SECRET_RES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic-style
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack token
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, // bearer tokens
  /-----BEGIN[ A-Z]*PRIVATE KEY-----/g, // PEM private keys
];

/** Compile a caller pattern into a RegExp. A pattern that is already a valid
 *  regex source is used as-is (global); otherwise it is matched literally. */
function toRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "g");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  }
}

/** Build a redactor from configured patterns (+ the built-in set). Idempotent:
 *  redacting already-redacted text is a no-op. */
export function buildRedactor(patterns: string[] = []): (text: string) => string {
  const res = [...BUILTIN_SECRET_RES, ...patterns.map(toRegExp)];
  return (text: string): string => {
    let out = text;
    for (const re of res) out = out.replace(re, PLACEHOLDER);
    return out;
  };
}

/** Env variables whose NAME marks them as credentials — never handed to a
 *  processor subprocess (spec 06 · author-machine trust still shouldn't leak the
 *  operator's keys to third-party processor code). */
const SENSITIVE_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE)/i;
/** Names that match the pattern but are safe/needed by tooling. */
const ENV_ALLOWLIST = new Set(["SSH_AUTH_SOCK", "GPG_TTY"]);

/** A copy of `process.env` with credential-shaped variables stripped. This is the
 *  base env for processor subprocesses; SMOOTHIE_* additions are merged over it. */
export function sanitizedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, val] of Object.entries(base)) {
    if (SENSITIVE_ENV_RE.test(k) && !ENV_ALLOWLIST.has(k)) continue;
    out[k] = val;
  }
  return out;
}
