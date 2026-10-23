# Editing page (zuzu.today/edit)

One page for fixing what's already in Supabase: events, cancelled dates, venues and hosts.
New events still come in through the bot and the feeds. This page doesn't create events.

```
edit.html             the page (public URL, but useless without the password)
api/admin.js          Vercel function: checks the password, holds the service key, does the write
admin/actions.js      what each action may change, and the checks (the bot's own: bot/map.js validateRow, bot/normalize.js)
admin/test/           npm test (offline, the bot's fake Supabase)
```

## Setup (once)
1. Vercel → the project → Settings → Environment Variables (Production): `ADMIN_PASSWORD` = a long
   password (at least 12 characters, e.g. `openssl rand -base64 18`). Without it the page refuses to work.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the bot's, reused.
2. Redeploy.
3. Open zuzu.today/edit and enter the password. "Remember on this device" keeps it in the browser
   (localStorage); otherwise it's forgotten when the tab closes.

## What it does
- **Events:** search (title, venue, host, city), filter by status (on the site / not on the site) and time.
  Every field can be edited. A status other than `live` takes the event off the site without deleting it.
  The same checks as the bot apply: a `live` event needs a movement style and a link or phone.
- **Cancelled meetings:** on a weekly event, tap a date to mark it as not happening (saved immediately); tap again to restore it.
  Other per-date changes (a substitute host, a note) are added below that.
- **Venues / hosts:** name, aliases, type, city, address/phone, website. Renaming keeps the old name as
  an alias (a checkbox, on by default), so the bot and the feeds still recognise it. A name or alias
  that already belongs to another row is refused: merging duplicates is still done in Supabase.
- **Two editors at once:** if the bot or a feed changed an event after you opened it, saving is
  refused, the current version is loaded, and you save again.
- Only fields you changed are sent. Nothing is deleted except a cancelled date or a host link.

## Limits
- One shared password, no per-person accounts and no change log. Supabase keeps no history of edits.
- Wrong passwords get a 1-second delay. There's no lockout (the function keeps no state).
- The allowed values (status, price type, …) are read from the Supabase enums through
  `intake_column_enum` (from `v2/db/2026-09-30-intake-bot.sql`). A column that isn't an enum gets the
  values already in use.
