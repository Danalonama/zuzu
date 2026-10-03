# Repo cleanup — proposal (nothing deleted yet)

*2026-10-01. Every claim below comes from grepping the repo at commit `ed87d18`. Tick what you want gone and I'll do it in one commit on a branch, so you can review it before it reaches the live site.*

## Why bother
1. **Probably public.** There's no `.vercelignore`, and Vercel serves every file in the repo root as a static file. If that holds, then `docs/` (your to-do, audits, Iris's phone number in `zuzu_tasks_checklist.md`), the full backend `apps-script/zuzu-events.gs`, the 9 MB zip and ~60 screenshots are all reachable at `zuzu.today/...`.
   **I could not verify this.** This environment's network blocks zuzu.today. Check it yourself by opening `https://zuzu.today/docs/claude/zuzu-todo.md` in a browser. If it loads, it's public.
   Nothing secret leaked as far as I can see: the Anthropic key lives in Apps Script properties, not in the code, and the Apps Script web-app URL is already in `index.html` anyway. The issue is mostly that internal notes are exposed.
2. **Confusion.** Three old copies of the main page sit next to the real one.

## A. Safe to delete — nothing references them

| File | Size | Evidence |
|---|---|---|
| `zuzu (1).zip` | 8.8 MB | Snapshot from 2026-06-25 of the files already in the repo (old `index.html`, assets, screenshots, `backend/`). Nothing links to it. |
| `index_1.html` | 155 KB | Older copy of `index.html` (last changed 2026-08-22; `index.html` 2026-08-30). No file links to it. |
| `Zuzu.html` | 81 KB | June 14 design draft. No file links to it. |
| `Zuzu - Blit.html` | 89 KB | June 14 design draft. No file links to it. |
| `uploads/` (whole folder) | 7.2 MB | Chat screenshot pastes + an older `index.html` + `zuzu.html` from June 14. Nothing outside the folder links into it. |
| `screenshots/` | 288 KB | Debug screenshots (`dbg.png`, `grid2.png`…). Nothing links to them. |
| `backend/` (`zuzu-events.gs` 6.6 KB + `SETUP.md`) | 10 KB | The original v0 backend. Superseded by `apps-script/zuzu-events.gs` (134 KB). **Keep `SETUP.md`** if you still use it as setup instructions; it describes the old 12-column sheet, so it's likely stale too. |
| `assets/blob-duo.png`, `blob-ink.png`, `blob-orange.png`, `blob-stars.png`, `blob-white.png`, `hero-blob.png`, `hero-blob-bg.png` | ~1 MB | Only used by the drafts above (`Zuzu.html`, `Zuzu - Blit.html`) or by nothing. The live pages only use `assets/zuzu-logo.svg` and `assets/question-icon.svg`. |

## B. Decide — orphan pages (live, but nothing links to them)
`index.html` links only to `quiz.html` and `install.html`. These four are reachable only by typing the URL:

| Page | Last changed | Note |
|---|---|---|
| `about.html` | 07-23 | A real About page that links back to `index.html`, but nothing links *to* it. Probably you want it linked from the site rather than deleted. |
| `setup-guide.html` + `copy-code.html` | 06-24 | Setup instructions for the old backend. Probably stale. |
| `styles-guide.html` | 07-23 | **Has 10 broken images**: it points at `assets/improv.png`, `ecstatic.png`, `research.png`, `biodanza.png`, `mahol.png`, `gaga.png`, `movement.png`, `nia.png`, `contact.png` and `freedance.png`, and none of them exist in `assets/`. Fix, link and keep, or delete? |

## C. Keep private but in the repo
`docs/` and `apps-script/` are useful in git, but they probably shouldn't be served. Add a `.vercelignore`:
```
docs/
apps-script/
backend/
v2/
*.md
*.zip
uploads/
screenshots/
```
This is a one-file change with no effect on the site's pages. One risk: if Vercel builds the project in a way I haven't seen, ignoring `v2/` could later hide the planned `v2/api/` functions. When v2 starts, `v2/` should come off this list.

## D. Things this does NOT fix
- **Git history keeps everything.** Deleting the zip and uploads makes the checkout smaller, but `.git` (17 MB) still holds them. Shrinking it means rewriting history and force-pushing `main`. I don't recommend it: it's only 17 MB, and a rewrite breaks every existing clone.
- **Already-public files stay cached.** If the docs were public, search engines may already have them. `robots.txt` currently says `Allow: /`.

## What I'd do
A, the `.vercelignore` from C, and B's `setup-guide`/`copy-code`, all in one commit on a branch. You'd check the Vercel preview, then merge. Total risk: low, because nothing live links to any of it. But it's your call; "deleted" includes the drafts you might still want as design references.
