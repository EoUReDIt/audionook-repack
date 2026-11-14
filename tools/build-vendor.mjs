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
  // Readability is CommonJS; re-export the one class the app imports by name.
  await build({
    stdin: { contents: 'import pkg from "@mozilla/readability"; export const Readability = pkg.Readability;', resolveDir: ROOT, loader: "js" },
    outfile: join(VENDOR, "readability/readability.js"),
    bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "linked", logLevel: "warning",
  });

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
  // Helper the engine uses to check a graphics card computes correctly before
  // trusting it with Kokoro (it fetches small test kernels from Hugging Face).
  await copy(join(NM, "@huggingface/kernels/index.js"), join(VENDOR, "tts/kernels.js"));
  await copy(join(NM, "@huggingface/kernels/LICENSE"), join(VENDOR, "tts/LICENSE-kernels.txt"));
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

  await buildEspeak();
  await buildFonts();

  log("done ->", VENDOR);
}

// --- eSpeak NG (Hindi / French / Spanish Light voices) ----------------------
// The Emscripten build ships every language's pronunciation dictionary in one
// 24 MB data file. Only a handful are needed (the original app made the same
// cut): keep those dictionaries plus every non-dictionary file, repack the
// data, and rewrite the file table inside the loader to match.
const ESPEAK_DICTS = new Set(["en", "hi", "fr", "es", "de", "la"]);
async function buildEspeak() {
  const dir = join(NM, "@echogarden/espeak-ng-emscripten");
  let js = await readFile(join(dir, "espeak-ng.js"), "utf8");
  const data = await readFile(join(dir, "espeak-ng.data"));

  const open = js.indexOf("loadPackage({files:[");
  const close = js.indexOf("],remote_package_size:", open);
  if (open < 0 || close < 0) throw new Error("espeak-ng.js: file table not found");
  const listStart = open + "loadPackage({files:[".length;
  const sizeMatch = /^\],remote_package_size:(\d+)/.exec(js.slice(close, close + 60));
  if (!sizeMatch || Number(sizeMatch[1]) !== data.length) throw new Error("espeak-ng.js: package size does not match the data file");

  const entry = /\{filename:"([^"]+)",start:(\d+),end:(\d+)\}/g;
  const table = js.slice(listStart, close);
  const files = [];
  for (let m; (m = entry.exec(table)); ) files.push({ filename: m[1], start: Number(m[2]), end: Number(m[3]) });
  if (files.map((f) => `{filename:"${f.filename}",start:${f.start},end:${f.end}}`).join(",") !== table) {
    throw new Error("espeak-ng.js: file table has an unexpected shape");
  }

  const keep = files.filter((f) => {
    const m = /\/([a-z]+)_dict$/.exec(f.filename);
    return !m || ESPEAK_DICTS.has(m[1]);
  });
  const parts = [];
  let offset = 0;
  const newTable = keep.map((f) => {
    const bytes = data.subarray(f.start, f.end);
    parts.push(bytes);
    const row = `{filename:"${f.filename}",start:${offset},end:${offset + bytes.length}}`;
    offset += bytes.length;
    return row;
  }).join(",");
  js = js.slice(0, listStart) + newTable + "],remote_package_size:" + offset + js.slice(close + sizeMatch[0].length);

  const out = join(SRC, "espeak-ng");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "espeak-ng.js"), js);
  await writeFile(join(out, "espeak-ng.data"), Buffer.concat(parts));
  await copy(join(dir, "COPYING"), join(out, "COPYING"));
  log("espeak-ng.data", mb(offset), "(from " + mb(data.length) + ", " + keep.length + " of " + files.length + " files)");
}

// --- Fonts --------------------------------------------------------------------
// The original loaded Inter and Fraunces from Google Fonts. Same families,
// bundled: one variable file per family and script range.
async function buildFonts() {
  const out = join(VENDOR, "fonts");
  const faces = [
    { family: "Inter", pkg: "@fontsource-variable/inter", file: "inter-latin-wght-normal.woff2", weight: "100 900", range: LATIN },
    { family: "Inter", pkg: "@fontsource-variable/inter", file: "inter-latin-ext-wght-normal.woff2", weight: "100 900", range: LATIN_EXT },
    { family: "Fraunces", pkg: "@fontsource-variable/fraunces", file: "fraunces-latin-opsz-normal.woff2", weight: "100 900", range: LATIN },
    { family: "Fraunces", pkg: "@fontsource-variable/fraunces", file: "fraunces-latin-ext-opsz-normal.woff2", weight: "100 900", range: LATIN_EXT },
  ];
  let css = "/* Generated by tools/build-vendor.mjs. Fonts are under the SIL Open Font License. */\n";
  for (const f of faces) {
    await copy(join(NM, f.pkg, "files", f.file), join(out, f.file));
    css += `@font-face { font-family: "${f.family}"; font-style: normal; font-display: swap; font-weight: ${f.weight}; src: url("./${f.file}") format("woff2-variations"); unicode-range: ${f.range}; }\n`;
  }
  for (const pkg of ["@fontsource-variable/inter", "@fontsource-variable/fraunces"]) {
    await copy(join(NM, pkg, "LICENSE"), join(out, "LICENSE-" + pkg.split("/")[1] + ".txt"));
  }
  await writeFile(join(out, "fonts.css"), css);
}
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

main().catch((e) => { console.error("[vendor] FAILED:", e.message); process.exit(1); });
