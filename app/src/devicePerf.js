// ===========================================================================
// devicePerf.js — one-off check: should a fresh install default to a Light
// narrator instead of the full Kokoro voice?
//
// Kokoro (~325 MB) needs a real graphics card, or several fast CPU threads, to
// generate speech faster than it is listened to. The Light narrators run many
// times faster than realtime on a single thread. This runs once on a fresh
// install (store.js persists the result) and takes well under a second.
//
// It fails open: any error means "keep Kokoro", and the engine's runtime
// backstop (noteEngineSpeed in app.js) still suggests the Light voices if
// narration actually falls behind.
// ===========================================================================

const BENCH_MS = 220;
// cpuScore() is in millions of multiply-adds per second on one thread. A
// 4-core cloud VM measured ~800-900 while this was written; a core scoring
// under half that is unlikely to keep Kokoro above realtime however many of
// them there are.
const SLOW_CORE_SCORE = 400;
// With no graphics card, Kokoro needs several threads working in parallel
// (the app only ever uses half the cores for background work).
const MIN_CORES_FOR_CPU_KOKORO = 8;

// True when a hardware graphics adapter is available to WebGPU. A software
// ("fallback") adapter doesn't count: it is slower than plain CPU inference.
export async function hasRealGpu() {
  try {
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== "function") return false;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    if (adapter.isFallbackAdapter) return false;
    const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
    if (info && info.isFallbackAdapter) return false;
    const desc = info ? ((info.description || "") + " " + (info.vendor || "") + " " + (info.architecture || "")).toLowerCase() : "";
    if (/swiftshader|llvmpipe|software|basic render/.test(desc)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// Single-thread float throughput, in millions of multiply-adds per second.
export function cpuScore(ms = BENCH_MS) {
  const a = new Float32Array(4096);
  for (let i = 0; i < a.length; i++) a[i] = (i % 97) / 97;
  const start = performance.now();
  let iters = 0, acc = 0;
  while (performance.now() - start < ms) {
    for (let k = 0; k < 64; k++) {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * a[(i * 7 + k) & 4095];
      acc += s;
    }
    iters += 64;
  }
  const elapsed = performance.now() - start;
  if (!(acc === acc)) return 0; // keeps the loop from being optimised away
  return (iters * a.length) / Math.max(1, elapsed) / 1000;
}

export async function probe() {
  const cores = navigator.hardwareConcurrency || 4;
  const memoryGb = navigator.deviceMemory || null; // capped at 8 by browsers; null when unsupported
  const gpu = await hasRealGpu();
  const score = gpu ? null : cpuScore();
  return { cores, memoryGb, gpu, score };
}

export async function shouldDefaultToLight() {
  try {
    const p = await probe();
    if (p.gpu) return false;
    if (p.memoryGb != null && p.memoryGb <= 4) return true;
    if (p.cores < MIN_CORES_FOR_CPU_KOKORO) return true;
    return p.score < SLOW_CORE_SCORE;
  } catch (e) {
    return false;
  }
}
