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
4. **Supabase** holds the v2 data and schema (project URL is in `index.html`). The schema there beats any data-model doc in this repo.

## Current state (snapshot 2026-10-15 — verify, it moves fast)
- **Live site** = `index.html` on `main`, served by Vercel at zuzu.today. **Since 4.10 it reads events from Supabase** (PR #1). Approving a row in the old Google Sheet no longer changes the site.
- **English site** = `en.html` at zuzu.today/en, generated from `index.html` (see Rules).
- **Filter links** like zuzu.today/tel-aviv-gaga are rewrites to `index.html` in `vercel.json`. The rewrite excludes the existing page and folder names. When you add a top-level page or folder, add its name to that list.
- **Telegram intake bot:** the code is merged (`bot/`, `api/telegram.js`) and its keys are in Vercel. It is not finished. On the board it is still "in progress" (b01), and reading the `event_submissions` queue (b03) is not done yet.
- **v2 feeds** run as Vercel Cron jobs (`feeds/`, `api/feeds/`, schedule in `vercel.json`). The first one, Deep Contact, runs daily as a **dry run**. It writes nothing to `events` until the Vercel env var `FEEDS_LIVE` includes `deepcontact` (board f04).
- **v1 Apps Script still runs** (Tribe, ecstatic, inbox, newsletters). It mirrors new events into the Supabase queue `event_submissions`. Queue rows reach the site only through a weekly manual pass, until the bot reads the queue (b03).
  - `apps-script/zuzu-events.gs` is a copy for version control. The deployed code lives in the Apps Script editor, and Dana must paste in any change and redeploy. You cannot run or test it from here.
  - Some fixes exist only in the repo and are not pasted there yet (board g01).

## Stale docs — don't plan from these
- `docs/zuzu-v2-data-model-questions.md`: the blank `Decision:` lines are not the real state. Many were decided in Supabase.
- `docs/zuzu_tasks_checklist.md` and `docs/claude/zuzu-todo.md`: older to-do lists. Use the board.
- The status lines in `v2/README.md` (both the top line and the 2026-10-01 section).

## Rules
- Do not hand-add events a feed already carries (it caused the duplicate floods).
- Do not add new fix-functions to the `.gs`. Only fix live embarrassments.
- Secrets (Supabase service key, Telegram token, Anthropic key) go in Vercel env vars or Apps Script properties. Never in this repo. The Supabase anon key in `index.html` is public by design.
- `.vercelignore` keeps `docs/`, `apps-script/`, `v2/`, `bot/test/`, `feeds/test/` and `*.md` off the public site. Anything else in the repo gets served publicly unless you add it there.
- New Supabase tables in `public` get full `anon` grants by default. Enable RLS and check the grants on every new table (board s01).
- Pushing to `main` deploys to the live site. Work on a branch and open a PR.
- `en.html` (zuzu.today/en) is generated from `index.html`. Never edit it by hand: change `index.html`, then run `python3 v2/en/build_en.py`. If the script stops, add the new English text to the script, then re-run it.

## Working with Dana
- Say plainly what you could not verify. The sandbox network often blocks outside sites, including zuzu.today itself.
- Give the good news and the bad news. Don't guess.
