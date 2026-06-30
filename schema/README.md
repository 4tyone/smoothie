# `schema/` — `bc.v1`, defined once

> **Status: FROZEN as of Phase 4** (spec 02 · versioning). The first real
> end-to-end compile — raw multimodal data → BC, served by the SVM (query +
> emit) — proved the contract, so `bc.v1` is frozen. Additive **optional** fields
> are still allowed within v1; any breaking change becomes `bc.v2` (bumped in all
> three mirrors at once).

The BC contract is the seam between Smoothie's two halves (spec 01/02/07): the TS
compiler frontend **produces** a BC and validates it on **write**; the Rust SVM
**consumes** a BC and validates it on **read**. To keep the two halves locked
apart, the contract is defined once here and mirrored in three artifacts that
must move together:

| Artifact | Role | Location |
|---|---|---|
| `bc.v1.schema.json` | Canonical JSON Schema (machine-checkable) | `schema/bc.v1.schema.json` |
| `bc.v1.ts` | TypeScript types — producer side | `schema/src/bc.v1.ts` |
| Rust serde mirror | Consumer side; validates on read + runs the provenance gates | `svm/src/bc/types.rs` |

**Single-source discipline.** A breaking format change bumps `bc.v2` in *all
three* in one commit. Additive optional fields are allowed within `bc.v1`
(spec 02 · versioning). Unknown **top-level** fields are invalid — add under
`extensions` (reverse-DNS namespaced keys).

## The provenance guarantee

The schema describes *shape*; trust is enforced by the provenance-guarantee gates
in code (spec 02), implemented on the consumer side in `svm/src/bc/validate.rs`
and run by `svm validate`:

1. **Receipted** — every node/edge/view/fact carries non-empty `source_refs`,
   each resolving to a real `source_id`; companion files exist on disk.
2. **Honest fidelity** — `confirmed` requires a Resolver resolution receipt
   (`crawl`/`live`/`resolve` span) plus evaluated checks.
3. **Non-empty locators** (web-app profile) — every `Locator.primary.value` is
   non-empty.
4. **Outlines don't launder trust** — an outline/scene is no more trusted than
   the least-trusted node it depends on.

## Golden example

`examples/bc.golden.json` is a hand-authored, fully-populated BC (web-app
profile) exercising every section — `confirmed` and `claimed` nodes, an edge
with fidelity, a `gap:` note. It is the Phase 0 fixture:

```sh
svm validate schema/examples/bc.golden.json   # exits 0
```

Both the JSON Schema and the Rust serde mirror validate it; the broken fixtures
under `svm/tests/fixtures/` prove the gates reject malformed BCs.
