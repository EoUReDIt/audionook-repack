// ===========================================================================
// platform.js — the standalone replacement for the hosting site's plugins.
//
// The original app ran inside a host page that provided a global `root` object
// with server-backed plugins (AI text, AI images, uploads, a shared socket,
// cross-origin fetch, key/value storage). The desktop build has none of those
// servers, so this file provides a local `root` plus one feature table that the
// UI reads to decide what to show, disable or hide.
//
// Load this before app.js.
// ===========================================================================

export const features = {
  // Community catalogue and public share links: removed in the desktop build.
  explore: false,
  sharing: false,
  deviceSync: false,
  // AI-backed features: present in the UI but disabled until a provider is
  // connected. Flip `ai` (see connectAi) and all three come back together.
  ai: false,
};

export const AI_DISABLED_HINT = "Needs an AI connection — not set up yet";

let aiProvider = null;

// Future hook: pass { generateText, generateImage } to enable the AI features.
export function connectAi(provider) {
  aiProvider = provider || null;
  features.ai = !!(aiProvider && typeof aiProvider.generateText === "function");
  return features.ai;
}

function unavailable(what) {
  return async () => { throw new Error(what + " is not available in the desktop app"); };
}

// --- key/value fallback (IndexedDB) ----------------------------------------
// storage.js prefers the Origin Private File System; this is only reached when
// that is missing. Same tiny folder API: get/set/delete/keys/entries/clear.
const DB_NAME = "audionook-kv";
let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction("kv", mode);
    const out = fn(t.objectStore("kv"));
    t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
function kvFolder(name) {
  const prefix = name + "\u0000";
  const range = () => IDBKeyRange.bound(prefix, prefix + "￿");
  return {
    get: (key) => tx("readonly", (s) => s.get(prefix + key)),
    set: (key, value) => tx("readwrite", (s) => s.put(value, prefix + key)).then(() => value),
    delete: (key) => tx("readwrite", (s) => s.delete(prefix + key)),
    keys: () => tx("readonly", (s) => s.getAllKeys(range())).then((ks) => (ks || []).map((k) => String(k).slice(prefix.length))),
    entries: async () => {
      const [ks, vs] = await Promise.all([
        tx("readonly", (s) => s.getAllKeys(range())),
        tx("readonly", (s) => s.getAll(range())),
      ]);
      return (ks || []).map((k, i) => [String(k).slice(prefix.length), vs[i]]);
    },
    clear: () => tx("readwrite", (s) => s.delete(range())),
  };
}
const kvFolders = new Map();
const kv = new Proxy({}, {
  get(_, name) {
    if (typeof name !== "string") return undefined;
    if (!kvFolders.has(name)) kvFolders.set(name, kvFolder(name));
    return kvFolders.get(name);
  },
});

// --- cross-origin fetch ------------------------------------------------------
// "From a URL…" needs to read arbitrary web pages. Inside the desktop shell the
// native side does the request (no browser cross-origin limits); in a plain
// browser we fall back to fetch(), which only works for permissive sites.
async function superFetch(url, init) {
  const native = window.__AUDIONOOK_NATIVE__;
  if (native && typeof native.fetchText === "function") {
    const text = await native.fetchText(String(url));
    return new Response(text, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return fetch(url, init);
}

const root = {
  kv,
  superFetch,
  generateText: (opts) => (features.ai ? aiProvider.generateText(opts) : unavailable("AI text")()),
  generateImage: (opts) => (features.ai && aiProvider.generateImage ? aiProvider.generateImage(opts) : unavailable("AI image generation")()),
  uploadPlugin: unavailable("Uploading"),
  createServerSocket: () => { throw new Error("The shared server is not available in the desktop app"); },
};

window.root = root;
window.generatorName = "audionook";
window.AUDIONOOK = { features, connectAi };
