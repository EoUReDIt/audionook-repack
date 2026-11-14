# How this project came to be

This is the story of how an empty fork became a working desktop app, written down so that
anyone picking the project up knows why it looks the way it does.

## Starting point

The repository began as a fork of `aclank/audionook`, a self-hosted audiobook *server*
(Python, Flutter, NGINX, Docker). The goal was simple to state: repackage it as something
a person can install by running one file, with no Docker.

The first finding changed the plan. The fork, like its upstream, contained only a README,
a Makefile and two compose files. The application code had never been published, and the
Docker image the README pointed to did not exist. There was nothing to repackage.

## Finding the real target

Three candidates were examined before the right one turned up:

1. **`aclank/audionook`** — the server described above. No source available.
2. **`jay2jp/audionook`** — an unrelated, small browser audiobook *player* with the same
   name. Looked at, not used.
3. **Audionook on Perchance** (`perchance.org/audionook`) — a text-to-speech app that turns
   pasted text and documents into audiobooks, entirely in the browser. This was the app the
   project owner actually wanted to recreate.

A saved copy of the Perchance page showed what the app did but contained none of its code:
browsers strip scripts when saving a page, and every hidden section of the page was missing
too. The owner then exported the app's source files from the Perchance editor, one batch at
a time. Those files are kept unmodified in `reference/perchance-src/`.

Four source files and the page's HTML could not be exported. They were written fresh for
this project, and the page skeleton was rebuilt from the stylesheet, the element names the
code expects, and screenshots of the original supplied by the owner.

## What had to change

The original leaned on its host in three ways, and each needed a different answer:

| The original relied on | The desktop build |
|---|---|
| The host's servers for Explore, public sharing and device sync | Removed. They cannot work without those servers. |
| The host's AI services for text clean-up, cover art and titles | Kept in the interface but disabled, behind one switch, until an AI provider is connected. |
| CDNs and Hugging Face for libraries, fonts and voice models at run time | Bundled at build time. The Light voices need no network at all. |

Speech generation itself needed no rework: the original already ran its voice models on the
listener's own machine. That is what made a server-free build possible.

## Sprints

**Sprint 1 — foundations.** Analysis, recovering the source, writing the missing modules
(document reader, cover cropper, device speed check, change tracking) and the stand-ins for
the host's plugins.

**Sprint 2 — a working app and an installer.** The page skeleton, offline narration,
titles and covers from documents, disabled AI controls, bundled fonts and pronunciation
data, the desktop shell, and an automated Windows build producing an installer and a
portable zip. This sprint ended with the owner's first hands-on test on a laptop.

**After the first test.** A Speech engine setting (Best / Balanced / Light), a
generate-ahead limit and engine warm-up for smoother playback on small machines, and a fix
for chart debris being read out of PDFs — found by the owner while listening to a real book.

`CHANGELOG.md` lists the changes; `docs/ROADMAP.md` holds what comes next.

## A human-led process

The project owner directed this work; an AI coding agent (Claude Code) carried it out. The
split matters, so it is recorded plainly.

**Decided by the owner**

- The goal: one file to launch, independent of Docker.
- Which app was the real target, and supplying its source, a saved page and screenshots.
- What to do with each feature that could not survive the move: remove Explore and public
  sharing; keep the AI features visible but disabled rather than deleting them.
- Titles from the file name and covers from the first page.
- The desktop shell (Tauri, built by GitHub Actions) after weighing it against Electron.
- A graphics on/off option, later reshaped at the owner's request into a three-level
  Speech engine choice.
- Working in sprints, what went into each, and when to stop and call a release stable.
- Testing on real hardware, judging how the voices sound, and reporting what was wrong.

**Done by the agent**

- Investigating the repositories, the Docker image and the saved page.
- Reading the exported source to work out how the app runs and what it depends on.
- Writing the missing modules, the build tooling, the desktop shell and these documents.
- Testing each change in a headless browser, and reading the build logs.
- Laying out options with their trade-offs, and saying what had and had not been verified.

Things only a person could settle were left to the owner: how narration sounds, how the app
feels on a modest laptop, and whether the installed app behaves. The PDF fix above exists
because the owner listened to a two-hour book and noticed the moment it went wrong.
