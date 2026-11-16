// ===========================================================================
// vendor.js — where third-party libraries are loaded from.
//
// Every library the app needs is bundled under app/vendor/ so the desktop
// build never touches a CDN. URLs are absolute because several of them are
// imported from inside blob-URL workers, where relative paths don't resolve.
// ===========================================================================

const base = new URL("../vendor/", import.meta.url);
const at = (p) => new URL(p, base).href;

// Document parsing
export const ZIP_URL = at("zipjs/zip.min.js");
export const PDFJS_URL = at("pdfjs/pdf.min.mjs");
export const PDFJS_WORKER_URL = at("pdfjs/pdf.worker.min.mjs");
export const READABILITY_URL = at("readability/readability.js");

// MP3 encoding (loaded with importScripts inside classic workers)
export const LAME_URL = at("lame/lame.min.js");

// Kokoro. kokoro.js imports ./transformers.js, so both resolve to ONE
// transformers instance — the engine relies on that to set the thread count.
export const KOKORO_URL = at("tts/kokoro.js");
export const TRANSFORMERS_URL = at("tts/transformers.js");
// Graphics-card self-test helper (see runWebgpuSelfTest in engine.js).
export const KERNELS_URL = at("tts/kernels.js");
// Directory holding the WebGPU-capable ONNX runtime transformers.js loads.
export const TRANSFORMERS_WASM_DIR = at("tts/ort/");

// Light voices: their own wasm-only ONNX runtime.
export const LIGHT_ORT_URL = at("ort/ort.wasm.min.mjs");
export const LIGHT_ORT_WASM_DIR = at("ort/");
