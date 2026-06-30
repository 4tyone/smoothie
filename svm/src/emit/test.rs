//! Render a deterministic **test** artifact (Playwright `.spec.ts`) from a slice.
//!
//! The guardrails are baked into the test itself: a `runStep` harness refuses to
//! execute mutating steps in `read-only`/`dry-run` mode and refuses gated (`ASK`)
//! steps unless explicitly approved in `live` mode (`SVM_APPROVE=1`). So whatever
//! runs the test "cannot silently run a destructive step" (spec 06). Credentials
//! are read from env slots at run time, never inlined.

use crate::bc::types::*;
use crate::credentials::CredentialRef;
use crate::policy::Decision;

use super::{mode_str, Step};

/// JSON-encode a string into a safe TS/JS string literal.
fn js(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

pub(super) fn render(
    bc: &Bc,
    slice_title: &str,
    steps: &[Step],
    mode: Mode,
    _credential_slots: &[String],
) -> String {
    let mut s = String::new();
    s.push_str("// Emitted by the SVM — deterministic test for the web-app profile.\n");
    s.push_str(&format!("// BC: {}  ·  slice: {}\n", bc.manifest.bc_id, slice_title));
    s.push_str("// Guardrails are baked in (spec 06): mutations are skipped outside `live`,\n");
    s.push_str("// and gated (ASK) steps run only when SVM_APPROVE=1 in live mode.\n");
    s.push_str("import { test, expect } from \"@playwright/test\";\n\n");

    s.push_str(&format!("const MODE = {} as const;\n", js(mode_str(mode))));
    s.push_str(
        r#"const APPROVED = process.env.SVM_APPROVE === "1";

async function runStep(
  title: string,
  guard: "ALLOW" | "ASK",
  mutating: boolean,
  fn: () => Promise<void>,
): Promise<void> {
  if (mutating && MODE !== "live") {
    console.log(`[${MODE}] skip mutating step: ${title}`);
    return;
  }
  if (guard === "ASK" && !(APPROVED && MODE === "live")) {
    console.log(`[gated] skip (needs SVM_APPROVE=1 in live mode): ${title}`);
    return;
  }
  await fn();
}

"#,
    );

    s.push_str(&format!("test({}, async ({{ page }}) => {{\n", js(slice_title)));
    for step in steps {
        render_step(&mut s, step);
    }
    s.push_str("});\n");
    s
}

fn render_step(s: &mut String, step: &Step) {
    let n = step.node;
    let guard = match step.decision {
        Decision::Allow => "ALLOW",
        Decision::Ask => "ASK",
        Decision::Deny => "DENY", // unreachable — emit refuses on DENY
    };
    let title = js(&n.title);

    // Checks are read-only assertions — always safe to run.
    let mut check_lines = String::new();
    for c in &n.checks {
        check_lines.push_str(&render_check(c));
    }

    match &n.action {
        None => {
            // A pure-assertion node (e.g. a state to verify).
            s.push_str(&format!("  // {} ({}): {}\n", n.id, guard, step.reason));
            s.push_str(&check_lines);
        }
        Some(action) => {
            let (mutating, body) = render_action(action);
            s.push_str(&format!(
                "  // {} ({}): {}\n  await runStep({}, {}, {}, async () => {{\n{}  }});\n",
                n.id,
                guard,
                step.reason,
                title,
                js(guard),
                mutating,
                indent(&body, 4),
            ));
            // Assert checks after the action (read-only).
            s.push_str(&check_lines);
        }
    }
    s.push('\n');
}

/// Returns (is_mutating, body). Navigation/scroll/wait are non-mutating.
fn render_action(action: &Action) -> (bool, String) {
    match action {
        Action::Goto { url } => (false, format!("await page.goto({});\n", js(url))),
        Action::Click { locator } => (true, format!("await {}.click();\n", locator_expr(locator))),
        Action::Fill { locator, value } => {
            let v = fill_value(value);
            (true, format!("await {}.fill({});\n", locator_expr(locator), v))
        }
        Action::Select { locator, value } => {
            (true, format!("await {}.selectOption({});\n", locator_expr(locator), js(value)))
        }
        Action::Press { key } => (true, format!("await page.keyboard.press({});\n", js(key))),
        Action::Scroll { locator, .. } => match locator {
            Some(l) => (false, format!("await {}.scrollIntoViewIfNeeded();\n", locator_expr(l))),
            None => (false, "await page.mouse.wheel(0, 600);\n".to_string()),
        },
        Action::WaitFor { locator, condition } => match locator {
            Some(l) => (false, format!("await {}.waitFor();\n", locator_expr(l))),
            None => {
                let c = condition.clone().unwrap_or_default();
                (false, format!("// wait_for: {}\n", c.replace('\n', " ")))
            }
        },
    }
}

/// A fill value: an `env:` reference becomes a run-time slot; otherwise a literal.
fn fill_value(value: &str) -> String {
    match CredentialRef::parse(value) {
        Some(c) => format!("process.env.{} ?? \"\"", c.slot()),
        None => js(value),
    }
}

fn render_check(c: &Check) -> String {
    match c {
        Check::Visible { locator } => format!("  await expect({}).toBeVisible();\n", locator_expr(locator)),
        Check::Exists { locator } => format!("  await expect({}).toHaveCount(1);\n", locator_expr(locator)),
        Check::TextMatches { locator, expected } => match locator {
            Some(l) => format!("  await expect({}).toContainText({});\n", locator_expr(l), js(expected)),
            None => format!("  await expect(page.locator(\"body\")).toContainText({});\n", js(expected)),
        },
        Check::UrlMatches { expected } => {
            format!("  await expect(page).toHaveURL(new RegExp({}));\n", js(&regex_escape(expected)))
        }
    }
}

/// Build a Playwright locator expression from a strategy.
fn locator_expr(loc: &Locator) -> String {
    let p = &loc.primary;
    match p.by {
        LocatorBy::Role => match &p.name {
            Some(name) => format!("page.getByRole({}, {{ name: {} }})", js(&p.value), js(name)),
            None => format!("page.getByRole({})", js(&p.value)),
        },
        LocatorBy::Testid => format!("page.getByTestId({})", js(&p.value)),
        LocatorBy::Label => format!("page.getByLabel({})", js(&p.value)),
        LocatorBy::Text => format!("page.getByText({})", js(&p.value)),
        LocatorBy::Css => format!("page.locator({})", js(&p.value)),
    }
}

fn regex_escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if "\\^$.|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn indent(body: &str, spaces: usize) -> String {
    let pad = " ".repeat(spaces);
    body.lines().map(|l| format!("{pad}{l}\n")).collect()
}
