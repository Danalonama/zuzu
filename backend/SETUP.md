# Zuzu — connect the "Add event" form to a real, free backend

This makes event submissions actually reach you, and lets approved events show up
on the live site for **everyone** — with no server to maintain and no secret keys
in the page. Moderation is just a checkbox in a Google Sheet.

It takes about 5 minutes.

---

## 1. Create the Google Sheet
1. Go to <https://sheets.new> (signed into the Google account you want to own this).
2. Rename the file to e.g. **Zuzu events**.
3. Rename the first tab (bottom-left) to **`events`** (exact, lowercase).
4. In row 1, paste these headers across columns A–L:

   `timestamp` · `approved` · `date` · `time` · `title` · `host` · `category` · `venue` · `city` · `region` · `url` · `price`

5. Select column **B** (`approved`) → menu **Insert ▸ Checkbox**. Now every new
   submission gets an un-ticked checkbox you can tick to publish.

## 2. Add the script
1. In the Sheet: menu **Extensions ▸ Apps Script**.
2. Delete whatever is in `Code.gs`, then paste the entire contents of
   **`zuzu-events.gs`** (in this folder).
3. Click the **Save** icon.

## 3. (Optional) Turn on screenshot scanning
This lets you drag a WhatsApp screenshot into the form and have Claude read the
event details out of it automatically.
1. Get an Anthropic API key from <https://console.anthropic.com> (Settings ▸ API Keys).
2. In the Apps Script editor: **Project Settings ▸ Script properties ▸ Add script property**.
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your key (`sk-ant-…`)
3. Save. (To use the cheaper/faster model, change `claude-3-5-sonnet-20241022` to
   `claude-3-5-haiku-20241022` in the script.)

If you skip this, everything else still works — only the screenshot scanner is disabled.

## 4. Deploy it as a Web App
1. Top-right **Deploy ▸ New deployment**.
2. Click the gear ⚙ next to "Select type" → choose **Web app**.
3. Set:
   - **Description:** Zuzu events
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
4. Click **Deploy**, approve the permissions prompt (it's your own script).
5. Copy the **Web app URL** — it looks like
   `https://script.google.com/macros/s/AKfy…/exec`

## 5. Plug it into the site
1. Open **index.html**.
2. Find this line (near the bottom, in the "Add-event form" script):

   ```js
   const ZUZU_API = "";
   ```
3. Paste your URL between the quotes:

   ```js
   const ZUZU_API = "https://script.google.com/macros/s/AKfy…/exec";
   ```
4. Save and re-publish the site.

Done. 🎉

---

## How it works day to day
- A visitor fills the **"הוסיפו אירוע"** form — or drops a WhatsApp **screenshot** that the
  scanner reads automatically — → a new row appears in your Sheet with the
  **approved** box **unchecked**. Nothing shows on the site yet.
- You review the row. Happy with it? **Tick the `approved` checkbox.**
- Next time anyone loads the site, the approved event appears on the board
  automatically (the page fetches approved rows on load).
- To remove an event later, un-tick the box (or delete the row).

## Notes
- No API keys live in the page, so it's safe to host publicly.
- If `ZUZU_API` is left empty, the site runs in **demo mode**: submissions stay in
  the visitor's own browser and you moderate via the on-page "ניהול" panel
  (useful for testing, but not shared between people).
- Changed the script later? **Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ Version: New**
  so the URL keeps working.
- Want the site to re-check for new approved events without a refresh? Tell me and
  I'll add a periodic poll.
