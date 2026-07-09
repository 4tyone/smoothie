# Emit (web-app) & BC versioning

## Emit — a guardrailed runnable slice

`svm emit` turns part of a **web-app-profile** BC into a runnable artifact. It is a
**pure function of the BC** and refuses for the `corpus` profile.

```bash
svm emit test  --outline o-dunning --bc $BC --mode read-only --stdout --json
svm emit skill --node n-retry --node n-login --bc $BC --out ./out
```

| Flag | Meaning |
|---|---|
| `test` \| `skill` | Emit a Playwright `.spec.ts` test, or a skill artifact. |
| `--outline <id>` | Emit a slice for a whole outline. |
| `--node <id>` (repeatable) | Emit a slice for specific nodes. |
| `--mode read-only\|dry-run\|live` | Execution mode baked into the artifact (default `dry-run`). |
| `--reveal` | Authorize including `restricted` nodes in the slice (refused otherwise). |
| `--stdout` / `--out <dir>` | Print to stdout, or write into `<dir>`. With neither, the file is written into the **current directory** (`<slug>.spec.ts` / `<slug>.skill.md`). |
| `--json` | Machine-readable emit report (`allow`/`ask`/`deny` counts + `audit` + `effective` policy). |

**Modes** (the artifact's executor enforces them):
- `read-only` — read/snapshot, zero mutations. Default for exploring an unknown BC.
- `dry-run` — propose all actions, execute none that mutate. Review before any write.
- `live` — execute mutations, still subject to floor + blocklist + approval. Only
  after explicit human authorization.

The emit report's `effective` block shows the floor-intersected policy (the BC's
attempts to widen are already neutralized); `audit.entries` shows each step's
decision (ALLOW/ASK/DENY) and the matched rule, with secrets redacted. Emit
**refuses** a slice that has any hard DENY, exceeds the effective budget
(`max_actions`), or contains a `restricted` node without `--reveal`. See safety.md
for the floor.

## BC versioning — `svm bc`

A git-backed store over `.smoothie/bc.json`.

```bash
svm bc show --bc $BC          # manifest, authorship, counts (read-only summary)
svm bc init bc.json          # initialize a versioned store at .smoothie
svm bc history               # list revisions (hash · time · message)
svm bc rollback <revision>   # revert to a prior revision
```

`smoothie compile` already commits the BC on every run, so `history`/`rollback`/diff
work out of the box. A **rollback is recorded as a new forward revision** (it doesn't
erase history) — so you can always roll forward again. Use it to undo a bad
incremental compile or a manual edit while keeping a full audit trail.
