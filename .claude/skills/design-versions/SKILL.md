---
name: design-versions
description: Use to design, mock up or prototype a page, screen or feature from one sentence. Builds five truly different working versions, picks one and explains why, the user decides, then a browser check.
---

# Design Versions

A design workflow inspired by a public talk by Meaghan Choi, Claude Code's lead designer, at
Dive Club Live (June 2026, https://www.youtube.com/watch?v=hKeDfupbA4U): ask in one sentence,
get several real versions instead of one, let Claude choose first and explain why, keep the final
decision human, and let Claude verify its own work in a browser. This skill is an independent
write-up of that method, not an official Anthropic skill.

Use it whenever the user asks to design, mock up or prototype something (a landing page, an app
screen, a feature, a slide, an email), asks to "make it look good", or asks for versions or
options. In Claude Code it can also be started with `/design-versions <one sentence>`.

Reply to the user in the language they wrote in.

## The five steps

### 1. One sentence is enough

The user does not need to write a design brief. From their sentence, work out:

- **What** is being designed, and its single job (what a visitor should do or understand).
- **Who** it is for.
- **The real content**: names, offers, prices, features the user mentioned or that you can see
  in the conversation or in files you have access to. If there is none, invent realistic content
  and tell the user it is placeholder text to replace.
- **The language and direction** of the page. For right-to-left languages (Hebrew, Arabic,
  Persian) set `dir="rtl"` and choose fonts that actually include that script.

Do not send a questionnaire. Ask one question only when you cannot even tell what the subject
is. Otherwise state your assumptions in two short lines and continue.

### 2. Five versions, not one

Plan five directions before building anything. Each direction gets a short name and a one-line
concept. Use `reference/directions.md` (in this skill's folder) to pick five that really differ.

The difference contract. Any two versions must differ on at least three of these:
layout skeleton, type pairing, color world, density, the one signature element.
Density counts as different only when the two versions are not on the same step
(sparse, airy, medium, dense).
If two plans look like siblings, replace one of them before you build.

Avoid the defaults that make AI design recognisable: a warm off-white background with a serif
headline and a brick-orange accent; a near-black page with a single neon accent; a newspaper
grid with hairline rules everywhere. Use one of them only when the user asks for it. If a row in
the directions menu pulls toward one of these, this rule wins: change the colors, keep the idea.

Build every version as a complete, working page with the real content. No lorem ipsum, no
"feature one, feature two". Each one should be clickable, responsive down to a phone width
(about 375px wide, with no sideways scrolling), and self-contained in a single HTML file.
Web fonts from a public CDN (such as Google Fonts) are fine; always give a system-font fallback
so the page still reads well if the font does not load.

Where to put them:

- **Claude Code, or any setup that writes to the user's own computer:** write
  `versions/v1.html` to `versions/v5.html` and a `versions/index.html` gallery that shows all
  five side by side, each with a live preview (a scaled-down iframe works well), its direction
  name and concept, and a link to open it full size. If a `versions/` folder already exists,
  write to a new one (`versions-2/` and so on) instead of overwriting it. Open the gallery for
  the user if you can (skip this when running as a subagent or in an automated run). Use these
  files even if an artifact or canvas tool is also available, so the user keeps the five pages
  on their machine.
- **Claude.ai and the Claude apps (even with a code sandbox):** build one artifact with five
  tabs, one per version, with the direction name on each tab. If five full pages are too long
  for one artifact, build one artifact per version, in order, each named with its direction.

### 3. Claude picks first, and explains why

Before asking the user anything, choose the version you think best serves the single job from
step 1. Explain the choice in three short points, tied to that job and that audience, not to
taste. Then name one thing from the runner-up you would borrow.

When writing files on the user's computer, also write the pick and the reasons to
`versions/PICK.md` and mark the picked card in the gallery.

Then hand the decision to the user: they can take your pick, choose another, or remix
("2, with the headline from 4"). The final decision is theirs.

### 4. Refine the chosen one

Apply the user's choice or remix as a new version of the chosen page (for example
`versions/v3b.html`), not as five new options. Keep the direction's identity intact. Small
tweaks (spacing, a color, a word) are often faster for the user to do by hand; say so when that
is the case.

### 5. Check it in a real browser, then suggest improvements

Run this step when you have a browser tool (Claude in Chrome, Playwright or similar), which
usually means Claude Code. If the user has not chosen yet, check your own pick from step 3.

1. Open the chosen page at a phone width and a desktop width.
2. Press every button and link, fill any form with obvious test values, and look for broken
   layout, sideways overflow and console errors. For `tel:`, `mailto:` and external links,
   confirm the address is right instead of following them. Links hidden on purpose at phone
   width are fine. In right-to-left languages, check that times, ranges, prices and phone
   numbers read in the right order.
3. Fix what you found and check again.
4. Take a screenshot of each width. If you can record a short GIF or video of the page in use,
   do it and give the user the file, so they can watch the result instead of reading code.
5. Suggest up to three concrete improvements to the chosen version: for each, what to change
   and why, tied to the page's single job from step 1 (not to taste). Ask whether to apply
   them, and apply only the ones the user approves.

Report exactly what you checked and what you fixed. If no browser tool is available (for
example in a chat app), say that the browser check was not run, suggest the user open the
page on their phone, and still offer the up to three improvements. Never claim a check you did
not do.

## Output checklist

- [ ] Assumptions stated in two lines (or one question, only if the subject was unclear)
- [ ] Five versions that pass the difference contract
- [ ] Real content in all five
- [ ] Gallery file or five-tab artifact
- [ ] Your pick, three reasons, one thing borrowed from the runner-up
- [ ] The user's decision applied to the chosen version only
- [ ] Browser check done and reported, or clearly marked as not run
- [ ] Up to three improvements suggested, tied to the single job, applied only if approved
