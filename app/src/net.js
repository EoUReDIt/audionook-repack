// ===========================================================================
// net.js — desktop stand-in for the Explore backend client.
//
// The original talked to a shared server that listed published audiobooks. The
// desktop build has no such server, so this keeps the same surface the app
// calls and reports itself permanently offline. Nothing here touches the
// network.
// ===========================================================================

export const US = "\u001f";
export const RS = "\u001e";

export class ServerNet {
  constructor() { this.status = "blocked"; this.socket = null; }
  onStatus(cb) { try { cb(this.status); } catch (e) {} return () => {}; }
  onNew() { return () => {}; }
  async connect() { return false; }
  async list() { return { items: [], total: 0 }; }
  async stats() { return null; }
  async submit() { throw new Error("Publishing is not available in the desktop app"); }
  async play() { return null; }
  async report() { return null; }
  close() {}
}

export function parseRow() { return null; }
export function parseListing() { return { items: [], total: 0 }; }
