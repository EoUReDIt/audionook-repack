// ===========================================================================
// build-vendor.mjs — assemble every third-party file the app loads at runtime.
//
// The original app pulled its libraries from CDNs and its voice models from
// Hugging Face while running. The desktop build must work with no network, so
// this script gathers them once, at build time:
//
//   app/vendor/                 JavaScript libraries (from node_modules)
//   app/src/paradee-tokenizer.json
//   app/src/paradee13-rt.bundle Light-voice runtime: ONNX runtime + tokenizer +
//                               the 8-voice Light model, in the layout that
//                               src/paradee.js (_parseBundle) reads
//
// Model downloads are cached in .cache/ and verified against the sizes below.
// Run with: npm run vendor
// ===========================================================================

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NM = join(ROOT, "node_modules");
const VENDOR = join(ROOT, "app", "vendor");
const SRC = join(ROOT, "app", "src");
const CACHE = join(ROOT, ".cache");

// Pinned to the same revision src/paradee.js names (PARADEE13_REV).
const PARADEE13_REV = "b569f5efb789af5ba643a44af348427242ceb784";
const HF = "https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3/resolve/" + PARADEE13_REV;
const DOWNLOADS = [
  { name: "paradee13-tokenizer.json", url: HF + "/tokenizer.json" },
  { name: "paradee13_int8.onnx", url: HF + "/onnx/paradee_int8.onnx" },
];

const log = (...a) => console.log("[vendor]", ...a);
const mb = (n) => (n / 1048576).toFixed(1) + " MB";

async function copy(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
}

async function bundle(entry, outfile, extra = {}) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "linked",
    logLevel: "warning",
    ...extra,
  });
}

async function download({ name, url }) {
  const file = join(CACHE, name);
  if (existsSync(file) && (await stat(file)).size > 0) return file;
  await mkdir(CACHE, { recursive: true });
  log("downloading", name);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error("download failed (" + res.status + "): " + url);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// Layout read by _parseBundle in src/paradee.js:
//   magic[8] = "P11BNDL1" | u32LE headerLen | headerJSON | payloads
// header.files = [{ name, offset, length, sha256 }], offsets from file start.
function packBundle(sections, meta) {
  const names = Object.keys(sections);
  const describe = (headerLen) => {
    let offset = 12 + headerLen;
    const files = names.map((name) => {
      const f = { name, offset, length: sections[name].length, sha256: createHash("sha256").update(sections[name]).digest("hex") };
      offset += f.length;
      return f;
    });
    return Buffer.from(JSON.stringify({ ...meta, files }), "utf8");
  };
  // Offsets depend on the header's own length; settle it by iterating.
  let header = describe(0);
  for (let i = 0; i < 6; i++) {
    const next = describe(header.length);
    if (next.length === header.length) { header = next; break; }
    header = next;
  }
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length, 0);
  return Buffer.concat([Buffer.from("P11BNDL1", "ascii"), len, header, ...names.map((n) => sections[n])]);
}

async function main() {
  if (!existsSync(NM)) throw new Error("node_modules is missing — run `npm install` first");
  await rm(VENDOR, { recursive: true, force: true });
  await mkdir(VENDOR, { recursive: true });

  // --- document parsing -----------------------------------------------------
  await copy(join(NM, "pdfjs-dist/build/pdf.min.mjs"), join(VENDOR, "pdfjs/pdf.min.mjs"));
  await copy(join(NM, "pdfjs-dist/build/pdf.worker.min.mjs"), join(VENDOR, "pdfjs/pdf.worker.min.mjs"));
  await copy(join(NM, "pdfjs-dist/LICENSE"), join(VENDOR, "pdfjs/LICENSE"));
  await copy(join(NM, "@zip.js/zip.js/index.min.js"), join(VENDOR, "zipjs/zip.min.js"));
  await copy(join(NM, "@zip.js/zip.js/LICENSE"), join(VENDOR, "zipjs/LICENSE"));
  await bundle(join(NM, "@mozilla/readability/index.js"), join(VENDOR, "readability/readability.js"));

  // --- audio ------------------------------------------------------------------
  // lamejs is loaded with importScripts() inside classic workers: keep the UMD file.
  await copy(join(NM, "lamejs/lame.min.js"), join(VENDOR, "lame/lame.min.js"));

  // --- Kokoro (full-quality voices) -----------------------------------------
  // transformers.js and kokoro-js must be SEPARATE modules that share one
  // transformers instance: the engine reaches into transformers' `env` to set
  // the ONNX thread count, which only works if kokoro-js uses that same copy
  // (see the note on kokoroImportUrl in src/engine.js).
  await bundle(join(NM, "@huggingface/transformers/dist/transformers.web.js"), join(VENDOR, "tts/transformers.js"));
  await bundle(join(NM, "kokoro-js/dist/kokoro.js"), join(VENDOR, "tts/kokoro.js"), {
    plugins: [{
      name: "kokoro-externals",
      setup(b) {
        b.onResolve({ filter: /^@huggingface\/transformers$/ }, () => ({ path: "./transformers.js", external: true }));
        // Node-only imports; with these empty kokoro-js takes its browser path.
        b.onResolve({ filter: /^(fs\/promises|path)$/ }, (a) => ({ path: a.path, namespace: "empty" }));
        b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export default {};", loader: "js" }));
      },
    }],
  });
  // The WebGPU-capable ONNX runtime that transformers.js loads for Kokoro.
  for (const f of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
    await copy(join(NM, "@huggingface/transformers/dist", f), join(VENDOR, "tts/ort", f));
  }

  // --- Light voices -----------------------------------------------------------
  // Their own, smaller ONNX runtime: the wasm-only entry, no WebGPU side module.
  const ortDist = join(NM, "onnxruntime-web/dist");
  await copy(join(ortDist, "ort.wasm.min.mjs"), join(VENDOR, "ort/ort.wasm.min.mjs"));
  for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
    await copy(join(ortDist, f), join(VENDOR, "ort", f));
  }

  const [tokenizerFile, modelFile] = await Promise.all(DOWNLOADS.map(download));
  const tokenizer = await readFile(tokenizerFile);
  JSON.parse(tokenizer.toString("utf8")); // must be valid JSON
  await writeFile(join(SRC, "paradee-tokenizer.json"), tokenizer);

  const sections = {
    "ort-mjs": await readFile(join(ortDist, "ort-wasm-simd-threaded.mjs")),
    "ort-wasm": await readFile(join(ortDist, "ort-wasm-simd-threaded.wasm")),
    "tokenizer": tokenizer,
    "model-int8": await readFile(modelFile),
  };
  const glue = sections["ort-mjs"].toString("utf8");
  if (!glue.includes("ort-wasm-simd-threaded.wasm") || glue.includes("jsep")) {
    throw new Error("the ONNX runtime glue is not the plain wasm build the Light voices expect");
  }
  const packed = packBundle(sections, {
    format: "P11BNDL1",
    model: "sahilmahendrakar/Paradee-8M-v1.3@" + PARADEE13_REV,
    ort: "onnxruntime-web@" + JSON.parse(await readFile(join(NM, "onnxruntime-web/package.json"), "utf8")).version,
  });
  await writeFile(join(SRC, "paradee13-rt.bundle"), packed);
  log("paradee13-rt.bundle", mb(packed.length), "(model " + mb(sections["model-int8"].length) + ", runtime " + mb(sections["ort-wasm"].length) + ")");

  log("done ->", VENDOR);
}

main().catch((e) => { console.error("[vendor] FAILED:", e.message); process.exit(1); });
