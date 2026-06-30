// Modalities — there are NO JS readers anymore. Real extraction is done by the
// Python agent (`describe`), which writes Python guided by a per-modality skill.
// This module only:
//   1. classifies a file's modality by extension (to pick the skill), and
//   2. provides a trivial text splitter used ONLY by the deterministic CI path
//      (the `DeterministicModelGateway` has no agent, so it reads small text
//      fixtures directly). No pdftotext, no SheetJS, no per-modality extractors.

import * as fs from "node:fs";
import * as path from "node:path";

/** A unit of source content for the deterministic CI path (text + provenance). */
export interface Segment {
  text: string;
  span: { kind: "doc"; section?: string; page?: number; label?: string } | { kind: "time"; t_start: number; t_end: number };
  image?: { data: string; mimeType: string };
}

/** A companion artifact referenced by path (written by the Python agent in v1). */
export interface Companion {
  kind: "transcript" | "frame" | "screenshot" | "dom" | "ax" | "audio" | "other";
  path: string;
}

/** Extension → modality tag (the `sources[].kind`, and the skill to load). */
const MODALITY: Record<string, string> = {
  md: "markdown", markdown: "markdown",
  pdf: "pdf",
  csv: "spreadsheet", xlsx: "spreadsheet", xls: "spreadsheet", ods: "spreadsheet",
  docx: "docs", doc: "docs", odt: "docs", rtf: "docs",
  html: "html", htm: "html",
  json: "json",
  ipynb: "notebook",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image",
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video", m4v: "video",
  mp3: "audio", wav: "audio", m4a: "audio", flac: "audio", ogg: "audio", aac: "audio",
};

/** The modality of a file, or null if Smoothie has no skill for it. */
export function classifyModality(filePath: string): string | null {
  return MODALITY[path.extname(filePath).slice(1).toLowerCase()] ?? null;
}

/**
 * Deterministic text segmentation for the CI path only. Markdown splits by ATX
 * heading; everything else by blank-line blocks. Pure and reproducible.
 */
export function textSegments(filePath: string): Segment[] {
  const text = fs.readFileSync(filePath, "utf8");
  const isMd = /\.(md|markdown)$/i.test(filePath);
  const segments: Segment[] = [];

  if (isMd) {
    const lines = text.split(/\r?\n/);
    let heading = "(preamble)";
    let buf: string[] = [];
    const flush = () => {
      const body = buf.join("\n").trim();
      if (body) segments.push({ text: `## ${heading}\n${body}`, span: { kind: "doc", section: heading } });
      buf = [];
    };
    for (const line of lines) {
      const m = /^#{1,6}\s+(.*)$/.exec(line);
      if (m) { flush(); heading = m[1].trim(); } else buf.push(line);
    }
    flush();
  } else {
    text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
      .forEach((block, i) => segments.push({ text: block, span: { kind: "doc", label: `block ${i + 1}` } }));
  }
  return segments;
}
