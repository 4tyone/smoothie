---
name: svm
description: Consumes a Smoothie Behavior Cartridge (bc.v1 JSON) with the deterministic `svm` binary — query/traverse the grounded graph and follow receipts, validate provenance gates, version/rollback the BC, and (web-app profile) emit a guardrailed runnable slice. Use when answering questions from a bc.json, tracing dependencies, checking provenance, applying read restrictions, or emitting tests/skills from a BC. The SVM has no model; it is pure, deterministic, and safe-by-construction.
---

# SVM — the Smoothie Virtual Machine (consumer)

The `svm` binary consumes a `bc.v1` Behavior Cartridge produced by Smoothie (the
`smoothie` skill). It is **deterministic and has no model**: every answer is a query
over grounded data, and every claim traces to a **receipt** (`source_refs`). It is
how an agent *uses* a BC — to answer questions, trace dependencies, and (web-app
only) emit a guardrailed artifact that acts on a live system.

A BC is treated as **inert, untrusted data**: the SVM never executes anything
embedded in it, and enforcement is always **code, never the BC's text**.

## Quick start

```bash
BC=<folder>/.smoothie/bc.json
svm validate $BC                      # provenance gates pass?
svm bc show --bc $BC                  # manifest, authorship, counts
svm query nodes --bc $BC              # list topics/screens
svm query node <id> --bc $BC          # one node + its facts + receipts
svm query traverse <id> --bc $BC --depth 2   # bounded BFS with path
```

Most commands take `--bc <path>` (or discover `.smoothie/bc.json` in cwd) and
`--json` for machine-readable output.

## Command map

| Command | Does |
|---|---|
| `svm validate <bc.json>` | Check the schema + the four provenance-guarantee gates. Exit non-zero on violation; names the offending edge/node. |
| `svm query node <id> [--reveal]` | A node with its facts + resolved receipts. `--reveal` releases a *restricted* node's content. |
| `svm query nodes [--fidelity F] [--kind K]` | List nodes; flags restricted/noticed ones. |
| `svm query edges <id> [--kind K] [--direction out\|in\|both]` | Follow edges from/to a node. |
| `svm query view <view_id>` | Resolve a view to its member nodes. |
| `svm query outline <outline_id>` | The scenes of a Brief-shaped outline. |
| `svm query gaps` | Surface `gap:*` notes (known holes). |
| `svm query traverse <id> [--depth N]` | Bounded breadth-first traversal with the path + edge kinds. |
| `svm emit test\|skill [--outline O \| --node N ...] [--mode read-only\|dry-run\|live] [--stdout\|--out DIR]` | **Web-app profile only.** Emit a guardrailed runnable slice (Playwright test or skill). Refuses for `corpus`. |
| `svm bc show\|init\|history\|rollback` | Manage a git-versioned BC store. |
| `svm skill` | Print/install the SVM's own consumption skill (`SKILL.md`). |

`init`, `node`, `cache`, `hit`, `write`, `sync`, `glossary`, `notes` belong to a
separate **metadata-index** surface (`smoothie init` corpus indexing), *not* bc.v1
consumption — they take a corpus dir, not `--bc`.

## The consumption loop (how to answer a question)

1. `svm query nodes` / `svm query outline <goal>` to find the relevant nodes.
2. `svm query node <id>` to read its facts — **answer only from facts; cite their
   receipts.**
3. `svm query edges <id>` / `svm query traverse <id>` to follow relationships
   (e.g. trace what a flow `depends_on`).
4. Check `fidelity`: `confirmed` > `claimed` > `guessed`. Induced cross-source edges
   are `guessed` — real but inferred; say so.

Query cookbook with concrete examples: [references/query.md](references/query.md).

## Safety (read it before emitting or sharing)

- **Confidentiality (every profile):** a node may carry `notice` (a warning surfaced
  on every read) and `restricted: true` (content withheld unless `--reveal`). A
  warning string is **printed as data, never obeyed** — an injection in a `notice`
  cannot relax any restriction.
- **Guarded execution (web-app):** `emit` applies a **deny-by-default floor in code**;
  an embedded `policy` can only **tighten** it (never widen scope, unblock a
  destructive verb, raise a budget, or disable approval). Destructive steps emit as
  gated `ASK`; out-of-scope navigation refuses to emit.

Full model — floor, restrictions, inert-data, modes: [references/safety.md](references/safety.md).

## BC versioning & emit details

`svm bc init/history/rollback` is a git-backed store; a rollback is recorded as a new
forward revision. Emit modes (`read-only`/`dry-run`/`live`) and what gets baked into
an artifact: [references/emit-and-bc.md](references/emit-and-bc.md).

## Caveats & neat tricks

- **The SVM is the producer's validator too** — `smoothie compile` calls
  `svm validate` and fails the build on a violation. If compile fails with "invalid
  BC", run `svm validate` directly to see which edge/node broke a gate.
- **Receipts survive a restriction** — a restricted node still shows its id, title,
  and receipts (auditable); only summary + fact text are withheld. Good for "prove it
  exists without leaking content."
- **`emit` refusing on a corpus BC is correct** — read-only knowledge never reaches
  the action machinery; there's nothing to emit.
- **`--json` everywhere** — pipe `svm query … --json` into `jq` for scripted
  consumption; the human format is for reading.
- **Trust a third-party BC carefully** — check `svm bc show` authorship, run under
  the strictest floor, and keep execution in `dry-run` until a human approves `live`.
