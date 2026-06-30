//! Human-readable rendering of query results (the `--json` path serializes the
//! same structs instead). Kept separate from the query logic so the data shapes
//! stay presentation-free.

use std::fmt;

use super::*;

fn fidelity_tag(f: Fidelity) -> &'static str {
    match f {
        Fidelity::Confirmed => "confirmed",
        Fidelity::Claimed => "claimed",
        Fidelity::Guessed => "guessed",
        Fidelity::Absent => "absent",
    }
}

fn fmt_span(span: &SourceSpan) -> String {
    match span {
        SourceSpan::Time { t_start, t_end } => format!("time {t_start}–{t_end}s"),
        SourceSpan::Doc { page, section, .. } => match (page, section) {
            (Some(p), Some(s)) => format!("doc p{p} §{s}"),
            (Some(p), None) => format!("doc p{p}"),
            (None, Some(s)) => format!("doc §{s}"),
            (None, None) => "doc".to_string(),
        },
        SourceSpan::Crawl { page_id, .. } => format!("crawl {page_id}"),
        SourceSpan::Live { note } => format!("live: {note}"),
        SourceSpan::Resolve { resolver, reference, .. } => format!("resolve {resolver}:{reference}"),
    }
}

fn fmt_receipts(receipts: &[ReceiptView]) -> String {
    if receipts.is_empty() {
        return "(none)".to_string();
    }
    receipts
        .iter()
        .map(|r| {
            let mark = if r.resolved { "" } else { " ⚠unresolved" };
            format!("{} [{}]{mark}", r.source_id, fmt_span(&r.span))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

impl fmt::Display for NodeView {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "{} — {}", self.id, self.title)?;
        writeln!(f, "  kind: {}  fidelity: {}", self.kind, fidelity_tag(self.fidelity))?;
        if let Some(notice) = &self.notice {
            writeln!(f, "  ! notice: {notice}")?;
        }
        if self.withheld {
            writeln!(f, "  [LOCKED] RESTRICTED — content withheld (pass --reveal if authorized)")?;
        }
        if let Some(v) = &self.view_id {
            writeln!(f, "  view: {v}")?;
        }
        if let Some(s) = &self.summary {
            writeln!(f, "  summary: {s}")?;
        }
        if let Some(dw) = &self.done_when {
            writeln!(f, "  done_when: {dw}")?;
        }
        writeln!(f, "  action: {}  checks: {}", if self.has_action { "yes" } else { "no" }, self.checks)?;
        writeln!(f, "  receipts: {}", fmt_receipts(&self.receipts))?;
        if !self.facts.is_empty() {
            writeln!(f, "  facts:")?;
            for fact in &self.facts {
                writeln!(
                    f,
                    "    [{}] {} (conf {:.2}, {}) — {}",
                    fact.fact_id,
                    fact.text,
                    fact.confidence,
                    fidelity_tag(fact.fidelity),
                    fmt_receipts(&fact.receipts)
                )?;
            }
        }
        Ok(())
    }
}

/// A list wrapper so a `Vec<EdgeView>` can render as human text.
pub struct EdgeList<'a>(pub &'a [EdgeView]);

impl fmt::Display for EdgeList<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0.is_empty() {
            return write!(f, "(no matching edges)");
        }
        for e in self.0 {
            let arrow = format!("{} --{:?}--> {}", e.from, e.kind, e.to);
            let label = e.label.as_deref().map(|l| format!(" \"{l}\"")).unwrap_or_default();
            writeln!(
                f,
                "{arrow}{label}  [{}]  receipts: {}",
                fidelity_tag(e.fidelity),
                fmt_receipts(&e.receipts)
            )?;
        }
        Ok(())
    }
}

impl fmt::Display for ViewView {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "{} — {} [{}]", self.view_id, self.title, fidelity_tag(self.fidelity))?;
        if !self.url_patterns.is_empty() {
            writeln!(f, "  url_patterns: {}", self.url_patterns.join(", "))?;
        }
        if !self.aliases.is_empty() {
            writeln!(f, "  aliases: {}", self.aliases.join(", "))?;
        }
        writeln!(f, "  observations: {}", self.observation_count)?;
        writeln!(f, "  nodes:")?;
        for n in &self.nodes {
            writeln!(f, "    {} — {} ({}, {})", n.id, n.title, n.kind, fidelity_tag(n.fidelity))?;
        }
        Ok(())
    }
}

impl fmt::Display for OutlineView {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "{} — {} [{}]  (brief {})", self.outline_id, self.title, fidelity_tag(self.fidelity), self.brief_id)?;
        for s in &self.scenes {
            writeln!(f, "  scene {} — {} [{}]", s.scene_id, s.title, fidelity_tag(s.fidelity))?;
            if let Some(dw) = &s.done_when {
                writeln!(f, "    done_when: {dw}")?;
            }
            for n in &s.nodes {
                writeln!(f, "    · {} — {} ({})", n.id, n.title, fidelity_tag(n.fidelity))?;
            }
            for g in &s.gaps {
                writeln!(f, "    ⚠ gap {} ({}) — {}", g.key, g.kind.as_deref().unwrap_or("?"), g.text)?;
            }
        }
        Ok(())
    }
}

/// A list wrapper for node summaries.
pub struct NodeSummaryList<'a>(pub &'a [NodeSummary]);

impl fmt::Display for NodeSummaryList<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0.is_empty() {
            return write!(f, "(no matching nodes)");
        }
        for n in self.0 {
            writeln!(f, "{} — {} ({}, {})", n.id, n.title, n.kind, fidelity_tag(n.fidelity))?;
        }
        Ok(())
    }
}

/// A list wrapper for gaps.
pub struct GapList<'a>(pub &'a [GapView]);

impl fmt::Display for GapList<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0.is_empty() {
            return write!(f, "(no gaps)");
        }
        for g in self.0 {
            writeln!(f, "{} ({}) — {}", g.key, g.kind.as_deref().unwrap_or("?"), g.text)?;
        }
        Ok(())
    }
}

impl fmt::Display for TraversalView {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "traverse from {} (max_depth {})", self.from, self.max_depth)?;
        writeln!(f, "  reached:")?;
        for r in &self.reached {
            writeln!(f, "    [d{}] {} — {} ({})", r.depth, r.id, r.title, fidelity_tag(r.fidelity))?;
        }
        if !self.path.is_empty() {
            writeln!(f, "  path:")?;
            for e in &self.path {
                writeln!(f, "    {} --{:?}--> {} [{}]", e.from, e.kind, e.to, fidelity_tag(e.fidelity))?;
            }
        }
        Ok(())
    }
}
