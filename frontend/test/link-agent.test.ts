// The lazy-loading link navigation agent — it explores the graph through tools and
// proposes cross-source connections, holding only its working set. Code records the
// proposals (receipts are materialized in link.ts). Here we drive the tools with a
// fake gateway and assert the decisions are gathered + validated.

import { describe as suite, it, expect } from "vitest";
import { runLinkAgent, type NavNode, type NavView } from "../src/agent/link-agent.ts";
import type { ModelGateway } from "../src/model/gateway.ts";

const NODES: NavNode[] = [
  { id: "n-a1", title: "Q1 revenue $14.2B", source: "src-a", view_id: "v-a", isNew: true, summary: "revenue", facts: ["Q1 revenue was $14.2B"] },
  { id: "n-a2", title: "Board bio", source: "src-a", view_id: "v-a", isNew: true, summary: null, facts: [] },
  { id: "n-b1", title: "Revenue 14.2 billion in Q1", source: "src-b", view_id: "v-b", isNew: false, summary: "rev", facts: ["Revenue: $14.2 billion, Q1"] },
];
const VIEWS: NavView[] = [{ view_id: "v-a", title: "A" }, { view_id: "v-b", title: "B" }];

/** A fake agent that navigates: list → read → propose (edge, merge, orphan), plus
 *  a couple of invalid proposals the tools must reject. */
function navGateway(): ModelGateway {
  return {
    kind: "real",
    async extract() { throw new Error("unused"); },
    async extractWithTools(req) {
      const tool = (name: string) => req.tools.find((t) => t.name === name)!;
      // The TOC gives global awareness: every node, one line, across sources.
      const toc = (await tool("read_toc").run({})) as string;
      expect(toc).toContain("n-a1");
      expect(toc).toContain("n-b1"); // sees BOTH sources at once — no source-by-source crawl
      const drilled = (await tool("read_toc").run({ source_id: "src-a" })) as string;
      expect(drilled).toContain("n-a1");
      await tool("read_nodes").run({ ids: ["n-a1", "n-b1"] });
      // valid: a real cross-source edge
      expect(await tool("propose_edge").run({ from: "n-a1", to: "n-b1", kind: "related_to", label: "same revenue fact" })).toBe("recorded");
      // invalid: unknown id, bad kind, self-loop — all rejected, not recorded
      expect(await tool("propose_edge").run({ from: "n-a1", to: "nope", kind: "related_to" })).toContain("rejected");
      expect(await tool("propose_edge").run({ from: "n-a1", to: "n-b1", kind: "teleports_to" })).toContain("rejected");
      expect(await tool("propose_merge").run({ from_view: "v-a", into_view: "v-b" })).toBe("recorded");
      expect(await tool("mark_orphan").run({ node_id: "n-a2", reason: "no counterpart" })).toBe("recorded");
      return { done: true } as never;
    },
  };
}

suite("link navigation agent", () => {
  it("gathers validated decisions from the agent's tool calls", async () => {
    const decision = await runLinkAgent({ nodes: NODES, views: VIEWS, goals: [] }, navGateway());
    // Only the VALID edge was recorded (bad ids / bad kind / self-loop rejected).
    expect(decision.induced_edges).toEqual([{ from: "n-a1", to: "n-b1", kind: "related_to", label: "same revenue fact" }]);
    expect(decision.view_merges).toEqual([{ from: "v-a", into: "v-b" }]);
    expect(decision.orphans).toEqual([{ node_id: "n-a2", reason: "no counterpart" }]);
  });

  it("opens with the TOC (global awareness) but loads DETAIL lazily", async () => {
    let userMsg = "";
    const gw: ModelGateway = {
      kind: "real",
      async extract() { throw new Error("unused"); },
      async extractWithTools(req) { userMsg = req.user; return { done: true } as never; },
    };
    await runLinkAgent({ nodes: NODES, views: VIEWS, goals: [{ id: "g", text: "goal" }] }, gw);
    // The TOC (id + source + TITLE for every node) is in the opening — global awareness.
    expect(userMsg).toContain("n-a1");
    expect(userMsg).toContain("Q1 revenue $14.2B"); // titles, across all sources, up front
    // But DETAIL (summaries + fact text) is NOT dumped — it's pulled on demand via read_nodes.
    expect(userMsg).not.toContain("Q1 revenue was $14.2B"); // the fact text
  });
});
