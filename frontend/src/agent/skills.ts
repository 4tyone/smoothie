// Reader skills, in the **Agent Skills** SKILL.md format (the same format Flue
// loads): a directory `<name>/SKILL.md` with YAML frontmatter `name` +
// `description`, then the body, plus an optional `references/` directory; `name`
// is lowercase-hyphens and matches the directory name.
//
// Smoothie keeps everything under one `.smoothie/` home (the BC, telemetry,
// companions, the agent's Python work — and skills), so discovery is:
//   1. <.smoothie>/skills/<name>/SKILL.md   (project skills — drop in / override)
//   2. the built-in reader skills bundled with Smoothie
// Falling back to the bundled `generic` skill for any unknown modality.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as YAML from "yaml";

/** Built-in reader skills shipped with the package. */
const BUNDLED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "readers");

export interface ReaderSkill {
  name: string;
  description: string;
  body: string;
  references: string[];
  /** Where it was loaded from (for telemetry / transparency). */
  source: string;
}

function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  return m ? { frontmatter: m[1], body: m[2].trim() } : { frontmatter: "", body: md.trim() };
}

function readSkillDir(dir: string): ReaderSkill | null {
  const skillPath = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillPath)) return null;
  const { frontmatter, body } = splitFrontmatter(fs.readFileSync(skillPath, "utf8"));
  const meta = (YAML.parse(frontmatter || "{}") ?? {}) as { name?: string; description?: string };
  const refDir = path.join(dir, "references");
  const references = fs.existsSync(refDir)
    ? fs.readdirSync(refDir).sort().map((f) => fs.readFileSync(path.join(refDir, f), "utf8"))
    : [];
  return { name: meta.name ?? path.basename(dir), description: meta.description ?? "", body, references, source: skillPath };
}

/** The skill roots to search, in precedence order: `<.smoothie>/skills` then bundled. */
export function skillSearchRoots(bcDir?: string): string[] {
  const roots: string[] = [];
  if (bcDir) roots.push(path.join(bcDir, "skills"));
  roots.push(BUNDLED_DIR);
  return roots;
}

/**
 * Load the skill for a modality: a project `<.smoothie>/skills/<modality>/`
 * overrides the bundled default; an unknown modality falls back to `generic`.
 */
export function loadReaderSkill(modality: string, bcDir?: string): ReaderSkill {
  const roots = skillSearchRoots(bcDir);
  for (const root of roots) {
    const found = readSkillDir(path.join(root, modality));
    if (found) return found;
  }
  // Fallback: the bundled generic skill.
  return readSkillDir(path.join(BUNDLED_DIR, "generic")) ?? {
    name: "generic", description: "", body: "Extract meaningful facts from the source with Python.", references: [], source: "(builtin)",
  };
}

/** The directory holding the built-in skills (for `smoothie skills install`). */
export function bundledSkillsDir(): string {
  return BUNDLED_DIR;
}

/** Render a loaded skill as the text injected into the agent's system prompt. */
export function renderSkill(skill: ReaderSkill): string {
  const refs = skill.references.length
    ? `\n\n## References\n\n${skill.references.join("\n\n---\n\n")}`
    : "";
  return `# Skill: ${skill.name}\n${skill.description}\n\n${skill.body}${refs}`;
}
