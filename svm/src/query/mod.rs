//! Query & traverse — the SVM's primary surface (spec 05 · Query & traverse).
//!
//! Deterministic, structured operations over a loaded BC: get a node with its
//! facts and receipts, follow typed edges/transitions, resolve a `view_id`, list
//! an outline's scenes, filter by fidelity, surface gaps, and traverse the graph.
//! Every operation is a pure function of the BC and returns **grounded, receipted
//! data the agent reasons over** — the SVM has no model and interprets nothing.
//!
//! The BC is **inert data** (spec 06 · §1): these functions read fields and
//! resolve ids; they never execute text embedded in the BC.

use std::collections::{BTreeMap, VecDeque};

use serde::Serialize;

use crate::bc::types::*;
use crate::error::{Result, SmoothieError};

pub mod display;

/// Direction to follow edges from a node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Out,
    In,
    Both,
}

impl Direction {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "out" => Ok(Direction::Out),
            "in" => Ok(Direction::In),
            "both" => Ok(Direction::Both),
            other => Err(SmoothieError::InvalidArgument(format!(
                "direction must be out|in|both, got {other:?}"
            ))),
        }
    }
}

/// A provenance receipt, resolved against `sources` (spec 02 · SourceRef).
#[derive(Debug, Clone, Serialize)]
pub struct ReceiptView {
    pub source_id: String,
    /// Whether `source_id` resolves to a registered source (always true for a
    /// validated BC, but surfaced so the agent can see provenance is real).
    pub resolved: bool,
    pub source_kind: Option<String>,
    pub source_title: Option<String>,
    pub span: SourceSpan,
}

fn resolve_refs(bc: &Bc, refs: &[SourceRef]) -> Vec<ReceiptView> {
    refs.iter()
        .map(|sr| {
            let src = bc.sources.get(&sr.source_id);
            ReceiptView {
                source_id: sr.source_id.clone(),
                resolved: src.is_some(),
                source_kind: src.map(|s| s.kind.clone()),
                source_title: src.and_then(|s| s.title.clone()),
                span: sr.span.clone(),
            }
        })
        .collect()
}

/// A fact resolved for display.
#[derive(Debug, Clone, Serialize)]
pub struct FactView {
    pub fact_id: String,
    pub kind: FactKind,
    pub text: String,
    pub confidence: f64,
    pub fidelity: Fidelity,
    pub receipts: Vec<ReceiptView>,
}

/// A node with its facts and receipts resolved — the unit an agent reasons over.
#[derive(Debug, Clone, Serialize)]
pub struct NodeView {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    pub kind: String,
    pub view_id: Option<String>,
    pub fidelity: Fidelity,
    pub done_when: Option<String>,
    pub has_action: bool,
    pub checks: usize,
    pub facts: Vec<FactView>,
    pub receipts: Vec<ReceiptView>,
    /// A caution surfaced on every read of this node (spec 06 · §2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    /// The node carries a read restriction.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub restricted: bool,
    /// This response had its content (summary + fact text) WITHHELD because the
    /// node is restricted and the caller was not authorized (`--reveal`). The
    /// node's existence, title, and receipts stay visible (auditable); only the
    /// content is withheld. Enforcement is in code, never from the BC's text.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub withheld: bool,
}

const WITHHELD: &str = "[restricted — content withheld; pass --reveal if authorized]";

/// Get one node with its facts and receipts resolved. When the node is
/// `restricted` and `reveal` is false, its content is withheld in CODE (spec 06).
pub fn node(bc: &Bc, id: &str, reveal: bool) -> Result<NodeView> {
    let n = bc
        .graph
        .nodes
        .get(id)
        .ok_or_else(|| SmoothieError::FileNotFound(format!("node {id:?}")))?;
    let withheld = n.restricted && !reveal;
    let facts = n
        .fact_ids
        .iter()
        .filter_map(|fid| bc.facts.get(fid))
        .map(|f| FactView {
            fact_id: f.fact_id.clone(),
            kind: f.kind,
            text: if withheld { WITHHELD.to_string() } else { f.text.clone() },
            confidence: f.confidence,
            fidelity: f.fidelity,
            receipts: resolve_refs(bc, &f.source_refs),
        })
        .collect();
    Ok(NodeView {
        id: n.id.clone(),
        title: n.title.clone(),
        summary: if withheld { Some(WITHHELD.to_string()) } else { n.summary.clone() },
        kind: n.kind.clone(),
        view_id: n.view_id.clone(),
        fidelity: n.fidelity,
        done_when: n.done_when.clone(),
        has_action: n.action.is_some(),
        checks: n.checks.len(),
        facts,
        receipts: resolve_refs(bc, &n.source_refs),
        notice: n.notice.clone(),
        restricted: n.restricted,
        withheld,
    })
}

/// An edge touching the queried node, with its endpoints and fidelity.
#[derive(Debug, Clone, Serialize)]
pub struct EdgeView {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
    pub label: Option<String>,
    pub fidelity: Fidelity,
    /// The node on the other end of this edge, relative to the query node.
    pub neighbor: String,
    pub neighbor_title: Option<String>,
    pub receipts: Vec<ReceiptView>,
}

/// Follow edges from/to a node, optionally filtered by edge kind.
pub fn edges(
    bc: &Bc,
    id: &str,
    kind: Option<EdgeKind>,
    direction: Direction,
) -> Result<Vec<EdgeView>> {
    if !bc.graph.nodes.contains_key(id) {
        return Err(SmoothieError::FileNotFound(format!("node {id:?}")));
    }
    let mut out = Vec::new();
    for e in &bc.graph.edges {
        if let Some(k) = kind
            && e.kind != k
        {
            continue;
        }
        let (touches, neighbor) = match direction {
            Direction::Out if e.from == id => (true, &e.to),
            Direction::In if e.to == id => (true, &e.from),
            Direction::Both if e.from == id => (true, &e.to),
            Direction::Both if e.to == id => (true, &e.from),
            _ => (false, &e.from),
        };
        if !touches {
            continue;
        }
        out.push(EdgeView {
            from: e.from.clone(),
            to: e.to.clone(),
            kind: e.kind,
            label: e.label.clone(),
            fidelity: e.fidelity,
            neighbor: neighbor.clone(),
            neighbor_title: bc.graph.nodes.get(neighbor).map(|n| n.title.clone()),
            receipts: resolve_refs(bc, &e.source_refs),
        });
    }
    Ok(out)
}

/// A view (profile grouping identity) with its nodes and observations.
#[derive(Debug, Clone, Serialize)]
pub struct ViewView {
    pub view_id: String,
    pub title: String,
    pub url_patterns: Vec<String>,
    pub fidelity: Fidelity,
    pub nodes: Vec<NodeSummary>,
    pub observation_count: usize,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub fidelity: Fidelity,
    /// Surfaced so a listing flags restricted/noticed nodes without revealing content.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub restricted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

fn node_summary(n: &Node) -> NodeSummary {
    NodeSummary {
        id: n.id.clone(),
        title: n.title.clone(),
        kind: n.kind.clone(),
        fidelity: n.fidelity,
        restricted: n.restricted,
        notice: n.notice.clone(),
    }
}

/// Resolve a `view_id` to its members (spec 05 · resolve a view_id).
pub fn view(bc: &Bc, view_id: &str) -> Result<ViewView> {
    let v = bc
        .views
        .get(view_id)
        .ok_or_else(|| SmoothieError::FileNotFound(format!("view {view_id:?}")))?;
    let nodes = v
        .node_ids
        .iter()
        .filter_map(|nid| bc.graph.nodes.get(nid))
        .map(node_summary)
        .collect();
    Ok(ViewView {
        view_id: v.view_id.clone(),
        title: v.title.clone(),
        url_patterns: v.url_patterns.clone().unwrap_or_default(),
        fidelity: v.fidelity,
        nodes,
        observation_count: v.observations.len(),
        aliases: v.aliases.clone().unwrap_or_default(),
    })
}

/// An outline's scenes resolved for traversal, with gaps surfaced.
#[derive(Debug, Clone, Serialize)]
pub struct OutlineView {
    pub outline_id: String,
    pub title: String,
    pub brief_id: String,
    pub fidelity: Fidelity,
    pub scenes: Vec<SceneView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SceneView {
    pub scene_id: String,
    pub title: String,
    pub done_when: Option<String>,
    pub fidelity: Fidelity,
    pub nodes: Vec<NodeSummary>,
    pub gaps: Vec<GapView>,
}

/// List the scenes of an outline (spec 05 · list scenes in an outline).
pub fn outline(bc: &Bc, outline_id: &str) -> Result<OutlineView> {
    let o = bc
        .outlines
        .get(outline_id)
        .ok_or_else(|| SmoothieError::FileNotFound(format!("outline {outline_id:?}")))?;
    let scenes = o
        .scenes
        .iter()
        .map(|s| SceneView {
            scene_id: s.scene_id.clone(),
            title: s.title.clone(),
            done_when: s.done_when.clone(),
            fidelity: s.fidelity,
            nodes: s
                .node_ids
                .iter()
                .filter_map(|nid| bc.graph.nodes.get(nid))
                .map(node_summary)
                .collect(),
            gaps: s
                .gaps
                .clone()
                .unwrap_or_default()
                .iter()
                .map(|key| resolve_gap(bc, key))
                .collect(),
        })
        .collect();
    Ok(OutlineView {
        outline_id: o.outline_id.clone(),
        title: o.title.clone(),
        brief_id: o.brief_id.clone(),
        fidelity: o.fidelity,
        scenes,
    })
}

/// A gap (`gap:*` note), surfaced for resolution — never faked into a node.
#[derive(Debug, Clone, Serialize)]
pub struct GapView {
    pub key: String,
    pub kind: Option<String>,
    pub text: String,
}

fn resolve_gap(bc: &Bc, key: &str) -> GapView {
    match bc.notes.get(key) {
        Some(n) => GapView {
            key: key.to_string(),
            kind: n.kind.clone(),
            text: n.text.clone(),
        },
        None => GapView {
            key: key.to_string(),
            kind: None,
            text: "(referenced gap note not found)".to_string(),
        },
    }
}

/// Surface all gaps in the BC (`gap:*` notes) (spec 05 · surface gaps).
pub fn gaps(bc: &Bc) -> Vec<GapView> {
    bc.notes
        .iter()
        .filter(|(k, _)| k.starts_with("gap:"))
        .map(|(k, n)| GapView {
            key: k.clone(),
            kind: n.kind.clone(),
            text: n.text.clone(),
        })
        .collect()
}

/// One glossary entry as served from the **BC** (not the substrate index).
#[derive(Debug, Clone, Serialize)]
pub struct GlossaryView {
    pub term: String,
    pub definition: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<String>>,
}

/// The BC's glossary (spec 02 · glossary section), optionally one term. Reads from
/// `bc.glossary` — the substrate `svm glossary` command reads the legacy index, so
/// this is how you reach a *bytecode's* glossary.
pub fn glossary(bc: &Bc, term: Option<&str>) -> Vec<GlossaryView> {
    bc.glossary
        .iter()
        .filter(|(t, _)| term.is_none_or(|q| q == t.as_str()))
        .map(|(t, e)| GlossaryView {
            term: t.clone(),
            definition: e.definition.clone(),
            references: e.references.clone(),
        })
        .collect()
}

/// One note as served from the BC.
#[derive(Debug, Clone, Serialize)]
pub struct NoteView {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub text: String,
}

/// The BC's notes (spec 02 · notes section), optionally one key. Includes `gap:*`
/// notes (also surfaced via `query gaps`) plus any other durable observations.
pub fn notes(bc: &Bc, key: Option<&str>) -> Vec<NoteView> {
    bc.notes
        .iter()
        .filter(|(k, _)| key.is_none_or(|q| q == k.as_str()))
        .map(|(k, n)| NoteView {
            key: k.clone(),
            kind: n.kind.clone(),
            text: n.text.clone(),
        })
        .collect()
}

/// List nodes, optionally filtered by fidelity and/or kind (spec 05 · filter by fidelity).
pub fn nodes(bc: &Bc, fidelity: Option<Fidelity>, kind: Option<&str>) -> Vec<NodeSummary> {
    let mut out: Vec<NodeSummary> = bc
        .graph
        .nodes
        .values()
        .filter(|n| fidelity.is_none_or(|f| n.fidelity == f))
        .filter(|n| kind.is_none_or(|k| n.kind == k))
        .map(node_summary)
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// A bounded breadth-first traversal from a node, following typed edges.
#[derive(Debug, Clone, Serialize)]
pub struct TraversalView {
    pub from: String,
    pub max_depth: usize,
    /// Reached nodes with the depth at which each was first reached.
    pub reached: Vec<ReachedNode>,
    /// The edges walked, in discovery order.
    pub path: Vec<EdgeView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReachedNode {
    pub id: String,
    pub title: String,
    pub depth: usize,
    pub fidelity: Fidelity,
}

/// Traverse the graph from `from`, following edges of `kind` (or all kinds) up to
/// `max_depth` hops. Deterministic: neighbors are visited in sorted order.
pub fn traverse(
    bc: &Bc,
    from: &str,
    kind: Option<EdgeKind>,
    max_depth: usize,
) -> Result<TraversalView> {
    let start = bc
        .graph
        .nodes
        .get(from)
        .ok_or_else(|| SmoothieError::FileNotFound(format!("node {from:?}")))?;

    let mut depth: BTreeMap<String, usize> = BTreeMap::new();
    depth.insert(from.to_string(), 0);
    let mut queue: VecDeque<String> = VecDeque::new();
    queue.push_back(from.to_string());
    let mut path: Vec<EdgeView> = Vec::new();

    while let Some(cur) = queue.pop_front() {
        let d = depth[&cur];
        if d >= max_depth {
            continue;
        }
        // Deterministic neighbor order: sort outgoing edges by (kind, to).
        let mut outs: Vec<&Edge> = bc
            .graph
            .edges
            .iter()
            .filter(|e| e.from == cur && kind.is_none_or(|k| e.kind == k))
            .collect();
        outs.sort_by(|a, b| (a.to.as_str(), a.kind as u8).cmp(&(b.to.as_str(), b.kind as u8)));
        for e in outs {
            if !depth.contains_key(&e.to) {
                depth.insert(e.to.clone(), d + 1);
                queue.push_back(e.to.clone());
            }
            path.push(EdgeView {
                from: e.from.clone(),
                to: e.to.clone(),
                kind: e.kind,
                label: e.label.clone(),
                fidelity: e.fidelity,
                neighbor: e.to.clone(),
                neighbor_title: bc.graph.nodes.get(&e.to).map(|n| n.title.clone()),
                receipts: resolve_refs(bc, &e.source_refs),
            });
        }
    }

    let mut reached: Vec<ReachedNode> = depth
        .iter()
        .filter_map(|(id, d)| {
            bc.graph.nodes.get(id).map(|n| ReachedNode {
                id: id.clone(),
                title: n.title.clone(),
                depth: *d,
                fidelity: n.fidelity,
            })
        })
        .collect();
    reached.sort_by(|a, b| (a.depth, a.id.clone()).cmp(&(b.depth, b.id.clone())));

    let _ = start;
    Ok(TraversalView {
        from: from.to_string(),
        max_depth,
        reached,
        path,
    })
}

/// Parse a fidelity filter string.
pub fn parse_fidelity(s: &str) -> Result<Fidelity> {
    match s {
        "confirmed" => Ok(Fidelity::Confirmed),
        "claimed" => Ok(Fidelity::Claimed),
        "guessed" => Ok(Fidelity::Guessed),
        "absent" => Ok(Fidelity::Absent),
        other => Err(SmoothieError::InvalidArgument(format!(
            "fidelity must be confirmed|claimed|guessed|absent, got {other:?}"
        ))),
    }
}

/// Parse an edge-kind filter string.
pub fn parse_edge_kind(s: &str) -> Result<EdgeKind> {
    match s {
        "contains" => Ok(EdgeKind::Contains),
        "transition" => Ok(EdgeKind::Transition),
        "enables" => Ok(EdgeKind::Enables),
        "depends_on" => Ok(EdgeKind::DependsOn),
        "next" => Ok(EdgeKind::Next),
        "related_to" => Ok(EdgeKind::RelatedTo),
        other => Err(SmoothieError::InvalidArgument(format!(
            "edge kind must be contains|transition|enables|depends_on|next|related_to, got {other:?}"
        ))),
    }
}
