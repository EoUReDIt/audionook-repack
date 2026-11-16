// ===========================================================================
// syncmeta.js — revision bookkeeping for library records.
//
// Every book, folder, bookmark and playback position carries a revision of the
// form "<clockBase36>-<deviceId>". The clock is a hybrid logical clock: wall
// time, nudged forward so it never repeats or runs backwards on this device.
// Comparing two revisions tells which copy of a record is newer; a deletion is
// a revision too (a "tombstone"), so a delete can be told apart from "never
// had it".
//
// Nothing in the desktop build exchanges these with another device yet, but
// store.js stamps every change through here, so the records stay ready for a
// future sync and nothing upstream needs to know the difference.
// ===========================================================================

import * as storage from "./storage.js";

const folder = storage.folder("syncMeta");
const KEY = "state";
const CLOCK_WIDTH = 11; // base36 digits; enough for millisecond time far into the future
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const state = { deviceId: null, clock: 0, revs: {} };
let loaded = false;
let loadPromise = null;
let saveTimer = null;
let dirty = false;

function newDeviceId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

function ensureDeviceId() {
  if (!state.deviceId) { state.deviceId = newDeviceId(); dirty = true; }
  return state.deviceId;
}

function formatRev(clock, deviceId) {
  return Math.max(0, Math.floor(clock)).toString(36).padStart(CLOCK_WIDTH, "0") + "-" + deviceId;
}

function parseRev(rev) {
  const s = String(rev || "");
  const i = s.indexOf("-");
  if (i < 0) return { clock: 0, device: s };
  const clock = parseInt(s.slice(0, i), 36);
  return { clock: isFinite(clock) ? clock : 0, device: s.slice(i + 1) };
}

function nextRev() {
  state.clock = Math.max(Date.now(), state.clock + 1);
  return formatRev(state.clock, ensureDeviceId());
}

const keyOf = (type, id) => type + ":" + id;

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 1500);
}

// Negative when a is older than b, positive when newer, 0 when identical.
export function revCmp(a, b) {
  if (a === b) return 0;
  const pa = parseRev(a), pb = parseRev(b);
  if (pa.clock !== pb.clock) return pa.clock < pb.clock ? -1 : 1;
  if (pa.device === pb.device) return 0;
  return pa.device < pb.device ? -1 : 1;
}

export function getDeviceId() { return ensureDeviceId(); }

export function markChanged(type, id) {
  if (id == null) return;
  state.revs[keyOf(type, id)] = { rev: nextRev(), del: false };
  scheduleSave();
}

export function markDeleted(type, id) {
  if (id == null) return;
  state.revs[keyOf(type, id)] = { rev: nextRev(), del: true, at: Date.now() };
  scheduleSave();
}

export function isTracked(type, id) {
  const r = state.revs[keyOf(type, id)];
  return !!(r && !r.del);
}

// The record's revision, or one derived from a timestamp for records that
// predate tracking (device "0" sorts before any real device on a tie).
export function revOf(type, id, fallbackTime) {
  const r = state.revs[keyOf(type, id)];
  if (r && !r.del) return r.rev;
  return formatRev(Number(fallbackTime) || 0, "0");
}

// Adopt a revision decided elsewhere (a sync winner) without minting a new one.
export function setRev(type, id, rev, deleted) {
  if (id == null || !rev) return;
  state.revs[keyOf(type, id)] = deleted ? { rev, del: true, at: Date.now() } : { rev, del: false };
  const { clock } = parseRev(rev);
  if (clock > state.clock) state.clock = clock;
  scheduleSave();
}

export function tombstones() {
  const out = [];
  for (const [k, r] of Object.entries(state.revs)) {
    if (!r.del) continue;
    const i = k.indexOf(":");
    out.push({ type: k.slice(0, i), id: k.slice(i + 1), rev: r.rev });
  }
  return out;
}

export function load() {
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = (async () => {
      let saved = null;
      try { saved = await folder.get(KEY); } catch (e) {}
      if (saved && typeof saved === "object") {
        // The saved identity always wins. Changes stamped before this load
        // finished used a provisional id; re-stamp them so one device never
        // appears under two names.
        if (saved.deviceId && state.deviceId !== saved.deviceId) {
          const provisional = state.deviceId;
          state.deviceId = saved.deviceId;
          if (provisional) {
            for (const r of Object.values(state.revs)) {
              const p = parseRev(r.rev);
              if (p.device === provisional) r.rev = formatRev(p.clock, saved.deviceId);
            }
          }
        }
        if (saved.clock > state.clock) state.clock = saved.clock;
        const cutoff = Date.now() - TOMBSTONE_TTL_MS;
        for (const [k, r] of Object.entries(saved.revs || {})) {
          if (!r || !r.rev) continue;
          if (r.del && r.at && r.at < cutoff) { dirty = true; continue; } // expired tombstone
          // Changes made before the load finished are newer than what was saved.
          const cur = state.revs[k];
          if (!cur || revCmp(cur.rev, r.rev) < 0) state.revs[k] = r;
        }
      }
      ensureDeviceId();
      loaded = true;
      if (dirty) scheduleSave();
    })();
  }
  return loadPromise;
}

export async function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty) return;
  // Never write before the saved state has been merged in, or it would be lost.
  if (!loaded) { await load(); }
  dirty = false;
  try {
    await folder.set(KEY, { deviceId: ensureDeviceId(), clock: state.clock, revs: state.revs });
  } catch (e) {
    dirty = true;
    console.warn("syncmeta save failed:", e);
  }
}

load().catch(() => {});
