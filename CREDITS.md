# Credits

## The original app

This project is a desktop build of **Audionook**, a text-to-speech audiobook web app
published at `perchance.org/audionook`. Its design, its interface and most of the code in
`app/src/` are the work of that app's author, whose name does not appear in the exported
source. Their code is kept unmodified in `reference/perchance-src/`.

**Licence status.** The exported source carries no licence. This repository adds none of its
own for that code, and nothing here should be read as permission to redistribute it. Anyone
intending to share builds beyond personal use should get the author's agreement first.

## This project

- **Direction, decisions and testing:** the repository owner, [@EoUReDIt](https://github.com/EoUReDIt).
- **Implementation:** Claude Code, an AI coding agent by Anthropic, working under the
  owner's direction. `docs/HISTORY.md` sets out who did what.

The repository began as a fork of `aclank/audionook`, an unrelated audiobook server whose
name it shares. None of that project's files remain.

## Voice models

| Model | Author | Used for |
|---|---|---|
| Kokoro-82M | hexgrad; ONNX conversion by the `onnx-community` organisation on Hugging Face | Best and Balanced engines. Downloaded on first use. |
| Paradee-8M v1.3 | Sahil Mahendrakar | Light engine. Bundled with the app. |
| Teacher-in-the-Loop | Fabio Angela (MithrilMan) | Legacy Light voice kept for old books. Not bundled. |

Check each model's page on Hugging Face for its licence terms.

## Bundled software

Licences as declared by each package.

| Component | Author / project | Licence |
|---|---|---|
| kokoro-js | hexgrad | Apache-2.0 |
| transformers.js | Hugging Face | Apache-2.0 |
| phonemizer.js | Xenova | Apache-2.0 |
| ONNX Runtime Web | Microsoft | MIT |
| `@huggingface/kernels` | Hugging Face | Apache-2.0 |
| eSpeak NG (Emscripten build) | eSpeak NG contributors; build by the Echogarden project | GPL-3.0 |
| lamejs | Alex Zhukov | LGPL-3.0 |
| pdf.js | Mozilla | Apache-2.0 |
| zip.js | Gildas Lormeau | BSD-3-Clause |
| Readability | Mozilla | Apache-2.0 |
| Inter (font) | Rasmus Andersson | OFL-1.1 |
| Fraunces (font) | Undercase Type | OFL-1.1 |
| Tauri | The Tauri Programme | Apache-2.0 or MIT |

The eSpeak-to-misaki phoneme tables inside `app/src/paradee.js` come from the Paradee and
misaki projects, as noted in that file.

**A note on copyleft.** eSpeak NG (GPL-3.0) and lamejs (LGPL-3.0) ship inside the app.
Those licences place conditions on distributing builds that include them. Read them before
publishing an installer.

## Build tools

esbuild, Node.js, Rust, NSIS and GitHub Actions.
