// Resolve a ChatGPT-subscription credential (spec 07 · model).
//
// Pi implements OpenAI's "Sign in with ChatGPT" Codex OAuth flow; `gpt-5.5` is in
// the Codex subscription catalog (provider `openai-codex` →
// https://chatgpt.com/backend-api). We read the token Pi saved at login and
// refresh it if near expiry; the caller passes it to pi-ai as the request's
// `apiKey` (the bearer token; the account id is decoded from the JWT). So a
// compile runs on the user's subscription — no pay-per-token API key needed.
//
// Log in once (interactive, the user's own ChatGPT account):
//   npx @earendil-works/pi-ai login openai-codex     # writes ./auth.json

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";

export const CODEX_PROVIDER = "openai-codex";
export const CODEX_MODEL_ID = "gpt-5.5";

interface StoredOAuth {
  type?: string;
  access: string;
  refresh: string;
  expires: number;
  [k: string]: unknown;
}

export interface CodexCredential {
  provider: string;
  modelId: string;
  accessToken: string;
}

function authFiles(): string[] {
  const files: string[] = [];
  if (process.env.PI_AUTH_FILE) files.push(process.env.PI_AUTH_FILE);
  files.push(path.resolve("auth.json")); // pi-ai SDK CLI writes to CWD
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  files.push(path.join(agentDir, "auth.json")); // pi TUI
  return files;
}

function findCodexCredential(): { file: string; cred: StoredOAuth } | null {
  for (const file of authFiles()) {
    if (!fs.existsSync(file)) continue;
    try {
      const all = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, StoredOAuth>;
      const cred = all[CODEX_PROVIDER];
      if (cred?.access && cred.refresh) return { file, cred };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function expiresMs(expires: number): number {
  return expires < 1e12 ? expires * 1000 : expires;
}

/**
 * Return a usable Codex access token (refreshed if near expiry), or null if the
 * user hasn't logged in with their ChatGPT subscription.
 */
export async function getCodexCredential(): Promise<CodexCredential | null> {
  const found = findCodexCredential();
  if (!found) return null;
  const provider = getOAuthProvider(CODEX_PROVIDER);
  if (!provider) return null;

  let cred = found.cred;
  if (expiresMs(cred.expires) <= Date.now() + 60_000) {
    const refreshed = await provider.refreshToken(cred);
    cred = { type: "oauth", ...refreshed };
    const all = JSON.parse(fs.readFileSync(found.file, "utf8")) as Record<string, unknown>;
    all[CODEX_PROVIDER] = cred;
    fs.writeFileSync(found.file, JSON.stringify(all, null, 2));
  }

  return { provider: CODEX_PROVIDER, modelId: CODEX_MODEL_ID, accessToken: provider.getApiKey(cred) };
}
