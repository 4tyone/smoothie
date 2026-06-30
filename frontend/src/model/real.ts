// The real model gateway (spec 07 · model). Runs on **pi-ai** — the engine Flue
// is built on (`@earendil-works/pi-ai`). Flue's higher-level harness assumes an
// HTTP server runtime (its `invoke()` is "called from a Flue-built server entry"),
// which doesn't fit a CLI compiler; pi-ai is the same model layer, usable
// in-process, and it speaks the Codex subscription endpoint natively.
//
// Auth, in precedence order:
//   1. ChatGPT **subscription** (Codex OAuth via Pi) → `openai-codex/gpt-5.5` on
//      https://chatgpt.com/backend-api. No API key.
//   2. A pay-per-token API key (`OPENAI_API_KEY`) → `openai/gpt-5.5`.
//
// Structured output: the model is asked for a single JSON object; we extract and
// repair it, then validate against the request's Valibot schema (retrying once
// with the validation error) — so a malformed extraction is rejected, not used.

import * as v from "valibot";
import { parseJsonWithRepair, type MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Context, Model, Api, Message, ToolCall, ThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelGateway, ExtractRequest, AgentExtractRequest } from "./gateway.ts";
import { getCodexCredential, CODEX_PROVIDER, CODEX_MODEL_ID } from "./codex-auth.ts";

interface Resolved {
  provider: string;
  modelId: string;
  apiKey: string;
  source: "chatgpt-subscription" | "api-key";
}

// Extraction is mechanical (read printed text/tables), so the describe agent runs
// at minimal reasoning by default — far faster than `low` over a growing context,
// with no quality loss. Tunable via SMOOTHIE_REASONING.
const AGENT_REASONING = (process.env.SMOOTHIE_REASONING ?? "minimal") as ThinkingLevel;

export class RealModelGateway implements ModelGateway {
  readonly kind = "real" as const;
  private readonly models: MutableModels;

  private constructor(private readonly auth: Resolved) {
    // pi-ai's full built-in catalog, incl. the `openai-codex` subscription provider.
    this.models = builtinModels();
  }

  /** Resolve credentials (subscription first, then API key) or fail with help. */
  static async create(): Promise<RealModelGateway> {
    const codex = await getCodexCredential();
    if (codex) {
      return new RealModelGateway({ ...codex, apiKey: codex.accessToken, source: "chatgpt-subscription" });
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      return new RealModelGateway({ provider: "openai", modelId: "gpt-5.5", apiKey, source: "api-key" });
    }
    throw new Error(
      "No model credential. Use your ChatGPT subscription:\n" +
        "  npx @earendil-works/pi-ai login openai-codex     # writes ./auth.json\n" +
        `then re-run \`smoothie compile <folder>\` — it will use ${CODEX_PROVIDER}/${CODEX_MODEL_ID} on your subscription.\n` +
        "Alternatively set OPENAI_API_KEY for a pay-per-token key.",
    );
  }

  /** A human-readable note for telemetry/CLI (no secrets). */
  get description(): string {
    return `${this.auth.provider}/${this.auth.modelId} (${this.auth.source})`;
  }

  /** Resolve a per-stage model override (`"provider/modelId"` or `"modelId"`) to a
   *  pi-ai model, falling back to the authenticated default. */
  private pickModel(override?: string): Model<Api> {
    let provider = this.auth.provider, modelId = this.auth.modelId;
    if (override) {
      const slash = override.indexOf("/");
      if (slash >= 0) { provider = override.slice(0, slash); modelId = override.slice(slash + 1); }
      else modelId = override;
    }
    const m = this.models.getModel(provider, modelId) as Model<Api> | undefined;
    if (!m) throw new Error(`pi-ai has no model ${provider}/${modelId}`);
    return m;
  }

  async extract<S extends v.GenericSchema>(req: ExtractRequest<S>): Promise<v.InferOutput<S>> {
    const model = this.pickModel(req.model);

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
      const msg = await this.models.completeSimple(model, context, { apiKey: this.auth.apiKey, reasoning });
      const text = msg.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("").trim();

      try {
        const json = parseJsonWithRepair(extractJsonObject(text));
        return v.parse(req.schema, json);
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    throw new Error(`real model returned unparseable/invalid JSON for '${req.label}': ${lastErr}`);
  }

  /**
   * Agentic extraction: the model explores a source by writing and running
   * Python (via the provided tools), then returns structured data. This is how
   * the `describe` stage squeezes meaningful data out of any modality — the
   * agent picks the right libraries (pdfplumber, pandas, PyMuPDF, …) guided by a
   * per-modality skill, instead of a fixed extractor.
   */
  async extractWithTools<S extends v.GenericSchema>(req: AgentExtractRequest<S>): Promise<v.InferOutput<S>> {
    const model = this.pickModel(req.model);
    const reasoning = (req.reasoning ?? AGENT_REASONING) as ThinkingLevel;

    const toolByName = new Map(req.tools.map((t) => [t.name, t]));
    const piTools = req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as never }));
    const messages: Message[] = [{ role: "user", content: [{ type: "text", text: req.user }], timestamp: Date.now() }];

    const maxSteps = req.maxSteps ?? 10;
    for (let step = 0; step < maxSteps; step++) {
      const msg = await this.models.completeSimple(
        model,
        { systemPrompt: req.system, messages, tools: piTools },
        { apiKey: this.auth.apiKey, reasoning },
      );
      messages.push(msg);
      const calls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
      if (calls.length === 0) break; // the model is done exploring

      for (const call of calls) {
        const tool = toolByName.get(call.name);
        let out: string;
        let isError = false;
        try {
          out = tool ? await tool.run(call.arguments) : `unknown tool ${call.name}`;
          if (!tool) isError = true;
        } catch (e) {
          out = (e as Error).message;
          isError = true;
        }
        messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: out.slice(0, 30000) }],
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
      const msg = await this.models.completeSimple(model, { systemPrompt: req.system, messages }, { apiKey: this.auth.apiKey, reasoning });
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
