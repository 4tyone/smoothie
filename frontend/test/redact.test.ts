// Secret redaction (spec 06 · §2) — secrets never enter facts, the BC, or the env
// handed to processor subprocesses.

import { describe as suite, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildRedactor, sanitizedEnv } from "../src/redact.ts";
import { describe } from "../src/stages/describe.ts";
import type { ModelGateway } from "../src/model/gateway.ts";

suite("fact redactor", () => {
  it("redacts built-in secret shapes with no config", () => {
    const redact = buildRedactor();
    expect(redact("key is sk-abcdef0123456789ABCDEF now")).toContain("[REDACTED]");
    expect(redact("aws AKIA1234567890ABCDEF here")).toContain("[REDACTED]");
    expect(redact("Authorization: Bearer abcdef012345.token")).toContain("[REDACTED]");
    expect(redact("-----BEGIN RSA PRIVATE KEY-----")).toBe("[REDACTED]");
  });

  it("redacts configured patterns too", () => {
    const redact = buildRedactor(["ACME-\\d{4}", "internal.example.com"]);
    expect(redact("token ACME-1234 leaked")).toBe("token [REDACTED] leaked");
    expect(redact("visit internal.example.com")).toBe("visit [REDACTED]");
  });

  it("leaves ordinary text untouched and is idempotent", () => {
    const redact = buildRedactor(["ACME-\\d{4}"]);
    const clean = "The billing area lists invoices and statuses.";
    expect(redact(clean)).toBe(clean);
    expect(redact(redact("ACME-1234"))).toBe("[REDACTED]"); // no double-redaction artifacts
  });

  it("survives an invalid regex pattern by matching it literally", () => {
    const redact = buildRedactor(["("]); // invalid regex
    expect(redact("a ( b")).toBe("a [REDACTED] b");
  });
});

suite("env sanitizer", () => {
  it("strips credential-shaped variables, keeps the rest", () => {
    const env = sanitizedEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      OPENAI_API_KEY: "sk-secret",
      AWS_SECRET_ACCESS_KEY: "z",
      GITHUB_TOKEN: "ghp_x",
      DB_PASSWORD: "p",
      MY_SESSION: "s",
      UV_CACHE_DIR: "/tmp/uv",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.UV_CACHE_DIR).toBe("/tmp/uv");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.MY_SESSION).toBeUndefined();
  });

  it("keeps allowlisted names that would otherwise match", () => {
    const env = sanitizedEnv({ SSH_AUTH_SOCK: "/tmp/sock" });
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/sock");
  });
});

suite("describe redacts secrets before they enter the fact pool", () => {
  it("a secret authored into a fact is redacted in the materialized fact + cache", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-redact-"));
    const corpus = path.join(tmp, "corpus");
    const bcDir = path.join(corpus, ".smoothie");
    fs.mkdirSync(corpus, { recursive: true });
    fs.writeFileSync(path.join(corpus, "notes.md"), "# notes");

    const gateway: ModelGateway = {
      kind: "real",
      async extract() { throw new Error("unused"); },
      async extractWithTools() {
        return {
          facts: [
            { kind: "knowledge", text: "The API key is sk-abcdef0123456789ABCDEF and the host is prod.", confidence: 0.9, fidelity: "claimed", locator: "l" },
          ],
        } as never;
      },
    };
    const src = { source_id: "src-notes-md", kind: "markdown", path: path.join(corpus, "notes.md"), relPath: "notes.md", hash: "h1" };
    const bundle = await describe([src], gateway, bcDir, "b1", {}, { folder: corpus, modalities: {}, redactPatterns: [] });

    expect(bundle.facts[0].text).toContain("[REDACTED]");
    expect(bundle.facts[0].text).not.toContain("sk-abcdef");
    // The on-disk cache is redacted too (secrets must not sit in .smoothie/stages).
    const cached = fs.readFileSync(path.join(bcDir, "stages", "describe", "src-notes-md.json"), "utf8");
    expect(cached).not.toContain("sk-abcdef");

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
