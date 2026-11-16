// ===========================================================================
// paradee.js — the "Light" voice: Paradee, an 8M-parameter single-voice model
// distilled from Kokoro-82M (voice af_heart) by Sahil Mahendrakar.
// https://github.com/sahilmahendrakar/paradee
//
// Why it exists: Kokoro-82M is ~325 MB and needs WebGPU or many CPU threads to
// stay above realtime. Paradee is one 9 MB int8 ONNX file that runs ~18x realtime
// on a single CPU thread, needs no WebGPU and no big download, and scores
// UTMOS 4.41 vs Kokoro's 4.52 (same word error rate). It speaks one voice —
// Kokoro's af_heart — so in this app it appears as the "Heart (Light)" narrator.
//
// Browser recipe (same as the Chickadee extension's light voice): reuse kokoro-js
// for text -> phonemes -> token ids, convert the phonemes with toMisaki() below
// (Paradee only learned misaki's phoneme spellings; raw eSpeak phonemes mumble),
// and run the Paradee ONNX graph instead of the Kokoro model.
// ===========================================================================

import { cpuBudget, computeMp3PoolSize } from "./audio.js";

// The voice id used everywhere (settings, per-book narrator, chunk cache keys,
// shared bundles). Cache keys already include the voice, so Paradee audio never
// collides with Kokoro af_heart audio.
export const PARADEE_VOICE_ID = "paradee_heart";

// Teacher-in-the-Loop Heart: Fabio Angela's revised-distillation successor to
// Paradee's English voice (same 8M-param / 9 MB int8 footprint, UTMOS 4.47 vs
// Paradee's 4.37/4.41 on the teacher's own features). It won the side-by-side
// comparison, so it is now the only Light voice in the pickers; the original
// Paradee id below is kept working only as a legacy fallback for existing
// books and shared links. Cache keys include the voice so audio never collides.
// https://github.com/MithrilMan/teacher-in-the-loop
// https://huggingface.co/MithrilMan/teacher-in-the-loop
export const TITL_HEART_VOICE_ID = "titl_heart";

// Pinned model files (Hugging Face Hub, public, CORS-enabled — the same host
// kokoro-js already downloads its ~325 MB model from, so no new trust domain).
const PARADEE_REV = "v1.0";
export const PARADEE_MODEL_URL_INT8 =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0/resolve/${PARADEE_REV}/onnx/paradee_int8.onnx`;
export const PARADEE_MODEL_URL_FP32 =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0/resolve/${PARADEE_REV}/onnx/paradee.onnx`;
// Remote copy of the tokenizer, used only if the vendored src/paradee-tokenizer.json
// can't be read (the worker can't fetch it relatively — see engine.js).
// The Teacher-in-the-Loop voice shares Kokoro's phoneme vocabulary (verified:
// identical token ids to this tokenizer), so it reuses the same file.
export const PARADEE_TOKENIZER_URL =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.0/resolve/${PARADEE_REV}/tokenizer.json`;

// Teacher-in-the-Loop weights (Hugging Face Hub, public, CORS-enabled — the same
// host kokoro-js already downloads from). Pinned to the paper's graphs revision
// (see src/titl/voice.py REVISION) so the bytes never shift under us. Only the
// English af_heart student is wired up here; the Italian students (if_sara,
// im_nicola) need Misaki's Italian G2P, which this app's kokoro-js phoneme path
// doesn't produce.
const TITL_REV = "cca42f3882e9d36b865883298d8e3c6a6e42b9c0";
export const TITL_MODEL_URL_INT8 =
  `https://huggingface.co/MithrilMan/teacher-in-the-loop/resolve/${TITL_REV}/af_heart/model_int8.onnx`;
export const TITL_MODEL_URL_FP32 =
  `https://huggingface.co/MithrilMan/teacher-in-the-loop/resolve/${TITL_REV}/af_heart/model.onnx`;

// Paradee v1.1: Sahil Mahendrakar's successor to v1.0 (same 8M-param shape, new
// sine+noise vocoder head, ~3.4x faster than v1.0 on the author's benchmark).
// Explicitly "drop-in" (same inputs, output, phoneme vocabulary — verified
// identical token ids to the vendored tokenizer), so it reuses the whole Light
// pipeline with its own model bytes and worker pool.
export const PARADEE11_VOICE_ID = "paradee11_heart";
const PARADEE11_REV = "v1.1";
export const PARADEE11_MODEL_URL_INT8 =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.1/resolve/${PARADEE11_REV}/onnx/paradee_int8.onnx`;
export const PARADEE11_MODEL_URL_FP32 =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.1/resolve/${PARADEE11_REV}/onnx/paradee.onnx`;

// Paradee v1.3: multilingual successor (same 8M-param shape, one 8.5 MB int8
// file for all voices). Speaks eight Kokoro voices in four languages — English
// (American af_heart/am_puck, British bf_isabella/bm_fable), Hindi
// (hf_alpha/hm_omega), French (ff_siwis) and Spanish (em_alex) — selected by a
// `voice` int64 input holding the voice's position in the model's voice list
// (see README "The Light voices"). Same inputs/output and phoneme vocabulary
// as v1.2 (verified: identical token ids to the vendored tokenizer), same
// speed (~62x realtime on one CPU thread, within 2% of v1.2).
export const PARADEE13_REV = "b569f5efb789af5ba643a44af348427242ceb784"; // v1.3, pinned commit
export const PARADEE13_MODEL_URL_INT8 =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3/resolve/${PARADEE13_REV}/onnx/paradee_int8.onnx`;
export const PARADEE13_MODEL_URL_FP32 =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3/resolve/${PARADEE13_REV}/onnx/paradee.onnx`;
// Remote tokenizer, same role as PARADEE_TOKENIZER_URL below. The v1.3 vocab
// is byte-identical to the vendored file, so this is fallback-only.
export const PARADEE13_TOKENIZER_URL =
  `https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3/resolve/${PARADEE13_REV}/tokenizer.json`;

// One voice id per v1.3 voice. The `paradee13_` prefix keeps them distinct
// from the Kokoro ids (`af_heart`, … — same display names, different engines),
// so chunk cache keys and engineForVoice() routing never collide.
export const PARADEE13_AF_HEART = "paradee13_af_heart";
export const PARADEE13_BF_ISABELLA = "paradee13_bf_isabella";
export const PARADEE13_AM_PUCK = "paradee13_am_puck";
export const PARADEE13_BM_FABLE = "paradee13_bm_fable";
export const PARADEE13_HF_ALPHA = "paradee13_hf_alpha";
export const PARADEE13_HM_OMEGA = "paradee13_hm_omega";
export const PARADEE13_FF_SIWIS = "paradee13_ff_siwis";
export const PARADEE13_EM_ALEX = "paradee13_em_alex";
// The voice the slow-device default (see store.js) and new books use.
export const PARADEE13_DEFAULT = PARADEE13_AF_HEART;

// Per-voice synthesis recipe. `kokoro`: the Kokoro voice name used for the
// English G2P path (kokoro-js phonemizes by first letter: 'a' -> en-us,
// anything else -> en). `index`: the model's voice input. `lang`: 'en' for the
// kokoro-js path, otherwise the eSpeak voice for the direct-phonemizer path
// (misaki EspeakG2P renames applied after). `british`: misaki lang 'b' table.
export const PARADEE13_VOICES = [
  { id: PARADEE13_AF_HEART, kokoro: "af_heart", index: 0, lang: "en", phLang: "en-us", british: false },
  { id: PARADEE13_BF_ISABELLA, kokoro: "bf_isabella", index: 1, lang: "en", phLang: "en", british: true },
  { id: PARADEE13_AM_PUCK, kokoro: "am_puck", index: 2, lang: "en", phLang: "en-us", british: false },
  { id: PARADEE13_BM_FABLE, kokoro: "bm_fable", index: 3, lang: "en", phLang: "en", british: true },
  { id: PARADEE13_HF_ALPHA, kokoro: "hf_alpha", index: 4, lang: "hi", phLang: "hi", british: false },
  { id: PARADEE13_HM_OMEGA, kokoro: "hm_omega", index: 5, lang: "hi", phLang: "hi", british: false },
  { id: PARADEE13_FF_SIWIS, kokoro: "ff_siwis", index: 6, lang: "fr", phLang: "fr", british: false },
  { id: PARADEE13_EM_ALEX, kokoro: "em_alex", index: 7, lang: "es", phLang: "es", british: false },
];
export const PARADEE13_VOICE_IDS = PARADEE13_VOICES.map((v) => v.id);
const _PARADEE13_BY_ID = new Map(PARADEE13_VOICES.map((v) => [v.id, v]));
export function paradee13Meta(voiceId) {
  return _PARADEE13_BY_ID.get(voiceId) || null;
}
// Model voice index by Kokoro voice name (used inside the worker, where the
// English path arrives carrying the kokoro name).
export const PARADEE13_KOKORO_INDEX = Object.fromEntries(PARADEE13_VOICES.map((v) => [v.kokoro, v.index]));

// Hindi/French/Spanish use eSpeak NG directly via the trimmed Emscripten build
// below (same one the Teacher-in-the-Loop demo runs:
// @echogarden/espeak-ng-emscripten, dictionaries cut to en,hi,fr,es, de,la —
// 24 MB -> ~1.2 MB data; Italian text pulls es/fr/de/la dictionaries for some
// words, so those stay). Lazily loaded by paradee13 workers on the first
// non-English chunk; English-only sessions never download it.
export const ESPEAK_JS_PATH = "src/espeak-ng/espeak-ng.js";
export const ESPEAK_DATA_PATH = "src/espeak-ng/espeak-ng.data";

// The TTS worker loads Paradee through its own onnxruntime-web copy (separate
// from the one inside @huggingface/transformers, which stays dedicated to
// Kokoro). Pinned so the wasm binary URL below always matches the JS.
//
// This is the WASM-ONLY entry (ort.wasm.min.mjs), NOT the default all-backend
// bundle. The default entry hardcodes the JSEP build
// (ort-wasm-simd-threaded.jsep.mjs + a 22 MB jsep.wasm side module) which
// EVERY worker downloads at first inference even for pure-CPU sessions
// (16 workers x 33 MB = ~528 MB). The wasm-only entry loads the plain
// threaded build instead: one 11.2 MB file, zero side modules — the stripped
// ONNX build for the Light voices. Verified: no "jsep.mjs" reference in the
// served file, and bit-identical inference output (see bundle docs).
export const PARADEE_ORT_VERSION = "1.22.0";
export const PARADEE_ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${PARADEE_ORT_VERSION}/dist/ort.wasm.min.mjs`;
export const PARADEE_ORT_WASM_PATHS =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${PARADEE_ORT_VERSION}/dist/`;

export const PARADEE_SAMPLE_RATE = 24000;

// Listening needs synthesis to stay comfortably above realtime; below this we
// consider an engine too slow for the device (used by the runtime slowdown
// monitor that suggests the Light voice).
export const MIN_RTF = 1.5;

export function isParadeeVoice(voiceId) {
  return voiceId === PARADEE_VOICE_ID;
}

export function isTitlVoice(voiceId) {
  return voiceId === TITL_HEART_VOICE_ID;
}

export function isParadee11Voice(voiceId) {
  return voiceId === PARADEE11_VOICE_ID;
}

export function isParadee13Voice(voiceId) {
  return _PARADEE13_BY_ID.has(voiceId);
}

// Any Light voice (tiny ONNX, single-threaded wasm, no WebGPU).
export function isLightVoice(voiceId) {
  return isParadeeVoice(voiceId) || isTitlVoice(voiceId) || isParadee11Voice(voiceId) || isParadee13Voice(voiceId);
}

export function engineForVoice(voiceId) {
  if (isParadeeVoice(voiceId)) return "paradee";
  if (isTitlVoice(voiceId)) return "titl";
  if (isParadee11Voice(voiceId)) return "paradee11";
  if (isParadee13Voice(voiceId)) return "paradee13";
  return "kokoro";
}

// --- toMisaki ---------------------------------------------------------------
// kokoro-js phonemizes with eSpeak NG, but Paradee only ever saw phonemes from
// misaki (Kokoro's own G2P) in training. The two spell the same sounds
// differently ("aɪ" vs "I", "oʊ" vs "O", length marks, flaps), and fed raw
// eSpeak phonemes Paradee mumbles (Whisper word error rate 31% vs 3%). This is
// misaki's own eSpeak-to-misaki table (misaki/espeak.py, EspeakFallback,
// American English), adapted to eSpeak output that has no tie marks between the
// two halves of a diphthong.
//
// Vendored from https://github.com/sahilmahendrakar/paradee/blob/main/web/misaki.js
// (Apache-2.0, same as Kokoro). The TTS worker embeds this function's source,
// so keep it dependency-free and self-contained.
//
// `british` selects misaki's lang 'b' table (the bf_/bm_ voices): eSpeak's "eə"
// is misaki's ɛː, "əʊ" is Q, and British vowels keep their length marks — the
// plain (American) path strips ː instead. Paradee v1.1 only ever spoke af_heart
// so it never needed this; v1.3 speaks bf_isabella/bm_fable too.
export function toMisaki(ps, british = false) {
  const E2M = [
    ["ʔˌn̩", "ʔn"], ["ʔn̩", "ʔn"],
    ["aɪ", "I"], ["aʊ", "W"],
    ["dʒ", "ʤ"],
    ["eɪ", "A"], ["e", "A"],
    ["tʃ", "ʧ"],
    ["ɔɪ", "Y"],
    ["ʲo", "jo"], ["ʲə", "jə"], ["ʲ", ""],
    ["ɚ", "əɹ"],
    ["r", "ɹ"],
    ["x", "k"], ["ç", "k"],
    ["ɬ", "l"],
    ["̃", ""],
  ];
  // British (bf_/bm_ voices): eSpeak's "eə" is misaki's ɛː and has to go before
  // the e -> A rule below. Here British vowels keep their length marks.
  if (british) ps = ps.split("eə").join("ɛː");
  for (const [a, b] of E2M) ps = ps.split(a).join(b);
  ps = ps.replace(/(\S)̩/gu, "ᵊ$1").replace(/̩/g, "");
  // misaki writes a syllabic l at the end of a word as ᵊl (naval -> nˈAvᵊl).
  // eSpeak marks it with a tie that kokoro-js drops, so key on word-final əl.
  ps = ps.replace(/əl(?=[\s;:,.!?—…"“”()]|$)/gu, "ᵊl");
  // misaki's table maps ɐ to ə, but misaki's own lexicon keeps ɐ for the article "a"
  // (and in British, for "an" too)
  ps = british ? ps.replace(/ɐ(?!n?(?:[\s;:,.!?—…"“”()]|$))/gu, "ə")
    : ps.replace(/ɐ(?![\s;:,.!?—…"“”()]|$)/gu, "ə");
  if (british) {
    ps = ps.split("iə").join("ɪə").split("əʊ").join("Q");
    ps = ps.replace(/(^|\s)ðɪ(?=\s|$)/gu, "$1ði");   // "the" before a vowel
  } else {
    ps = ps.split("oʊ").join("O")
      .split("ɜːɹ").join("ɜɹ").split("ɜː").join("ɜɹ")
      .split("ɪə").join("iə")
      .split("ː").join("");
  }
  ps = ps.split("o").join("ɔ");
  return ps.split("ɾ").join("T").split("ʔ").join("t");
}

// --- misaki EspeakG2P renames (non-English v1.3 voices) -----------------------
// For Hindi (hi), French (fr) and Spanish (es), Paradee v1.3 was trained on
// phonemes from misaki's EspeakG2P: raw eSpeak NG output with a few diphthong
// spellings renamed (misaki/espeak.py, version != '2.0' branch — ties and
// hyphens deleted). The TTS worker embeds this function's source, so keep it
// dependency-free and self-contained. The «»/() pre/post-processing lives in
// the caller (it needs the original text), matching EspeakG2P.__call__.
export function espeakG2P(phonemes) {
  const E2M = [
    ["a^ɪ", "I"], ["a^ʊ", "W"],
    ["d^z", "ʣ"], ["d^ʒ", "ʤ"],
    ["e^ɪ", "A"],
    ["o^ʊ", "O"], ["ə^ʊ", "Q"],
    ["s^s", "S"],
    ["t^s", "ʦ"], ["t^ʃ", "ʧ"],
    ["ɔ^ɪ", "Y"],
  ];
  let ps = phonemes;
  for (const [a, b] of E2M) ps = ps.split(a).join(b);
  // Delete any remaining tie characters and hyphens (misaki isn't sure what
  // the hyphens mean either).
  return ps.replace(/\^/g, "").replace(/-/g, "");
}

// --- worker pool sizing ------------------------------------------------------
// The Light models need no threads (one thread already runs many times faster
// than realtime) and each worker holds only an ~8.5 MB model, so the pool can
// scale with cores — within the HARD half-cores background budget (see
// cpuBudget in audio.js): TTS + MP3 workers combined never exceed half of
// navigator.hardwareConcurrency. 64-core desktop => 16 workers (unchanged);
// 4-core phone => 1 TTS + 1 MP3 worker = exactly its budget of 2.
export function computeParadeePool(cores) {
  const n = Math.floor(cores || 4);
  const workers = Math.max(1, Math.min(16, cpuBudget(n) - computeMp3PoolSize(n)));
  return { maxWorkers: workers };
}

export function computeTitlPool(cores) {
  return computeParadeePool(cores);
}

export function computeParadee11Pool(cores) {
  return computeParadeePool(cores);
}

export function computeParadee13Pool(cores) {
  return computeParadeePool(cores);
}

// --- single-flight model bytes ------------------------------------------------
// 16 workers fetching the remote model URL in a burst each download it FULLY:
// the CDN sends no `cache-control` (ETag only), so in-flight requests never
// share — ~16 x 8.5 MB per pool init. Instead the main thread downloads the
// int8 file ONCE per engine, keeps it as a same-origin blob: URL (memory-
// served to every worker, zero further network), and hands that URL to all
// workers. The blobs live for the page lifetime (a few MB each); re-fetching
// them on every idle-unload rebuild would cost more than it saves.
const _modelBlobs = new Map(); // engine -> { url, size } | Promise<{ url, size }>
function lightModelRemoteUrl(engine) {
  if (engine === "titl") return TITL_MODEL_URL_INT8;
  if (engine === "paradee11") return PARADEE11_MODEL_URL_INT8;
  if (engine === "paradee13") return PARADEE13_MODEL_URL_INT8;
  return PARADEE_MODEL_URL_INT8;
}
export async function lightModelBlobUrl(engine) {
  let e = _modelBlobs.get(engine);
  if (!e) {
    e = (async () => {
      const res = await fetch(lightModelRemoteUrl(engine));
      if (!res.ok) throw new Error("light model fetch failed: " + res.status);
      const blob = await res.blob();
      const rec = { url: URL.createObjectURL(blob), size: blob.size };
      _modelBlobs.set(engine, rec);
      return rec;
    })();
    _modelBlobs.set(engine, e);
  }
  return (await e).url;
}

// --- single-file runtime bundle ------------------------------------------------
// src/paradee11-rt.bundle packs EVERYTHING a Light worker needs except plain
// JS (which is properly HTTP-cacheable, unlike the wasm/model bytes that
// caused the 16x re-downloads): the JSEP-less ORT glue + wasm, the v1.1 int8
// model, and the tokenizer. Layout: magic[8]="P11BNDL1" | u32LE headerLen |
// headerJSON | payloads. Built by src/tools/build-paradee11-bundle.js (hashes
// in the header; sources pinned there).
//
// Downloaded ONCE per page on the main thread, sliced into memory-served
// blob: URLs, and handed to every worker via init params — workers then make
// ZERO runtime fetches (model/tokenizer/wasm all memory-served; only the
// static esm.sh/jsdelivr JS imports hit the network, once, via HTTP cache).
// The whole 19.7 MB buffer is retained for the page lifetime (same precedent
// as the model blobs); the model blob URL is minted lazily so a titl-only
// session never copies the v1.1 model bytes.
export const PARADEE11_BUNDLE_URL = "src/paradee11-rt.bundle";
// v1.3 runtime bundle: same P11BNDL1 layout, same JSEP-less ORT + tokenizer,
// but the v1.3 int8 model (all eight voices in one file). Built by
// src/tools/build-paradee13-bundle.js. Kept as a separate file (not a second
// section in the v1.1 bundle) so the old bundle stays byte-identical and the
// v1.1 pool never downloads the v1.3 model bytes.
export const PARADEE13_BUNDLE_URL = "src/paradee13-rt.bundle";
const _BUNDLE_MAGIC = "P11BNDL1";
let _bundlePromise = null;
function _parseBundle(buf) {
  const u8 = new Uint8Array(buf);
  const magic = new TextDecoder().decode(u8.slice(0, 8));
  if (magic !== _BUNDLE_MAGIC) throw new Error("bundle bad magic: " + JSON.stringify(magic));
  const headerLen = new DataView(buf).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(u8.slice(12, 12 + headerLen)));
  const sections = {};
  for (const f of header.files) sections[f.name] = u8.slice(f.offset, f.offset + f.length);
  return { header, sections, bytes: u8.length };
}
export function loadParadee11Bundle() {
  if (!_bundlePromise) {
    _bundlePromise = (async () => {
      const res = await fetch(PARADEE11_BUNDLE_URL);
      if (!res.ok) throw new Error("bundle fetch failed: " + res.status);
      const buf = await res.arrayBuffer();
      const { header, sections } = _parseBundle(buf);
      const file = (n) => {
        if (!sections[n]) throw new Error("bundle missing section: " + n);
        return sections[n];
      };
      const ortMjsText = new TextDecoder().decode(file("ort-mjs"));
      if (!ortMjsText.includes("ort-wasm-simd-threaded.wasm") || ortMjsText.includes("jsep")) {
        throw new Error("bundle ort-mjs failed sanity check");
      }
      const ortMjsUrl = URL.createObjectURL(new Blob([file("ort-mjs")], { type: "text/javascript" }));
      const ortWasmUrl = URL.createObjectURL(new Blob([file("ort-wasm")], { type: "application/wasm" }));
      const tokenizerJson = JSON.parse(new TextDecoder().decode(file("tokenizer")));
      let modelUrl = null;
      return {
        header,
        bytes: buf.byteLength,
        ortMjsUrl,
        ortWasmUrl,
        tokenizerJson,
        // Minted on first use (paradee11 pools only).
        modelUrl() {
          if (!modelUrl) {
            modelUrl = URL.createObjectURL(new Blob([file("model-int8")], { type: "application/octet-stream" }));
          }
          return modelUrl;
        },
      };
    })().catch((e) => {
      // Fallback path (remote URLs) must keep working: clear the latch so a
      // later init retries the bundle instead of caching the failure forever.
      _bundlePromise = null;
      throw e;
    });
  }
  return _bundlePromise;
}

let _bundle13Promise = null;
export function loadParadee13Bundle() {
  if (!_bundle13Promise) {
    _bundle13Promise = (async () => {
      const res = await fetch(PARADEE13_BUNDLE_URL);
      if (!res.ok) throw new Error("bundle fetch failed: " + res.status);
      const buf = await res.arrayBuffer();
      const { header, sections } = _parseBundle(buf);
      const file = (n) => {
        if (!sections[n]) throw new Error("bundle missing section: " + n);
        return sections[n];
      };
      const ortMjsText = new TextDecoder().decode(file("ort-mjs"));
      if (!ortMjsText.includes("ort-wasm-simd-threaded.wasm") || ortMjsText.includes("jsep")) {
        throw new Error("bundle ort-mjs failed sanity check");
      }
      const ortMjsUrl = URL.createObjectURL(new Blob([file("ort-mjs")], { type: "text/javascript" }));
      const ortWasmUrl = URL.createObjectURL(new Blob([file("ort-wasm")], { type: "application/wasm" }));
      const tokenizerJson = JSON.parse(new TextDecoder().decode(file("tokenizer")));
      let modelUrl = null;
      return {
        header,
        bytes: buf.byteLength,
        ortMjsUrl,
        ortWasmUrl,
        tokenizerJson,
        // Minted on first use (paradee13 pools only).
        modelUrl() {
          if (!modelUrl) {
            modelUrl = URL.createObjectURL(new Blob([file("model-int8")], { type: "application/octet-stream" }));
          }
          return modelUrl;
        },
      };
    })().catch((e) => {
      _bundle13Promise = null;
      throw e;
    });
  }
  return _bundle13Promise;
}

// --- JS import pre-warm -------------------------------------------------------
// The Light worker's static JS imports (ORT entry, kokoro-js, transformers)
// ARE properly HTTP-cacheable, but 16 workers importing them in one burst
// would still each download them fully (in-flight requests never share).
// Importing the same URLs once on the main thread first means the burst hits
// the HTTP cache. Best-effort: workers proceed regardless.
let _jsWarmed = false;
export async function warmLightJsCache(urls) {
  if (_jsWarmed) return;
  _jsWarmed = true;
  try {
    await Promise.all(urls.map((u) => import(/* @vite-ignore */ u).catch((e) => {
      console.warn("js pre-warm failed (workers will fetch directly):", u, e);
    })));
  } catch (e) {}
}

// --- tokenizer ---------------------------------------------------------------
let _tokenizerJson = null;
export async function loadParadeeTokenizerJson() {
  if (_tokenizerJson) return _tokenizerJson;
  const res = await fetch("src/paradee-tokenizer.json");
  if (!res.ok) throw new Error("tokenizer fetch failed: " + res.status);
  _tokenizerJson = await res.json();
  return _tokenizerJson;
}
