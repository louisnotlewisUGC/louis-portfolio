# Setup Guide — Louis's Portfolio + Owner Upload

Your site is a **static website** (plain HTML/CSS/JS). It runs anywhere, but the
**owner login + upload** feature only works once the site lives in a **GitHub
repo** and is **deployed** (Netlify is the easiest). This is a one-time setup.

---

## 1. Edit your real content first (optional but recommended)

Look for `PLACEHOLDER` comments in `index.html` and swap in:
- Your bio, achievement numbers, and the three tier **prices** (Robux + USD).
- Real images: replace files in `assets/` (e.g. `avatar.svg`, `tier-*.svg`).
- Your **Discord** and **Roblox** links in the Contact section.

The portfolio gallery pieces live in `data/portfolio.json` — but once the CMS is
set up you'll edit those through the nice `/admin` interface instead of by hand.

---

## 2. Put the site on GitHub

1. Create a free account at https://github.com if you don't have one.
2. Install GitHub Desktop (https://desktop.github.com) — easiest for non-coders.
3. In GitHub Desktop: **File → Add local repository** → choose the
   `louis-portfolio` folder → **create a repository** → **Publish** it.
   - Make it **public** (or private — both work with Netlify).
   - Note your repo name, e.g. `louisgamer/louis-portfolio`.

---

## 3. Point the CMS at your repo

Open `admin/config.yml` and change this line to your real repo:

```yaml
  repo: YOUR-GITHUB-USERNAME/louis-portfolio   # e.g. louisgamer/louis-portfolio
```

Commit + push that change (GitHub Desktop → Commit → Push).

---

## 4. Deploy on Netlify (free)

1. Sign up at https://netlify.com using **"Log in with GitHub"**.
2. **Add new site → Import an existing project → GitHub →** pick your repo.
3. Build settings: leave **Build command empty**, set **Publish directory** to
   `.` (the repo root). Click **Deploy**.
4. Netlify gives you a live URL like `https://louis-hair.netlify.app`
   (you can rename it in Site settings, or add a custom domain later).

---

## 5. Turn on login for /admin

The CMS logs in with your **GitHub** account. Pick ONE method:

**Option A — Netlify's built-in GitHub auth (simplest):**
1. In Netlify: **Site configuration → Access & identity / OAuth** (or
   **Site settings → Identity**), and enable the **GitHub** provider.
2. Follow Netlify's prompt to authorize — it wires up the login for you.

**Option B — Your own GitHub OAuth app (if you prefer):**
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL = your Netlify URL. Authorization callback URL =
   `https://api.netlify.com/auth/done`.
3. Copy the **Client ID + Secret** into Netlify's OAuth provider settings.

Then visit `https://your-site.netlify.app/admin/`, click **Login with GitHub**,
and you're in.

---

## 6. Using it day-to-day

- Go to **your-site/admin**, log in with GitHub.
- Open **Portfolio → Gallery pieces**. Click **Add Piece**, upload an image,
  type the hair name / detail level / year, and **Publish**.
- Netlify rebuilds the site automatically in ~30 seconds. Your new hair appears
  on the portfolio page.

No one else can upload — only accounts you allow into the GitHub repo. The login
is real (handled by GitHub), not a password hidden in the page.

---

## Notes

- **Local preview** (no upload): run `npx serve` in this folder and open the
  printed URL. The `/admin` page will show the login screen, but logging in only
  works on the deployed Netlify site (GitHub OAuth needs a real https URL).
- To switch the CMS engine from Sveltia to Decap, see the comment in
  `admin/index.html`. They share the same `config.yml`.
