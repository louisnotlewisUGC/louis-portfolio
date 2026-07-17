# Project Handoff — Louis's UGC Hair Portfolio + Chat

Read this first when resuming on a new machine / new Claude session. It captures
the current state so you don't have to reconstruct the history.

## What this project is
A cozy, light-blue "anime-home" themed website for **Louis**, a Roblox UGC hair
creator and verified seller in the Icyella Discord (20k+ members). Plain static
HTML/CSS/JS (no build step), hosted on **Netlify**, repo
`louisnotlewisUGC/louis-portfolio`. A **Supabase** backend powers accounts,
chat, orders, and the owner dashboard.

## Pages & files
- `index.html` — landing: hero intro, achievements (SVG icons), pricing (3 tiers,
  Robux + USD), contact (Discord/Roblox/commission-server buttons), floating
  "Chat with me" button, nav auth chip.
- `portfolio.html` — gallery rendered from `data/portfolio.json` (managed via the
  `/admin` CMS), lightbox.
- `account.html` + `js/account.js` — sign up (email verification ON), sign in,
  forgot password, profile editor (username + avatar upload).
- `chat.html` + `js/chat.js` — role-adaptive:
  - Customer: single chat window with Louis + read-only order status cards.
  - Owner: conversations sidebar, pin, ban, order cards, to-do list,
    auto-welcome reply editor. Image upload on both sides.
- `js/supabase-client.js` — Supabase URL + anon key (anon key is public-safe).
- `admin/` — Sveltia CMS for editing the portfolio (see `SETUP.md`).
- `supabase/schema.sql` — full database schema (tables, RLS, triggers, storage,
  auto-reply). **Idempotent — safe to re-run.**
- Setup guides: `SETUP.md` (GitHub + Netlify + CMS), `SETUP-CHAT.md` (Supabase).

## Deployed services
- **GitHub**: `louisnotlewisUGC/louis-portfolio` (main branch).
- **Hosting: migrating Netlify → GitHub Pages (2026-07-17).** Netlify's team ran
  out of build credits mid-cycle and deploys stayed disabled even after refresh,
  so the user chose GitHub Pages (free, no build credits). New URL:
  `https://louisnotlewisUGC.github.io/louis-portfolio/`. Redirect URLs in
  `js/account.js` are now sub-path-safe (SITE_BASE). Remaining user steps:
  make repo public, enable Pages (main / root), update Supabase Auth URLs,
  stop Netlify builds. The `/admin` Sveltia CMS relied on Netlify OAuth and
  will NOT work on Pages — edit `data/portfolio.json` directly instead.
- **Supabase**: project ref `jbpvmrshmjxatuzgkqyp`
  (URL `https://jbpvmrshmjxatuzgkqyp.supabase.co`). Auth has email confirmation
  ON. Louis's own account is set to `role = 'owner'` in the `profiles` table.

## How the security works (important)
Access is enforced by **Row Level Security** in Supabase, not client JS. Customers
can only read their **own** conversation/messages; only the owner (`is_owner()`)
sees all conversations and can pin/ban/manage orders. The owner-vs-customer UI is
chosen in `js/chat.js` `boot()` via `me.role`.

## OPEN ITEMS / things to verify next
1. **"Customer (sister) saw the owner Conversations dashboard."** Confirmed via a
   screenshot she IS seeing the owner dashboard. Since the code always defaults new
   accounts to `role='customer'` and a DB trigger blocks self-promotion, this means
   **her `profiles.role` is set to `'owner'`** (either she was tested in Louis's own
   logged-in browser session, or her row was manually set to owner). Fix — run in
   Supabase SQL editor (replace with her sign-up email):
   ```sql
   update public.profiles set role='customer'
   where id = (select id from auth.users where email = 'HER-EMAIL');
   ```
   Then have her hard-refresh / sign out and back in. (RLS still prevents a real
   customer from *reading* other people's data regardless; role only picks the UI.)
2. ✅ **Schema verified applied.** Ran `supabase/verify-schema.sql` — image_url
   column, chat-images bucket, settings table, auto_reply_trg trigger, and an owner
   profile all exist. Auto-reply confirmed firing.
3. **Finish the end-to-end test** (sister sends "Hi!" → auto-reply fires [done] →
   images both ways → owner reply/pin/order/ban).

## NEW: Vouches wall (added 2026-07-16)
A public reviews wall where signed-in customers leave a 1–5 star rating + comment.
- Files: `vouches.html`, `js/vouches.js`, styles in `css/style.css`, nav links added
  to `index.html` and `portfolio.html`. Table + RLS appended to `supabase/schema.sql`.
- Public read (even signed-out visitors see it); one vouch per person, editable;
  owner can delete any (moderation); banned users can't post. Author name/avatar are
  snapshotted onto the row so the public wall needs no access to `profiles`.
- **ACTION REQUIRED:** re-run `supabase/schema.sql` in Supabase to create the
  `vouches` table — until then the wall shows "Couldn't load vouches". (schema.sql
  is idempotent, safe to re-run.)

## NEW: Chat file uploads (30 MB) + custom emojis (added 2026-07-16)
- **Any-file upload up to 30 MB** in chat. Images still preview inline; other files
  (.rbxm, .zip, .pdf, docs, etc.) show as a download-link chip with the filename.
  New `messages.file_url` + `messages.file_name` columns; new public `chat-files`
  storage bucket (30 MB per-file limit; `chat-images` bumped to 30 MB too).
- **Custom image emojis (Discord-style).** Owner uploads little images with a
  `:name:` shortcode in the chat dashboard ("Custom emojis" panel). Anyone signed in
  can insert them via the 😊 picker button in the composer; `:name:` renders inline
  as the image. New `emojis` table (owner-only write, everyone reads) + public
  `chat-emojis` bucket (owner-only upload, 1 MB cap).
- Files touched: `js/chat.js`, `chat.html`, `css/style.css`, `supabase/schema.sql`.
- **ACTION REQUIRED:** re-run `supabase/schema.sql` so the new columns, buckets, and
  `emojis` table exist. Also check **Supabase → Settings → Storage → "Upload file
  size limit"** is ≥ 30 MB (free-tier default is 50 MB, so usually fine).
- **Emoji seed:** `supabase/seed-emojis.sql` populates the picker with ~50 classic
  Twitter/Twemoji emojis (Discord-style, served from jsDelivr CDN — no storage used).
  Run it in the SQL editor; idempotent.

## NEW: Edit / delete / pin messages + owner message history (added 2026-07-16)
- **Edit** your own text messages (inline editor; shows "(edited)").
- **Delete** — soft delete. Each person deletes their own; the **owner can delete
  anyone's**. Deleted messages vanish from chat but are kept in an owner-only
  **"Message history"** panel section (with who deleted + when) and can be **Restored**.
- **Pin** — either participant can pin/unpin a message. Pinned messages get a peach
  highlight, a "📌 pinned" tag, and appear in a "📌 Pinned" strip at the top of the
  chat (click a pinned item to jump to it).
- Actions appear as a small hover toolbar on each message bubble.
- Realtime switched from INSERT-only to `event:'*'` with a full re-render, so edits/
  deletes/pins now sync live between customer and owner.
- Schema: new `messages` columns `edited_at`, `deleted_at`, `deleted_by`, `pinned`;
  `messages_select` updated to hide soft-deleted from customers; new `messages_update`
  RLS policy + `guard_message_update` trigger enforcing per-person rules.
- **Layout fix:** the owner 3-column view squished the chat + clipped the Send button
  at medium widths. Now the Orders panel drops to full width below the chat ≤1080px,
  everything stacks ≤760px, and the composer is shrink-safe.
- Files: `js/chat.js`, `chat.html`, `css/style.css`, `supabase/schema.sql`.
- **ACTION REQUIRED:** re-run `supabase/schema.sql` so the new message columns,
  updated policies, and guard trigger exist.

## NEW: todo title+desc, multi-pic, reactions, profile settings (added 2026-07-16)
- **To-do items** now have a title + optional description (`todos.description`).
- **Multiple pics/files** in one send (file input is `multiple`); each uploads
  separately showing a **"Uploading…" placeholder** bubble until it lands.
- **Message reactions**: hover a message → ☺ opens a picker (8 common emojis +
  your custom emojis); reaction chips show counts under the message, click to
  toggle. New `message_reactions` table + RLS; realtime subscription added.
- **Profile → Advanced settings** (`account.html`): public bio (`profiles.description`),
  read-only account info (email / member since / type), change-password (Supabase
  `auth.updateUser`), and an **Ads** placeholder ("coming soon" — to build later).
- Files: `js/chat.js`, `js/account.js`, `chat.html`, `account.html`, `css/style.css`,
  `supabase/schema.sql`.
- **ACTION REQUIRED:** re-run `supabase/schema.sql` for the new columns
  (`todos.description`, `profiles.description`) and the `message_reactions` table.
- NOTE: verified the pages parse with no console errors, but the deep visual test
  (reactions/upload/profile) was blocked by a transient tool outage — worth a live
  once-over after the schema runs.

## NEW: polish batch (added 2026-07-16, second pass)
- **Scroll fix:** re-renders (reacting, editing, pinning, emoji insert) no longer
  yank the chat to the bottom — scroll position is preserved unless you were
  already at the bottom. Emoji insert uses `focus({preventScroll})`.
- **Text + image together:** whatever is typed in the composer when you attach
  files goes out as the caption in the same message.
- **Grouped images (WhatsApp style):** multiple pics picked together are ONE
  bubble via new `messages.image_urls text[]`; caption renders under the grid.
  Legacy single `image_url` messages still render.
- **Profile cards:** click a name in chat (or the customer header) → Discord-style
  card with **banner** (`profiles.banner_url`), avatar, role, **description**.
  Banner upload added to account page (avatars bucket, `<id>/banner.ext`).
- **Discord-style icons:** hover toolbar now uses clean SVG icons (smiley-plus
  react, pin, pencil, trash) instead of emoji glyphs.
- **DM search:** search box above the owner conversations list, filters by name.
- **Custom emoji hide/unhide:** Hide/Show button collapses the emoji manager
  (persists via localStorage).
- **Advanced-settings resilience:** if `profiles.description`/`banner_url` don't
  exist yet, saving still saves the name and tells you to run schema.sql (the
  "doesn't work for others" bug was the un-run schema).
- **Mini chat bar: ABANDONED** per the user — do not build it.
- **ACTION REQUIRED:** re-run `supabase/schema.sql` (adds `profiles.banner_url`,
  `messages.image_urls`, updated messages content constraint + guard trigger).

## NEW: staging + toggles batch (added 2026-07-16, third pass)
- **Discord-style attachment staging:** picking files no longer sends instantly.
  They wait as thumbnails/chips in a strip above the composer (✕ to remove) and
  go out together with the text when Send/Enter is pressed.
- **Hide/Show toggles** for Message history and To-do list sections (persisted
  in localStorage, same as the emoji one).
- **To-do pinning:** `todos.pinned` column; pin button on each row, pinned tasks
  float to the top with a cream highlight.
- **Owner pfp fix:** the customer chat header was hardcoded to avatar.svg — now
  it loads the owner's real profile (avatar + name) and opens his profile card.
- **Self-diagnosis:** account page shows a clear message when the DB is missing
  the description/banner columns; todo add + grouped images fall back gracefully
  when their columns are missing.
- WHY things "didn't work" on the live site: the last several commits were never
  pushed, and schema.sql wasn't re-run. Both are needed: push latest main AND
  run schema.sql in the Supabase SQL editor.
- **schema.sql re-run bug FIXED:** the file used to redefine
  `messages_content_check` three times; the oldest version failed validating
  existing file-attachment rows (error 23514) and rolled back the entire run.
  The rule now lives ONCE at the end of the file. User confirmed the run works.

## NEW: edit history + multiline composer (added 2026-07-17)
- **Edit history:** `messages.original_content` snapshots the wording on the
  FIRST edit (set by the guard trigger; tamper-proof from the app). The owner
  Message history section is split in half: **Deleted** (restorable) | **Edited**
  (Before/Now labels).
- **Multi-line composer:** both chat inputs are now auto-growing textareas —
  Enter sends, Shift+Enter makes a new line.
- **ACTION REQUIRED:** re-run `supabase/schema.sql` once more (adds
  `original_content` + updated guard trigger). Safe now — see fix above.
- IMPORTANT: NEVER `git push` — the user always pushes themselves.

## Resuming on the new machine
1. Install Claude Code, sign in with the new account.
2. Clone the repo: `git clone https://github.com/louisnotlewisUGC/louis-portfolio.git`
3. Open the folder in Claude and say: "Read HANDOFF.md and continue." 
4. To preview locally: `npx serve` in the project folder (or the app's preview).
