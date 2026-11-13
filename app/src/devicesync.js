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
  const listeners = new Set();
  return {
    available: false,
    linked: false,
    deviceId: null,
    peers: [],
    status: "off",
    async init() { await syncmeta.load(); this.deviceId = syncmeta.getDeviceId(); return false; },
    flush() { return syncmeta.saveNow(); },
    setPresence() {},
    async acceptInvite() { throw new Error("Device sync is not available in the desktop app"); },
    async createInvite() { throw new Error("Device sync is not available in the desktop app"); },
    async unlink() {},
    async syncNow() { return null; },
    hasPeer() { return false; },
    getState() { return { linked: false, peers: [], status: "off" }; },
    on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

export const engine = createEngine();
export const defaultIO = null;
