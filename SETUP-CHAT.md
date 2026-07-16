# Setup Guide — Accounts & Chat (Supabase)

Your site now has a **login + chat system**: customers make an account, message
you privately (separate from your Discord friends), and you get an owner
dashboard with conversations, pin, ban, order cards, and a to-do list.

To make it work you connect a free **Supabase** project (the database + login
service). This is a one-time setup, ~15 minutes, no coding.

---

## 1. Create a free Supabase project

1. Go to https://supabase.com and sign up (you can "Continue with GitHub").
2. Click **New project**. Give it a name (e.g. `louis-chat`), set a database
   password (save it somewhere), pick the region closest to you, and create it.
3. Wait ~2 minutes for it to finish setting up.

---

## 2. Create the database tables

1. In your Supabase project, open **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open the file **`supabase/schema.sql`** from this project, copy **everything**,
   paste it into the editor, and click **Run**.
4. You should see "Success. No rows returned." That built all your tables,
   security rules, and the avatars storage — done.

---

## 3. Turn on email verification (recommended)

This stops people signing up with someone else's email.

1. Go to **Authentication → Sign In / Providers → Email** (or **Authentication →
   Providers**).
2. Make sure **Confirm email** is **ON**.
3. Go to **Authentication → URL Configuration** and set:
   - **Site URL** = your live website, e.g. `https://your-site.netlify.app`
   - Under **Redirect URLs**, add `https://your-site.netlify.app/account.html`

   (This makes the verification link in the email send people back to your site.)

> Note: Supabase's built-in email sender is limited to a few messages per hour —
> fine to start. If you ever get lots of signups, see **Appendix** below to plug
> in a free email service.

---

## 4. Connect your site to Supabase

1. In Supabase, go to **Project Settings → API**.
2. Copy two things:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon public** key (a long string — the "anon" one, NOT the "service_role").
3. Open **`js/supabase-client.js`** in this project and paste them in:

   ```js
   const SUPABASE_URL = 'https://abcdxyz.supabase.co';
   const SUPABASE_ANON_KEY = 'paste-the-long-anon-key-here';
   ```

   The anon key is safe to put in your website — that's what it's designed for.
   Your data is protected by the security rules from step 2, not by hiding the key.

4. Save, then push to GitHub (GitHub Desktop → Commit → Push). Netlify
   redeploys automatically in ~30 seconds.

---

## 5. Make yourself the owner

1. Go to your live site's **/account.html** and **create an account** with your
   own email. Check your inbox and click the verification link.
2. Back in Supabase, open **SQL Editor → New query**, paste this (using the same
   email you signed up with), and Run:

   ```sql
   update public.profiles set role = 'owner'
   where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
   ```

3. Now when **you** log in and open the chat, you'll see the **owner dashboard**.
   Everyone else sees the simple customer chat.

---

## 6. Test it

1. In a different browser (or a private/incognito window), sign up as a fake
   "customer", verify the email, and send you a message.
2. In your normal browser (logged in as owner), open **Chat** — you'll see the
   conversation. Try:
   - **Reply** to them.
   - **Pin** the conversation (jumps to the top).
   - **+ Add** an order card ("3 hairs", priority "paid extra", status
     "in progress") — the customer sees this status on their side.
   - **Ban** the test account — now their messages get rejected.
   - Add a couple of **to-dos**.

That's everything working.

---

## How the pieces fit together

- **account.html** — sign up / sign in / edit profile picture + name.
- **chat.html** — customer chat, or your owner dashboard (it detects your role).
- Floating **"Chat with me"** button is on your home and portfolio pages.
- **You never share this with Discord** — it's your own private commission inbox.

---

## Appendix — sending more emails (optional, later)

If Supabase's built-in email limit becomes a problem:
1. Make a free account at https://resend.com and verify a sending domain (or use
   their test domain to start).
2. In Supabase: **Project Settings → Authentication → SMTP Settings**, enter
   Resend's SMTP host, port, username, and password. Save.

Now verification/reset emails go through Resend with much higher limits.
