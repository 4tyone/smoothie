# SVM query cookbook

All examples assume `BC=<folder>/.smoothie/bc.json`. Add `--json` for machine output.

## Orient

```bash
svm bc show --bc $BC                 # profile, authorship, counts
svm query nodes --bc $BC            # every node, printed as `id — title (kind, fidelity)`
svm query nodes --bc $BC --kind topic --fidelity claimed
svm query gaps --bc $BC            # known holes (gap:* notes)
```

## Read one node (the unit you reason over)

```bash
svm query node <node_id> --bc $BC
```
Returns the node + its `facts` (each with text, confidence, fidelity, **receipts**)
and the node's own receipts. **Answer only from these facts and cite the receipts.**
A receipt span like `page 4` or `Sheet 'Sheet1' grouped by 'Segment'` is where the
fact came from — quote it when the user asks "how do you know?".

## Follow relationships

```bash
svm query edges <node_id> --bc $BC                       # outgoing
svm query edges <node_id> --bc $BC --direction both      # both ways
svm query edges <node_id> --bc $BC --kind depends_on     # only one relation
svm query traverse <node_id> --bc $BC --depth 2          # bounded BFS + path
```
Edge kinds: `contains | transition | enables | depends_on | next | related_to`.
Use `traverse` to answer "what does X depend on?" or "what's reachable from here?" —
it prints the path with each edge's kind and fidelity.

## Views & outlines

```bash
svm query view <view_id> --bc $BC          # a screen/document → its member nodes
svm query outline <outline_id> --bc $BC    # a Brief goal's scenes (the flow to follow)
```
Each Brief goal becomes an outline (`o-<goal-id>`). Start there to answer a
goal-shaped question; a scene lists its member nodes. (In a v1 BC the linker puts
the merged graph's nodes in one scene per goal — treat the outline as the goal's
entry point, then narrow with `edges`/`traverse`, not as a hand-curated subset.)

## Glossary & notes (from the BC)

```bash
svm query glossary --bc $BC            # every term → definition
svm query glossary dunning --bc $BC    # one term
svm query notes --bc $BC               # every note (incl. non-gap decisions/observations)
svm query notes decision:prefer-video --bc $BC   # one key
```
These read the **bytecode's** `glossary`/`notes` sections. (Top-level `svm glossary`/
`svm notes` are the legacy metadata-index commands — they read `.smoothie/index.json`
and error on a BC-only store; use the `query` forms with a BC.) `query notes` is a
superset of `query gaps`: gaps are the `gap:*` notes, but notes also carry `decision:`
and other durable observations.

## Reading fidelity honestly

- `confirmed` — corroborated by a resolver (has a `resolve` receipt + a check).
- `claimed` — asserted by one source. The default.
- `guessed` — inferred (induced cross-source edges, proposed actions). Real but not
  directly stated — flag it when you rely on it.
- `absent` — no basis; a placeholder rank (`--fidelity absent` is accepted as a filter).

## Restricted / noticed nodes

```bash
svm query nodes --bc $BC --json             # the JSON listing carries restricted + notice
svm query node <id> --bc $BC                # restricted → content withheld
svm query node <id> --bc $BC --reveal       # authorized → content released
```
A `notice` is a caution surfaced on every read (e.g. "unaudited — don't quote as
actuals"). A `restricted` node withholds its summary + fact text unless `--reveal`,
but keeps id/title/receipts visible. See safety.md.

## Scripting

```bash
# every guessed cross-source edge, as JSON
svm query nodes --bc $BC --json | jq -r '.[].id' | while read n; do
  svm query edges "$n" --bc $BC --json | jq -c '.[] | select(.fidelity=="guessed")'
done
```
