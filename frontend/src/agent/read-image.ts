// The `read_image` tool — the describe agent's one built-in vision affordance
// (spec 04 · `load_frame`). Processors stay pure CLIs that WRITE image artifacts
// into the source's working directory (frames, page renders, extracted figures);
// this tool moves those pixels from the folder into the model's context as image
// content blocks. Producing images is the processor's job, in any language;
// seeing them is harness plumbing — this file.

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "../model/gateway.ts";

/** Refuse anything a model could plausibly mis-request: huge files bloat the
 *  context and fail providers; the agent has `run_command` (ffmpeg) to downscale. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES_PER_CALL = 4;

/** Magic-byte MIME sniffing — never trust the extension. */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && buf.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Resolve a workdir-relative path, refusing escapes — the agent may only read
 *  artifacts inside this source's working directory. */
export function containedPath(workDir: string, p: string): string | null {
  const resolved = path.resolve(workDir, p);
  const root = path.resolve(workDir);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

/** Build the `read_image` tool bound to a source's working directory. Every
 *  successfully attached image's workdir-relative path is reported to `onViewed`
 *  so describe can register it as a companion (the receipt resolves later). */
export function readImageTool(workDir: string, onViewed?: (relPath: string) => void): AgentTool {
  return {
    name: "read_image",
    description:
      "Attach image files from the working directory so you can SEE them (the pixels enter the " +
      "conversation). Pass paths returned by processor commands — extracted frames, page renders, " +
      "figures — or the source image itself. Up to " + MAX_IMAGES_PER_CALL + " paths per call " +
      "(e.g. a burst of frames around one moment). PNG/JPEG/GIF/WebP, ≤4MB each; downscale bigger " +
      'files first (e.g. ffmpeg -i big.png -vf scale=1024:-1 small.png). Use this before authoring ' +
      "any fact that claims what an image shows.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), {
        maxItems: MAX_IMAGES_PER_CALL,
        description: "workdir-relative image paths to attach",
      }),
      purpose: Type.Optional(Type.String({ description: "what you are looking for" })),
    }),
    async run(args: Record<string, unknown>): Promise<string | AgentToolResult> {
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
      if (paths.length === 0) return "ERROR: pass at least one image path";
      if (paths.length > MAX_IMAGES_PER_CALL) return `ERROR: at most ${MAX_IMAGES_PER_CALL} images per call`;

      const attached: string[] = [];
      const problems: string[] = [];
      const images: Array<{ data: string; mimeType: string }> = [];

      for (const p of paths) {
        const abs = containedPath(workDir, p);
        if (!abs) { problems.push(`${p}: outside the working directory — refused`); continue; }
        let buf: Buffer;
        try {
          buf = fs.readFileSync(abs);
        } catch {
          problems.push(`${p}: not found`);
          continue;
        }
        if (buf.length > MAX_IMAGE_BYTES) {
          problems.push(`${p}: ${(buf.length / 1024 / 1024).toFixed(1)}MB exceeds the 4MB cap — downscale first (ffmpeg -i "${p}" -vf scale=1024:-1 out.png)`);
          continue;
        }
        const mime = sniffImageMime(buf);
        if (!mime) { problems.push(`${p}: not a PNG/JPEG/GIF/WebP image`); continue; }
        images.push({ data: buf.toString("base64"), mimeType: mime });
        attached.push(p);
        onViewed?.(path.relative(workDir, abs));
      }

      logCall(workDir, paths, attached, problems);
      if (images.length === 0) return `ERROR: no image attached.\n${problems.join("\n")}`;
      const note = problems.length ? `\nskipped: ${problems.join("; ")}` : "";
      return { text: `attached: ${attached.join(", ")}${note}`, images };
    },
  };
}

/** Trace every call in the workdir's `_calls.log`, like run_command/run_python. */
function logCall(workDir: string, requested: string[], attached: string[], problems: string[]): void {
  try {
    const body = `requested: ${requested.join(", ")}\nattached: ${attached.join(", ") || "(none)"}${problems.length ? `\nproblems: ${problems.join("; ")}` : ""}`;
    fs.appendFileSync(path.join(workDir, "_calls.log"), `\n## read_image\n${body}\n`);
  } catch {
    /* non-fatal */
  }
}
