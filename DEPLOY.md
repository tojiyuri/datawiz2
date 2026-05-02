# Deployment guide

This walks you from "code on my laptop" to "URL I can share with anyone."

Total time: 30-60 minutes of mostly waiting for builds. About 10-15 minutes
of actual clicking.

## What you'll have at the end

- Frontend at `https://datawiz-yourname.vercel.app`
- Backend at `https://datawiz-yourname.onrender.com`
- Auto-deploy: every `git push` to `main` redeploys both
- Cost: $0/month
- Cold start: ~30-50s on first request after 15min of idle (free tier
  limitation; pay $7/mo on Render to remove)

## Prerequisites

- GitHub account
- Vercel account (sign up with GitHub at https://vercel.com — takes 30 seconds, no card)
- Render account (sign up with GitHub at https://render.com — takes 30 seconds, no card)

## Step 1 — Push the code to GitHub

If you haven't already created the repo:

```bash
cd ~/Desktop/autowiz/datawiz   # or wherever your code is
git init
git add .
git commit -m "Data Wiz v6.20"
```

Create an empty repo on GitHub (call it `datawiz` or whatever you want),
then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/datawiz.git
git branch -M main
git push -u origin main
```

If you already have a repo, just push the latest changes:

```bash
git add .
git commit -m "Add deployment config"
git push
```

**Verify before continuing:** open the GitHub repo in your browser. You
should see `render.yaml`, `vercel.json`, and the `.env.example` file at the
top level. If you see a `.env` file, **stop** — that has your secrets.
Delete it and force-push.

## Step 2 — Deploy the backend to Render

1. Go to https://dashboard.render.com/
2. Click **New** (top right) → **Blueprint**
3. Click **Connect GitHub** if you haven't yet, and authorize Render to read your repos
4. Find your `datawiz` repo and click **Connect**
5. Render reads `render.yaml` and shows you a preview of what it'll create
6. Click **Apply**

Render now starts building. The first build takes 4-6 minutes because
`better-sqlite3` is a native module that compiles from source. Watch the
log — if it succeeds, you'll see:

```
🧙 Data Wiz v6.20 → http://localhost:8000
   Wiz mascot polish · saccades · gaze tracking · breathing
```

Once it's live, **copy the backend URL** from the top of the dashboard. It
looks like `https://datawiz-api-abcd.onrender.com`. You'll need this for
the frontend.

**Quick sanity test** — open `https://datawiz-api-abcd.onrender.com/api/health`
in your browser. You should see `{"ok":true,...}`. If you get an error,
check the Render logs.

## Step 3 — Deploy the frontend to Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository**
3. Authorize Vercel for your GitHub if needed
4. Find your `datawiz` repo and click **Import**

Vercel auto-detects the framework (Vite). Two settings to set before clicking Deploy:

5. **Root Directory** — click "Edit" and set this to `client`
6. **Environment Variables** — add one:
   - Name: `VITE_API_URL`
   - Value: `https://datawiz-api-abcd.onrender.com/api`  (your Render URL + `/api`)
7. Click **Deploy**

First build takes 1-2 minutes. When it's done, Vercel shows you the URL —
copy it.

## Step 4 — Tell the backend about the frontend (one last config)

The backend needs to know your Vercel URL is allowed to talk to it.

1. Go back to the Render dashboard, open your `datawiz-api` service
2. Click **Environment** in the left sidebar
3. Find `CLIENT_URL` (it should already be in the list, marked "sync: false")
4. Click the pencil icon to edit
5. Set the value to your Vercel URL — e.g., `https://datawiz-yourname.vercel.app`
   - **Tip:** Vercel also creates per-branch preview URLs like
     `datawiz-yourname-git-main.vercel.app`. To allow those too, add them
     comma-separated:
     ```
     https://datawiz-yourname.vercel.app,https://datawiz-yourname-git-main-yourname.vercel.app
     ```
6. Click **Save Changes**. Render redeploys (1-2 minutes).

## Step 5 — Test the deployed app

1. Open your Vercel URL
2. You'll see the welcome modal — click "Try with sample data"
3. The first request might take 30-50 seconds (the Render free tier waking up)
4. After that, everything should work normally

If it doesn't work, check these in order:

- **CORS error in browser console** → backend's `CLIENT_URL` doesn't match
  your Vercel URL exactly. Look at the error, copy the origin it complains
  about, paste it into `CLIENT_URL` on Render.
- **Network errors** → backend isn't running. Check Render logs.
- **"Failed to fetch"** → `VITE_API_URL` on Vercel is wrong or missing the
  `/api` suffix. Edit it, then in Vercel's deployment list click the "..."
  menu on the latest deployment and "Redeploy."
- **Login works but next request 401s** → cookie problem. Check the
  browser's dev tools → Application → Cookies. The auth cookies should be
  present and have `SameSite: None`. If they're missing, your backend
  isn't running in `NODE_ENV=production`. Verify on Render's Environment
  page.

## Step 6 (optional) — Wire up email and LLM

Both are skippable. The app works without them.

### LLM features (Wiz chat, smart insights)

1. Get an Anthropic API key from https://console.anthropic.com/settings/keys
2. On Render → datawiz-api → Environment → add:
   - `ANTHROPIC_API_KEY` = `sk-ant-...`

Render redeploys automatically. Wiz's AI features now actually use Claude.

### Email (auth verification + scheduled reports)

The simplest free option is Gmail with an app password:

1. Enable 2-Step Verification on your Google account (required to create app passwords)
2. Go to https://myaccount.google.com/apppasswords
3. Create one called "Data Wiz"
4. Copy the 16-char string (it shows once)
5. On Render → Environment → add:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = `youremail@gmail.com`
   - `SMTP_PASS` = the 16-char app password
   - `SMTP_FROM` = `Data Wiz <youremail@gmail.com>`

After redeploy, signup confirmation emails and scheduled reports will
actually send.

## Step 7 — Share it

Send this to someone:

> Hey — built a data analysis tool, would love your honest reaction.
> Takes 30 seconds: click here, then click "Try with sample data."
> https://datawiz-yourname.vercel.app

Don't write a longer message. Don't explain what it does first. Let them
click and see.

## Maintenance

- **Every push to `main` redeploys.** Both Vercel and Render. No CI to set up.
- **Logs are in each provider's dashboard.** Render keeps 7 days. Vercel keeps the last 100 deployments.
- **Disk usage** — check Render → Disks. The free 1GB is plenty until you have hundreds of users.
- **Cold starts** — if a real user hates the wake-up time, upgrade Render to Starter ($7/mo). Vercel's free tier has no cold start.

## Common issues

**"My SQLite data disappeared after a redeploy."**
The `DATA_DIR=/var/data` env var is missing or the disk isn't mounted.
Check render.yaml is in the repo and Render → Disks shows the mount.

**"Render keeps showing the build is failing on better-sqlite3."**
The `engines.node` field in package.json should specify `>=20.0.0`. Older
Node versions can't compile better-sqlite3 v11. If it's already 20+,
delete the Render service and re-create from the blueprint.

**"Vercel build fails with 'Cannot find module react'."**
The Root Directory isn't set to `client`. Vercel → Project Settings →
General → Root Directory → set to `client`.

**"My Vercel preview URLs (different from prod) get CORS errors."**
Add them to `CLIENT_URL` on Render, comma-separated. Or use a wildcard
domain — but wildcard CORS with credentials requires more careful handling
than this guide covers.

That's it. The whole thing.
