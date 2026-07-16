# Project Handoff — Louis's UGC Hair Portfolio + Chat

Read this first when resuming on a new machine / new Claude session. It captures
the current state so you don't have to reconstruct the history.

## What this project is
A cozy, light-blue "anime-home" themed website for **Louis**, a Roblox UGC hair
creator and verified seller in the Icyella Discord (20k+ members). Plain static
HTML/CSS/JS (no build step), hosted on **Netlify**, repo
`louischoiart-maker/louis-portfolio`. A **Supabase** backend powers accounts,
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
- **GitHub**: `louischoiart-maker/louis-portfolio` (main branch).
- **Netlify**: auto-deploys from GitHub main.
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

## Resuming on the new machine
1. Install Claude Code, sign in with the new account.
2. Clone the repo: `git clone https://github.com/louischoiart-maker/louis-portfolio.git`
3. Open the folder in Claude and say: "Read HANDOFF.md and continue." 
4. To preview locally: `npx serve` in the project folder (or the app's preview).
