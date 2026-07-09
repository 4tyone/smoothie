// Modality classification + the deterministic text splitter (the only non-agent
// extraction left — real extraction is the Python `describe` agent) and the
// reader-skill loader.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { classifyModality, textSegments } from "../src/readers/index.ts";
import { loadReaderSkill } from "../src/agent/skills.ts";
import { bundledToolkitDir, toolkitScripts, scaffoldToolkit } from "../src/agent/toolkit.ts";

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-rd-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe("modality classification", () => {
  it("maps extensions to modality tags", () => {
    expect(classifyModality("a.pdf")).toBe("pdf");
    expect(classifyModality("a.xlsx")).toBe("spreadsheet");
    expect(classifyModality("a.csv")).toBe("spreadsheet");
    expect(classifyModality("a.md")).toBe("markdown");
    expect(classifyModality("a.ipynb")).toBe("notebook");
    expect(classifyModality("a.mp4")).toBe("video");
    expect(classifyModality("a.png")).toBe("image");
    expect(classifyModality("a.unknownext")).toBeNull();
  });
});

describe("deterministic text splitter (CI path only)", () => {
  it("splits markdown by ATX heading", () => {
    const p = tmpFile("d.md", "# A\nalpha\n\n# B\nbeta");
    const segs = textSegments(p);
    expect(segs.length).toBe(2);
    expect((segs[0].span as { section?: string }).section).toBe("A");
    expect(segs[1].text).toContain("beta");
  });
  it("splits non-markdown by blank-line blocks; is deterministic", () => {
    const p = tmpFile("d.txt", "block one\n\nblock two");
    expect(textSegments(p)).toEqual(textSegments(p));
    expect(textSegments(p).length).toBe(2);
  });
});

describe("reader skills (Agent Skills SKILL.md convention)", () => {
  it("loads a modality skill with frontmatter (name=dir) + body", () => {
    const pdf = loadReaderSkill("pdf");
    expect(pdf.name).toBe("pdf");
    expect(pdf.description).toMatch(/pdf/i);
    expect(pdf.body).toContain("SMOOTHIE_TOOLKIT"); // skill orchestrates the pre-built toolkit
    // frontmatter stripped: body doesn't re-open with a `---` fence or expose the keys
    expect(pdf.body.trimStart().startsWith("---")).toBe(false);
    expect(pdf.body).not.toContain("name: pdf");
  });
  it("falls back to the generic skill for an unknown modality", () => {
    expect(loadReaderSkill("nonexistent-modality").name).toBe("generic");
  });
});

describe("modality toolkit (pre-built scripts the agent orchestrates)", () => {
  const MODALITIES = ["video", "audio", "pdf", "spreadsheet", "image", "docs",
    "html", "json", "notebook", "markdown", "generic"];

  it("ships a toolkit for every modality, each with PEP 723 inline-deps scripts", () => {
    for (const m of MODALITIES) {
      const scripts = toolkitScripts(m);
      expect(scripts.length, `toolkit/${m} has scripts`).toBeGreaterThan(0);
      for (const s of scripts) {
        const src = fs.readFileSync(path.join(bundledToolkitDir(), m, s), "utf8");
        // PEP 723 header → `uv run` provisions an isolated env per script.
        expect(src, `${m}/${s} has PEP 723 header`).toContain("# /// script");
        expect(src).toContain('if __name__ == "__main__"');
      }
    }
  });

  it("scaffolds the toolkit into <bcDir>/tools/", () => {
    const bcDir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-tk-"));
    const tools = scaffoldToolkit(bcDir);
    expect(tools).toBe(path.join(bcDir, "tools"));
    for (const m of MODALITIES) {
      expect(fs.existsSync(path.join(tools, m)), `scaffolded tools/${m}`).toBe(true);
    }
  });

  // Regression guard for the broken run templates (sentiment_segments, aggregate,
  // …): every manifest command's `run` template must satisfy its script's argparse
  // contract — the referenced script exists, and every REQUIRED flag appears in the
  // template. This would have caught the four templates that failed 100% verbatim.
  it("every manifest command's run template includes its script's required flags", () => {
    for (const m of MODALITIES) {
      const manifestPath = path.join(bundledToolkitDir(), m, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        commands: Array<{ name: string; run: string }>;
      };
      for (const cmd of manifest.commands) {
        // Resolve the .py the template invokes and confirm it exists.
        const scriptName = cmd.run.match(/([A-Za-z0-9_]+\.py)/)?.[1];
        expect(scriptName, `${m}/${cmd.name} run references a .py`).toBeTruthy();
        const scriptPath = path.join(bundledToolkitDir(), m, scriptName!);
        expect(fs.existsSync(scriptPath), `${m}/${scriptName} exists`).toBe(true);

        // Every argparse flag declared required=True must be present in the template.
        const src = fs.readFileSync(scriptPath, "utf8");
        const required = [...src.matchAll(/add_argument\(\s*["'](--[A-Za-z0-9-]+)["'][^)]*required\s*=\s*True/g)].map((mm) => mm[1]);
        for (const flag of required) {
          expect(cmd.run, `${m}/${cmd.name} template must pass required ${flag}`).toContain(flag);
        }
      }
    }
  });
});
