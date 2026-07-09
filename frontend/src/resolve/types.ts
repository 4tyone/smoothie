// Resolvers — the verify-side extension point (spec 08). A Resolver checks a node
// against **ground truth** and, on success, promotes its fidelity to `confirmed`
// with a real resolution receipt. The mirror image of Readers: a Reader projects
// an input *into* the graph; a Resolver checks a node *against* reality.
//
// `confirmed` always means "checked against something real": a confirmed
// Resolution MUST carry a resolution receipt (a `resolve`/`crawl`/`live` span) and
// evaluated checks — the SVM's compile gate rejects any `confirmed` lacking them.

type Obj = Record<string, unknown>;
export type GraphNode = Obj & { id: string; title: string; fidelity: string; source_refs: unknown[]; checks?: unknown[] };

/** A provenance receipt (spec 02 · SourceRef) — for a Resolver, a `resolve` span. */
export interface SourceRef {
  source_id: string;
  span: { kind: "resolve"; resolver: string; ref: string; note?: string };
}

/** An evaluated check the Resolver records as the oracle it verified. */
export type CheckObj =
  | { kind: "text_matches"; expected: string }
  | { kind: "visible"; locator: unknown }
  | { kind: "exists"; locator: unknown }
  | { kind: "url_matches"; expected: string };

export type Resolution =
  | { status: "confirmed"; receipt: SourceRef; checks: CheckObj[] }
  | { status: "unresolved"; reason: string } // stays claimed/guessed
  | { status: "gap"; reason: string }; // required but unverifiable → a gap

/** What a Resolver can see while verifying (spec 08 · ResolveContext). */
export interface ResolveContext {
  profile: string;
  /** All nodes in the graph (cross-source corroboration needs the whole set). */
  nodes: GraphNode[];
  /** Re-read a source's original text (re-examine ground truth). */
  sourceText?: (sourceId: string) => string | undefined;
  /** A model-backed yes/no semantic judgment — how a Resolver decides "do these
   *  corroborate?" / "does this text support the claim?" WITHOUT lexical overlap.
   *  Absent only if no gateway was wired (then a Resolver stays `unresolved`
   *  rather than confirm on a guess). */
  judge?: (instruction: string, content: string) => Promise<boolean>;
}

/** A verify plugin. `profile: "*"` applies to every profile. Deterministic
 *  Resolvers return synchronously; the live crawler returns a Promise. */
export interface Resolver {
  readonly name: string;
  readonly profile: string;
  readonly groundTruth: string;
  resolve(node: GraphNode, ctx: ResolveContext): Resolution | Promise<Resolution>;
}

const RANK: Record<string, number> = { confirmed: 3, claimed: 2, guessed: 1, absent: 0 };
export const isConfirmed = (n: GraphNode): boolean => RANK[n.fidelity] === 3;
