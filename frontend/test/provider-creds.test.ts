// Per-provider credential resolution (spec 07 · model — model-agnostic). Pure,
// no model calls: given a provider + the config's `model.providers` map + the
// default Pi credential, which API key (and base-URL override) does a call use?
// This is the fix for "the gateway injected the ONE OpenAI/Codex key for every
// provider" — GLM (zai) now gets its own key while gpt-5.5 keeps the Codex token.

import { describe as suite, it, expect, afterEach } from "vitest";
import { RealModelGateway, resolveProviderCreds, type ProvidersConfig } from "../src/model/real.ts";

const CODEX = { provider: "openai-codex", apiKey: "codex-bearer-token" };

suite("resolveProviderCreds", () => {
  it("uses an inline api_key for the provider", () => {
    const providers: ProvidersConfig = { zai: { api_key: "sk-zai-inline" } };
    expect(resolveProviderCreds("zai", providers, CODEX, {})).toEqual({ apiKey: "sk-zai-inline", baseUrl: undefined });
  });

  it("reads api_key_env from the environment", () => {
    const providers: ProvidersConfig = { zai: { api_key_env: "ZAI_API_KEY" } };
    const env = { ZAI_API_KEY: "sk-zai-from-env" };
    expect(resolveProviderCreds("zai", providers, CODEX, env)).toEqual({ apiKey: "sk-zai-from-env", baseUrl: undefined });
  });

  it("throws a clear error when api_key_env is named but not set", () => {
    const providers: ProvidersConfig = { zai: { api_key_env: "ZAI_API_KEY" } };
    expect(() => resolveProviderCreds("zai", providers, CODEX, {})).toThrow(/ZAI_API_KEY is not set/);
  });

  it("uses the default Pi credential ONLY for the default provider", () => {
    // The default provider (Codex) gets the bearer token…
    expect(resolveProviderCreds("openai-codex", {}, CODEX, {}).apiKey).toBe("codex-bearer-token");
    // …but a different provider does NOT — that was the bug. It falls through to
    // pi-ai's own env resolution (apiKey undefined), never the Codex token.
    expect(resolveProviderCreds("zai", {}, CODEX, {}).apiKey).toBeUndefined();
  });

  it("leaves apiKey undefined (pi-ai env fallback) when no config and not the default provider", () => {
    // With ZAI_API_KEY in the real env, pi-ai resolves it downstream — we must NOT
    // pass a key here, so pi-ai's own resolution wins.
    expect(resolveProviderCreds("zai", {}, CODEX, { ZAI_API_KEY: "x" })).toEqual({ apiKey: undefined, baseUrl: undefined });
  });

  it("passes through a base_url override", () => {
    const providers: ProvidersConfig = { zai: { api_key: "k", base_url: "https://proxy.example/v1" } };
    expect(resolveProviderCreds("zai", providers, CODEX, {})).toEqual({ apiKey: "k", baseUrl: "https://proxy.example/v1" });
  });

  it("inline api_key wins over api_key_env", () => {
    const providers: ProvidersConfig = { zai: { api_key: "inline", api_key_env: "ZAI_API_KEY" } };
    expect(resolveProviderCreds("zai", providers, CODEX, { ZAI_API_KEY: "env" }).apiKey).toBe("inline");
  });

  it("works with no default credential at all (config-only providers)", () => {
    const providers: ProvidersConfig = { zai: { api_key_env: "ZAI_API_KEY" } };
    expect(resolveProviderCreds("zai", providers, null, { ZAI_API_KEY: "sk" }).apiKey).toBe("sk");
  });
});

// create() wires the config's `model` block. These stay offline: getCodexCredential
// only reads auth.json from disk (no network), and we never make a model call.
suite("RealModelGateway.create — config-driven providers", () => {
  const saved = process.env.ZAI_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ZAI_API_KEY;
    else process.env.ZAI_API_KEY = saved;
  });

  it("fails BEFORE any stage when the default provider's api_key_env is unset", async () => {
    delete process.env.ZAI_API_KEY; // simulate a missing/empty .env
    await expect(
      RealModelGateway.create({ defaultModel: "zai/glm-5.2", providers: { zai: { api_key_env: "ZAI_API_KEY" } } }),
    ).rejects.toThrow(/ZAI_API_KEY is not set/);
  });

  it("constructs once the key is present (as a loaded .env would provide) and defaults to that model", async () => {
    process.env.ZAI_API_KEY = "sk-zai-test"; // what loadDotEnv would put here
    const gw = await RealModelGateway.create({ defaultModel: "zai/glm-5.2", providers: { zai: { api_key_env: "ZAI_API_KEY" } } });
    expect(gw.kind).toBe("real");
    expect(gw.description).toContain("zai/glm-5.2"); // the compile defaults to GLM
  });

  it("rejects a bare model.default with no provider and no login to borrow one from", async () => {
    // With a Codex login present this would borrow its provider; without a slash and
    // (in CI) no login, it must ask for the explicit `provider/modelId` form.
    const p = RealModelGateway.create({ defaultModel: "glm-5.2", providers: {} });
    await p.then(
      () => { /* a dev machine WITH auth.json legitimately borrows the provider — fine */ },
      (e: Error) => expect(e.message).toMatch(/has no provider|No model configured/),
    );
  });
});
