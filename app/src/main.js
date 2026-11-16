// ===========================================================================
// main.js — entry point for the standalone build.
//
// Order matters: platform.js installs the local `root` object that the app's
// modules expect to find, so it must finish before app.js is evaluated.
// ===========================================================================

import "./platform.js";
import { icon } from "./util.js";

// Icons for the static shell buttons that app.js doesn't paint itself.
const closeBtn = document.querySelector("#npCloseBtn");
if (closeBtn) closeBtn.innerHTML = icon("chevronDown", { size: 22 });

await import("./app.js");
