// The real model gateway (spec 07 · model). Runs on **pi-ai** — the engine Flue
// is built on (`@earendil-works/pi-ai`). Flue's higher-level harness assumes an
// HTTP server runtime (its `invoke()` is "called from a Flue-built server entry"),
// which doesn't fit a CLI compiler; pi-ai is the same model layer, usable
// in-process, and it speaks the Codex subscription endpoint natively.
//
// Model-agnostic by construction (spec 07). Every call resolves its credential by
// PROVIDER, so a compile can mix providers (e.g. gpt-5.5 for describe, glm for
// link). The default credential comes from Pi, in precedence order:
//   1. ChatGPT **subscription** (Codex OAuth via Pi) → `openai-codex/gpt-5.5`.
//   2. A pay-per-token API key (`OPENAI_API_KEY`) → `openai/gpt-5.5`.
// …but `smoothie_config.yaml` can override entirely: `model.default` picks the
// provider/model, and `model.providers` supplies each provider's key (inline,
// from a named env var, or the provider's own conventional env var via pi-ai).
// So Smoothie is configured from within, not tied to a single Pi login.
//
// Structured output: the model is asked for a single JSON object; we extract and
// repair it, then validate against the request's Valibot schema (retrying once
// with the validation error) — so a malformed extraction is rejected, not used.

import * as v from "valibot";
import { parseJsonWithRepair, type MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Context, Model, Api, Message, ToolCall, ThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelGateway, ExtractRequest, AgentExtractRequest, AgentToolResult } from "./gateway.ts";
import { getCodexCredential, CODEX_PROVIDER, CODEX_MODEL_ID } from "./codex-auth.ts";

/** The default credential resolved from Pi (subscription or `OPENAI_API_KEY`). */
interface Resolved {
  provider: string;
  modelId: string;
  apiKey: string;
  source: "chatgpt-subscription" | "api-key";
}

/** Per-provider credentials declared in `model.providers` (see config.ts). */
export interface ProviderCreds {
  api_key?: string;
  api_key_env?: string;
  base_url?: string;
}
export type ProvidersConfig = Record<string, ProviderCreds>;

/** How the gateway is configured from `smoothie_config.yaml`'s `model` block. */
export interface CreateOpts {
  /** `provider/modelId` used when a stage sets no override (from `model.default`). */
  defaultModel?: string;
  /** Per-provider credentials (from `model.providers`). */
  providers?: ProvidersConfig;
}

/** Resolve the API key + base-URL override for ONE provider — a pure function so
 *  it is unit-testable without any model call. Precedence:
 *    1. `providers[p].api_key`            (inline key)
 *    2. `providers[p].api_key_env`        (named env var; throws if set-but-missing)
 *    3. the default Pi credential          (only when p is the default provider)
 *    4. undefined → pi-ai resolves the provider's own env var (e.g. ZAI_API_KEY).
 *  A `base_url` override is passed through when present. */
export function resolveProviderCreds(
  provider: string,
  providers: ProvidersConfig,
  defaultAuth: Pick<Resolved, "provider" | "apiKey"> | null,
  env: Record<string, string | undefined> = process.env,
): { apiKey?: string; baseUrl?: string } {
  const cfg = providers[provider];
  let apiKey: string | undefined;
  if (cfg?.api_key) {
    apiKey = cfg.api_key;
  } else if (cfg?.api_key_env) {
    apiKey = env[cfg.api_key_env];
    if (!apiKey) {
      throw new Error(
        `provider '${provider}': config sets api_key_env='${cfg.api_key_env}' but ${cfg.api_key_env} is not set in the environment. ` +
          `Export ${cfg.api_key_env}=… or put the key inline as model.providers.${provider}.api_key.`,
      );
    }
  } else if (defaultAuth && provider === defaultAuth.provider) {
    apiKey = defaultAuth.apiKey;
  }
  // else: leave undefined so pi-ai resolves the provider's conventional env var.
  return { apiKey, baseUrl: cfg?.base_url };
}

// Extraction is mechanical (read printed text/tables), so the describe agent runs
// at minimal reasoning by default — far faster than `low` over a growing context,
// with no quality loss. Tunable via SMOOTHIE_REASONING.
const AGENT_REASONING = (process.env.SMOOTHIE_REASONING ?? "minimal") as ThinkingLevel;

export class RealModelGateway implements ModelGateway {
  readonly kind = "real" as const;
  private readonly models: MutableModels;

  private constructor(
    /** The default Pi credential, or null when the config drives providers itself. */
    private readonly defaultAuth: Resolved | null,
    private readonly providers: ProvidersConfig,
    private readonly defProvider: string,
    private readonly defModelId: string,
  ) {
    // pi-ai's full built-in catalog, incl. the `openai-codex` subscription provider.
    this.models = builtinModels();
  }

  /** Build the gateway from the config's `model` block. Resolves the default Pi
   *  credential (subscription first, then API key) if present, picks the default
   *  model, and fails early — with guidance — only if nothing at all is usable. */
  static async create(opts: CreateOpts = {}): Promise<RealModelGateway> {
    const providers = opts.providers ?? {};

    let defaultAuth: Resolved | null = null;
    const codex = await getCodexCredential();
    if (codex) {
      defaultAuth = { ...codex, apiKey: codex.accessToken, source: "chatgpt-subscription" };
    } else if (process.env.OPENAI_API_KEY) {
      defaultAuth = { provider: "openai", modelId: "gpt-5.5", apiKey: process.env.OPENAI_API_KEY, source: "api-key" };
    }

    // The default model (used when a stage sets no override): `model.default`
    // wins; otherwise the authenticated provider's model.
    let defProvider: string, defModelId: string;
    if (opts.defaultModel) {
      const slash = opts.defaultModel.indexOf("/");
      if (slash >= 0) {
        defProvider = opts.defaultModel.slice(0, slash);
        defModelId = opts.defaultModel.slice(slash + 1);
      } else {
        // A bare model id needs a provider — take the logged-in one, else ask.
        if (!defaultAuth) {
          throw new Error(
            `model.default='${opts.defaultModel}' has no provider. Write it as 'provider/modelId' (e.g. 'zai/glm-4.7').`,
          );
        }
        defProvider = defaultAuth.provider;
        defModelId = opts.defaultModel;
      }
    } else if (defaultAuth) {
      defProvider = defaultAuth.provider;
      defModelId = defaultAuth.modelId;
    } else {
      throw new Error(
        "No model configured. Either:\n" +
          "  • sign in to your ChatGPT subscription:  npx @earendil-works/pi-ai login openai-codex\n" +
          `    (then compile uses ${CODEX_PROVIDER}/${CODEX_MODEL_ID}), or\n` +
          "  • set OPENAI_API_KEY for a pay-per-token key, or\n" +
          "  • set model.default (e.g. 'zai/glm-4.7') + model.providers in smoothie_config.yaml.",
      );
    }

    const gw = new RealModelGateway(defaultAuth, providers, defProvider, defModelId);
    // Fail before any stage runs if the default provider's key can't be resolved
    // (e.g. api_key_env named but not exported) — a clear config error, not a
    // mid-compile model failure.
    gw.credsFor(defProvider);
    return gw;
  }

  /** A human-readable note for telemetry/CLI (no secrets). Reflects how the DEFAULT
   *  provider's key actually resolves — not merely that a Pi login happens to exist. */
  get description(): string {
    const cfg = this.providers[this.defProvider];
    const src = cfg?.api_key
      ? "config"
      : cfg?.api_key_env
        ? `env:${cfg.api_key_env}`
        : this.defaultAuth && this.defProvider === this.defaultAuth.provider
          ? this.defaultAuth.source
          : "provider-env";
    return `${this.defProvider}/${this.defModelId} (${src})`;
  }

  /** Resolve the key + base-URL override for a provider (config → default → env). */
  private credsFor(provider: string): { apiKey?: string; baseUrl?: string } {
    return resolveProviderCreds(provider, this.providers, this.defaultAuth, process.env);
  }

  /** Resolve a per-stage model override (`"provider/modelId"` or `"modelId"`) to a
   *  pi-ai model + its provider-specific credentials, falling back to the default. */
  private prepare(override?: string): { model: Model<Api>; apiKey?: string } {
    let provider = this.defProvider, modelId = this.defModelId;
    if (override) {
      const slash = override.indexOf("/");
      if (slash >= 0) { provider = override.slice(0, slash); modelId = override.slice(slash + 1); }
      else modelId = override;
    }
    const m = this.models.getModel(provider, modelId) as Model<Api> | undefined;
    if (!m) throw new Error(`pi-ai has no model ${provider}/${modelId}`);
    const { apiKey, baseUrl } = this.credsFor(provider);
    return { model: baseUrl ? { ...m, baseUrl } : m, apiKey };
  }

  async extract<S extends v.GenericSchema>(req: ExtractRequest<S>): Promise<v.InferOutput<S>> {
    const { model, apiKey } = this.prepare(req.model);

    const sys =
      `${req.instruction}\n\n` +
      "Respond with ONLY a single JSON object that satisfies the requested shape. " +
      "No prose, no markdown code fences.";

    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const userText = attempt === 0 ? req.content : `${req.content}\n\nYour previous reply was invalid: ${lastErr}\nReturn ONLY corrected JSON.`;
      const content: Context["messages"][number]["content"] = [
        { type: "text", text: userText } as { type: "text"; text: string },
        ...(req.images ?? []).map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mimeType })),
      ];
      const context: Context = { systemPrompt: sys, messages: [{ role: "user", content, timestamp: Date.now() }] };

      const reasoning = (req.reasoning ?? "low") as ThinkingLevel;
      const msg = await this.models.completeSimple(model, context, { apiKey, reasoning });
      const text = msg.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("").trim();

      // Distinguish an API-level failure (empty/errored response — rate limit,
      // quota, auth) from a genuine parse error. Reporting the former as "invalid
      // JSON" is deeply misleading (it sent a debugging session down the wrong path).
      const stopReason = (msg as { stopReason?: string }).stopReason;
      if (stopReason === "error" || text.length === 0) {
        lastErr = `model API returned an empty/errored response (stopReason=${stopReason ?? "none"}) — likely rate limit, quota, or auth`;
        continue;
      }
      try {
        const json = parseJsonWithRepair(extractJsonObject(text));
        return v.parse(req.schema, json);
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    throw new Error(`real model failed for '${req.label}': ${lastErr}`);
  }

  /**
   * Agentic extraction: the model explores a source by writing and running
   * Python (via the provided tools), then returns structured data. This is how
   * the `describe` stage squeezes meaningful data out of any modality — the
   * agent picks the right libraries (pdfplumber, pandas, PyMuPDF, …) guided by a
   * per-modality skill, instead of a fixed extractor.
   */
  async extractWithTools<S extends v.GenericSchema>(req: AgentExtractRequest<S>): Promise<v.InferOutput<S>> {
    const { model, apiKey } = this.prepare(req.model);
    const reasoning = (req.reasoning ?? AGENT_REASONING) as ThinkingLevel;

    const toolByName = new Map(req.tools.map((t) => [t.name, t]));
    const piTools = req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as never }));
    const messages: Message[] = [{ role: "user", content: [{ type: "text", text: req.user }], timestamp: Date.now() }];

    const maxSteps = req.maxSteps ?? 10;
    for (let step = 0; step < maxSteps; step++) {
      const msg = await this.models.completeSimple(
        model,
        { systemPrompt: req.system, messages, tools: piTools },
        { apiKey, reasoning },
      );
      messages.push(msg);
      const calls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
      if (calls.length === 0) break; // the model is done exploring

      for (const call of calls) {
        const tool = toolByName.get(call.name);
        let out: string | AgentToolResult;
        let isError = false;
        try {
          out = tool ? await tool.run(call.arguments) : `unknown tool ${call.name}`;
          if (!tool) isError = true;
        } catch (e) {
          out = (e as Error).message;
          isError = true;
        }
        // A tool may return images (`read_image`) — attach them as image content
        // blocks so the model actually SEES the pixels, not a path string.
        const content =
          typeof out === "string"
            ? [{ type: "text" as const, text: out.slice(0, 30000) }]
            : [
                { type: "text" as const, text: (out.text ?? "(image attached)").slice(0, 30000) },
                ...(out.images ?? []).map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mimeType })),
              ];
        messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content,
          isError,
          timestamp: Date.now(),
        });
      }
    }

    // Final structured-output call over the gathered evidence (no tools).
    messages.push({
      role: "user",
      content: [{ type: "text", text: "Now return ONLY the JSON object of facts in the requested shape, based on everything you extracted. No prose, no code fences." }],
      timestamp: Date.now(),
    });
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const msg = await this.models.completeSimple(model, { systemPrompt: req.system, messages }, { apiKey, reasoning });
      const text = msg.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("").trim();
      try {
        return v.parse(req.schema, parseJsonWithRepair(extractJsonObject(text)));
      } catch (e) {
        lastErr = (e as Error).message;
        messages.push(msg, { role: "user", content: [{ type: "text", text: `That JSON was invalid: ${lastErr}. Return ONLY corrected JSON.` }], timestamp: Date.now() });
      }
    }
    throw new Error(`agent extraction returned invalid JSON for '${req.label}': ${lastErr}`);
  }
}

/** Extract the outermost JSON object from a model reply (tolerates stray prose). */
function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
