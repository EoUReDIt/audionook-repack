// ===========================================================================
// crop.js — the cover cropper.
//
// openCropper(imageBlob, { aspect, title }) shows the image in a fixed-ratio
// frame; the user drags to position and zooms with the slider, wheel or pinch.
// Resolves to a JPEG Blob of the framed area, or null if they cancel.
//
// It manages its own overlay (rather than util.openModal) because it is opened
// from inside other modals and must stack above them without closing them.
// ===========================================================================

import { el, icon } from "./util.js";

const OUTPUT_WIDTH = 1020;   // px; plenty for a card slot, small enough to store
const OUTPUT_QUALITY = 0.88;
const MAX_ZOOM = 5;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image couldn't be opened")); };
    img.src = url;
  });
}

export async function openCropper(source, { aspect = 1.7, title = "Crop image" } = {}) {
  if (!source) return null;
  const { img, url } = await loadImage(source);
  const natW = img.naturalWidth, natH = img.naturalHeight;
  if (!natW || !natH) { URL.revokeObjectURL(url); throw new Error("That image is empty"); }

  return new Promise((resolve) => {
    const host = document.querySelector("#modalRoot") || document.body;
    const overlay = el("div", { class: "modal-overlay cropper-overlay" });
    const panel = el("div", { class: "modal-panel cropper-panel" });
    const closeBtn = el("button", { class: "icon-btn modal-close", "aria-label": "Close", html: icon("close", { size: 20 }) });
    const head = el("div", { class: "modal-head" }, [el("h2", { class: "modal-title", text: title }), closeBtn]);
    const body = el("div", { class: "modal-body" });

    const stage = el("div", { class: "crop-stage" });
    stage.style.aspectRatio = String(aspect);
    img.className = "crop-img";
    img.draggable = false;
    img.alt = "";
    stage.appendChild(img);
    stage.appendChild(el("div", { class: "crop-grid" }));

    const zoom = el("input", { class: "crop-zoom", type: "range", min: "1", max: String(MAX_ZOOM), step: "0.01", value: "1", "aria-label": "Zoom" });
    const hint = el("div", { class: "crop-hint", text: "Drag to position" });
    const tools = el("div", { class: "crop-tools" }, [zoom, hint]);

    const cancelBtn = el("button", { class: "btn btn-ghost", text: "Cancel" });
    const useBtn = el("button", { class: "btn btn-primary", text: "Use this" });
    const actions = el("div", { class: "crop-actions" }, [cancelBtn, useBtn]);

    body.appendChild(stage);
    body.appendChild(tools);
    body.appendChild(actions);
    panel.appendChild(head);
    panel.appendChild(body);
    overlay.appendChild(panel);
    host.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open"));

    // View state: `scale` multiplies the "cover" fit; (x, y) is the image's
    // top-left corner in stage pixels (always <= 0 so the frame stays filled).
    let stageW = 0, stageH = 0, baseScale = 1, scale = 1, x = 0, y = 0;

    function clamp() {
      const w = natW * baseScale * scale, h = natH * baseScale * scale;
      x = Math.min(0, Math.max(stageW - w, x));
      y = Math.min(0, Math.max(stageH - h, y));
    }
    function paint() {
      const w = natW * baseScale * scale, h = natH * baseScale * scale;
      img.style.width = w + "px";
      img.style.height = h + "px";
      img.style.transform = "translate(" + x + "px," + y + "px)";
    }
    function layout(keepCentre = false) {
      const r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const prevW = stageW, prevH = stageH;
      // Where the frame's centre sits on the image, as fractions, so a resize
      // keeps the same part of the picture framed.
      const fx = prevW ? (prevW / 2 - x) / (natW * baseScale * scale) : 0.5;
      const fy = prevH ? (prevH / 2 - y) / (natH * baseScale * scale) : 0.5;
      stageW = r.width; stageH = r.height;
      baseScale = Math.max(stageW / natW, stageH / natH);
      const w = natW * baseScale * scale, h = natH * baseScale * scale;
      x = stageW / 2 - (keepCentre ? fx : 0.5) * w;
      y = stageH / 2 - (keepCentre ? fy : 0.5) * h;
      clamp(); paint();
    }
    // Zoom about a point in the stage so that point stays put under the cursor.
    function setScale(next, cx = stageW / 2, cy = stageH / 2) {
      next = Math.min(MAX_ZOOM, Math.max(1, next));
      const k = next / scale;
      x = cx - (cx - x) * k;
      y = cy - (cy - y) * k;
      scale = next;
      zoom.value = String(scale);
      clamp(); paint();
    }

    const pointers = new Map();
    let pinchStart = null;
    stage.addEventListener("pointerdown", (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.classList.add("dragging");
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      }
    });
    stage.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size >= 2 && pinchStart) {
        const [a, b] = Array.from(pointers.values());
        const r = stage.getBoundingClientRect();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart.dist > 0) setScale(pinchStart.scale * (dist / pinchStart.dist), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else {
        x += dx; y += dy;
        clamp(); paint();
      }
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!pointers.size) stage.classList.remove("dragging");
    };
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      setScale(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    zoom.addEventListener("input", () => setScale(parseFloat(zoom.value) || 1));

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout(true)) : null;
    if (ro) ro.observe(stage);
    requestAnimationFrame(() => layout(false));

    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      if (ro) ro.disconnect();
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.remove("open");
      setTimeout(() => { overlay.remove(); URL.revokeObjectURL(url); }, 220);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); finish(null); }
    }
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", () => finish(null));
    cancelBtn.addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });

    useBtn.addEventListener("click", () => {
      if (!stageW) layout(false);
      const k = baseScale * scale;              // stage px per image px
      const sx = -x / k, sy = -y / k;           // framed area, in image px
      const sw = stageW / k, sh = stageH / k;
      const outW = Math.round(Math.min(OUTPUT_WIDTH, sw));
      const outH = Math.round(outW / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      useBtn.disabled = true;
      canvas.toBlob((blob) => finish(blob || null), "image/jpeg", OUTPUT_QUALITY);
    });
  });
}
