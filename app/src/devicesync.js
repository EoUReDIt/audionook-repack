// ===========================================================================
// devicesync.js — desktop stand-in for device-to-device sync.
//
// The original paired devices through the host site's server and upload
// service. Neither exists here, so the engine is inert: every call the app
// makes is accepted and does nothing. Folder sync (fssync.js) and backups
// (backup.js) are unaffected and remain the ways to move a library.
// ===========================================================================

import * as syncmeta from "./syncmeta.js";

export function setChunkStore() {}
export function setNowPlaying() {}

export function createEngine() {
  const off = async () => { throw new Error("Device sync is not available in the desktop app"); };
  return {
    available: false,
    deviceId: null,
    secretBytes: null,      // never linked
    peers: new Map(),       // always empty
    onSynced: null,
    async init() { await syncmeta.load(); this.deviceId = syncmeta.getDeviceId(); return false; },
    flush() { return syncmeta.saveNow(); },
    onUpdate() { return () => {}; },
    getStatus() { return { linked: false, state: "off", peers: [], fingerprint: "", lastSync: null }; },
    setPresence() {},
    setActive() {},
    async fetchChunk() { return null; },
    async syncNow() { return null; },
    async unlink() {},
    linkUrl() { return ""; },
    acceptInvite: off,
    createInvite: off,
  };
}

export const engine = createEngine();
export const defaultIO = null;
