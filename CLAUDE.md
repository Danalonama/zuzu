# zuzu — read this first

zuzu.today is a curated Hebrew (RTL) calendar of movement & dance events in Israel. Owner: Dana.

## The repo is NOT the whole project — check these before starting work
The repo misses most of the current state. Before planning anything:

1. **Task board (source of truth for to-dos):** artifact "לוח המשימות של זוזו" —
   https://claude.ai/artifact/BBd7KPMdD41A8HXu7YAxDH
   Its tasks live in the artifact's database (`tasks` collection): read them with the ArtifactData tool, and add or update tasks there, not in markdown files.
2. **Rebuild plan:** Claude Docs doc "Zuzu v2 — rebuild plan" —
   https://claude.ai/artifact/3v5QG98wDxTcdsvanNjTmm (read it with the Claude Docs connector).
3. **Open pull requests:** list them before writing code. Several sessions work in parallel, and parallel work has already been duplicated (two near-identical source-probe PRs). If an open PR already covers the work, build on it or say so; don't start a second copy.
4. **Supabase** holds the v2 data and schema (project URL is in `index.html` on the `v2` branch). The schema there beats any data-model doc in this repo.

## Current state (snapshot 2026-10-01 — verify, it moves fast)
- **Live site** = `index.html` on `main`, served by Vercel at zuzu.today. Data still comes from v1 (the `זוזו אירועים` Google Sheet via Apps Script).
- **v2 is in progress, not "not started":** Supabase is live; Apps Script already mirrors new events into a Supabase queue (`event_submissions`).
  - PR #1 (branch `v2`) switches the site to read from Supabase. The board says it merges after 4.10.
  - PR #2 adds the Telegram intake bot (`bot/`, `api/telegram.js`, `v2/db/`).
- **v1 backend** = `apps-script/zuzu-events.gs`. It's a copy kept for version control. The deployed code lives in the Apps Script editor, so any change must be pasted there by Dana and redeployed. You cannot run or test it from here.

## Stale docs — don't plan from these
- `docs/zuzu-v2-data-model-questions.md`: the blank `Decision:` lines are not the real state. Many were decided in Supabase.
- `docs/zuzu_tasks_checklist.md` and `docs/claude/zuzu-todo.md`: older to-do lists. Use the board.
- The status line at the top of `v2/README.md`.

## Rules
- Do not hand-add events a feed already carries (it caused the duplicate floods).
- Do not add new fix-functions to the `.gs`. Only fix live embarrassments.
- Secrets (Supabase service key, Telegram token, Anthropic key) go in Vercel env vars or Apps Script properties. Never in this repo. The Supabase anon key in `index.html` is public by design.
- `.vercelignore` (once merged) keeps `docs/`, `apps-script/`, `v2/` and `*.md` off the public site. Anything else in the repo root gets served publicly.
- Pushing to `main` deploys to the live site. Work on a branch and open a PR.

## Working with Dana
- Say plainly what you could not verify. The sandbox network often blocks outside sites, including zuzu.today itself.
- Give the good news and the bad news. Don't guess.
