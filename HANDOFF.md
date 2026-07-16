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
1. **"Customer (sister) saw the owner Conversations dashboard."** Not yet resolved.
   Two likely causes — check in this order:
   a. **Same-browser session:** if the test was done in the same browser Louis was
      logged into, it was still *his* (owner) session — not actually the sister's.
      Fix: have the sister sign in on her OWN device/browser (or use a private
      window after Louis signs out).
   b. **Her profile role is 'owner':** check Supabase → Table editor → `profiles`
      → her row. If `role = 'owner'`, run:
      `update public.profiles set role='customer' where id='<her-id>';`
   Note: even in case (a)/(b), RLS still prevents a real customer from reading
   other people's data — the concern is only which *UI* renders.
2. **Confirm the latest `schema.sql` has been fully re-run** in Supabase, so the
   image-upload column (`messages.image_url`), `chat-images` bucket, `settings`
   table, and auto-reply trigger all exist.
3. **Finish the end-to-end test** (see the test script: sister sends "Hi!" →
   auto-reply fires → images both ways → owner reply/pin/order/ban).

## Resuming on the new machine
1. Install Claude Code, sign in with the new account.
2. Clone the repo: `git clone https://github.com/louischoiart-maker/louis-portfolio.git`
3. Open the folder in Claude and say: "Read HANDOFF.md and continue." 
4. To preview locally: `npx serve` in the project folder (or the app's preview).
