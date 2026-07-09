// The read_image vision tool (spec 04 · the one built-in vision affordance) and
// its describe-stage wiring: pixels enter the conversation as image blocks, and
// every attached image becomes a durable companion under `.smoothie/companions/`.

import { describe as suite, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readImageTool, sniffImageMime, containedPath } from "../src/agent/read-image.ts";
import { describe } from "../src/stages/describe.ts";
import type { ModelGateway, AgentToolResult } from "../src/model/gateway.ts";

// A real 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-readimage-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

suite("read_image tool", () => {
  it("attaches a real image as an image block and records it as viewed", async () => {
    fs.mkdirSync(path.join(tmp, "frames"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "frames/f1.png"), TINY_PNG);
    const viewed: string[] = [];
    const tool = readImageTool(tmp, (rel) => viewed.push(rel));

    const out = (await tool.run({ paths: ["frames/f1.png"] })) as AgentToolResult;
    expect(typeof out).toBe("object");
    expect(out.images).toHaveLength(1);
    expect(out.images![0].mimeType).toBe("image/png");
    expect(Buffer.from(out.images![0].data, "base64").equals(TINY_PNG)).toBe(true);
    expect(out.text).toContain("frames/f1.png");
    expect(viewed).toEqual(["frames/f1.png"]);
  });

  it("refuses paths that escape the working directory", async () => {
    const outside = path.join(tmp, "outside.png");
    fs.writeFileSync(outside, TINY_PNG);
    const work = path.join(tmp, "work");
    fs.mkdirSync(work);
    const viewed: string[] = [];
    const tool = readImageTool(work, (rel) => viewed.push(rel));

    const out = await tool.run({ paths: ["../outside.png"] });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("outside the working directory");
    expect(viewed).toEqual([]);
  });

  it("refuses non-image bytes and oversized files with a downscale hint", async () => {
    fs.writeFileSync(path.join(tmp, "notes.txt"), "just text");
    fs.writeFileSync(path.join(tmp, "huge.png"), Buffer.alloc(5 * 1024 * 1024));
    const tool = readImageTool(tmp);

    const notImage = await tool.run({ paths: ["notes.txt"] });
    expect(notImage as string).toContain("not a PNG/JPEG/GIF/WebP image");

    const tooBig = await tool.run({ paths: ["huge.png"] });
    expect(tooBig as string).toContain("exceeds the 4MB cap");
    expect(tooBig as string).toContain("downscale");
  });

  it("reports missing files without failing the whole batch", async () => {
    fs.writeFileSync(path.join(tmp, "ok.png"), TINY_PNG);
    const tool = readImageTool(tmp);
    const out = (await tool.run({ paths: ["ok.png", "gone.png"] })) as AgentToolResult;
    expect(out.images).toHaveLength(1);
    expect(out.text).toContain("gone.png: not found");
  });

  it("sniffs MIME from magic bytes, not the extension", () => {
    expect(sniffImageMime(TINY_PNG)).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("plain text"))).toBeNull();
  });

  it("containedPath allows inside, rejects outside", () => {
    expect(containedPath(tmp, "a/b.png")).toBe(path.join(tmp, "a/b.png"));
    expect(containedPath(tmp, "../evil.png")).toBeNull();
    expect(containedPath(tmp, "/etc/passwd")).toBeNull();
  });
});

suite("describe wiring: viewed images become companions", () => {
  it("persists read images under .smoothie/companions/<source>/ and registers them", async () => {
    const corpus = path.join(tmp, "corpus");
    const bcDir = path.join(corpus, ".smoothie");
    fs.mkdirSync(corpus, { recursive: true });
    fs.writeFileSync(path.join(corpus, "pic.png"), TINY_PNG);

    // A fake agent gateway that attaches the source image, then authors one fact.
    const gateway: ModelGateway = {
      kind: "real",
      async extract() {
        throw new Error("unused");
      },
      async extractWithTools(req) {
        const readImage = req.tools.find((t) => t.name === "read_image");
        expect(readImage, "read_image is wired into the describe agent").toBeDefined();
        const res = (await readImage!.run({ paths: ["pic.png"] })) as AgentToolResult;
        expect(res.images).toHaveLength(1);
        return {
          facts: [{ kind: "knowledge", text: "a single red pixel", confidence: 0.9, fidelity: "claimed", locator: "image" }],
        } as never;
      },
    };

    const src = {
      source_id: "src-pic-png",
      kind: "image",
      path: path.join(corpus, "pic.png"),
      relPath: "pic.png",
      hash: "h1",
    };
    const bundle = await describe([src], gateway, bcDir, "brief-1", {}, { folder: corpus, modalities: {} });

    // The attached image is now a durable, registered companion — the visual
    // receipt survives the (gitignored, regenerable) workdir.
    const registered = bundle.companions["src-pic-png"];
    expect(registered).toEqual([{ kind: "frame", path: path.join("companions", "src-pic-png", "pic.png") }]);
    const onDisk = path.join(bcDir, "companions", "src-pic-png", "pic.png");
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(fs.readFileSync(onDisk).equals(TINY_PNG)).toBe(true);

    // And the cache round-trips the companions.
    const bundle2 = await describe([src], gateway, bcDir, "brief-1", {}, { folder: corpus, modalities: {} });
    expect(bundle2.companions["src-pic-png"]).toEqual(registered);
  });
});
