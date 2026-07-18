// Connectors + scheduler (spec 08 §2-§3) — the real-time edition's front door.
//
// Real-time is spec 05's incremental reconciliation on a faster clock (spec 08 §1):
// a connector emits change events, the scheduler debounces a burst into ONE
// incremental build against HEAD, and because incremental converges to cold
// (Phase 4), streaming a change feed converges to the batch build of the final state.
//
// A change event is treated exactly as ingest's new/changed/deleted classification
// (spec 08 §2). Connectors are deterministic plumbing; they never interpret content
// (that is describe's job).

import * as fs from "node:fs";
import * as path from "node:path";
import type { OntologyCompileRun } from "../pipeline-ontology.ts";

/** One change from a source (spec 08 §2). `upsert` creates or edits a source;
 *  `delete` removes it (triggering retirement, spec 05 §4.5). */
export interface ChangeEvent {
  source_id: string;
  op: "upsert" | "delete";
  /** The source path relative to the corpus folder. */
  path: string;
  /** New content for an `upsert` (ignored for `delete`). */
  content?: string;
}

/** Materialize a burst of change events onto the corpus folder (deterministic
 *  plumbing). A later incremental compile reclassifies each source by content hash. */
export function applyEvents(folder: string, events: ChangeEvent[]): void {
  for (const e of events) {
    const full = path.join(folder, e.path);
    if (e.op === "delete") {
      fs.rmSync(full, { force: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, e.content ?? "");
    }
  }
}

/** The build scheduler (spec 08 §3): coalesces a burst of change events into one
 *  incremental build against HEAD. Readers always see a validated commit; a build in
 *  flight never exposes a partial state. */
export class Scheduler {
  constructor(
    private readonly folder: string,
    private readonly compile: () => Promise<OntologyCompileRun>,
  ) {}

  /** Apply a debounced burst of events, then run a single incremental build. */
  async pushBurst(events: ChangeEvent[]): Promise<OntologyCompileRun> {
    applyEvents(this.folder, events);
    return this.compile();
  }
}
