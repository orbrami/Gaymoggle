# 🏳️‍🌈 GAYMOGGLE — Who's Gayer?

> Random 1v1 video chat. The gayer one wins.

---

## Architecture

```
[User A Browser]  ──────────────────────────────  [User B Browser]
       │                                                   │
       │  socket.io (match me)          socket.io (match me)│
       ▼                                                   ▼
  [Render — server.js]  ←── Socket.io ──►  [Render — server.js]
       │  "Here's B's socket"  "Here's A's socket"         │
       │                                                   │
       └──────────  WebRTC P2P video/audio  ───────────────┘
                    (bypasses server 100%)
```

- **Frontend** → Vercel (free, static)
- **Backend**  → Render (free, Node.js, always-on)
- **Video**    → WebRTC peer-to-peer (never touches server)

---

## STEP 1 — Push to GitHub

Create ONE repo. Push everything:

```
gaymoggle/
├── frontend/    ← deploy this to Vercel
└── backend/     ← deploy this to Render
```

```bash
git init
git add .
git commit -m "🌈 Gaymoggle"
git remote add origin https://github.com/YOUR_USERNAME/gaymoggle.git
git push -u origin main
```

---

## STEP 2 — Deploy Backend to Render

1. Go to **[render.com](https://render.com)** → Sign up (free)
2. Click **New +** → **Web Service**
3. Connect GitHub → select the `gaymoggle` repo
4. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. Click **Create Web Service**
6. Wait ~2 minutes. Render gives you a URL like:
   `https://gaymoggle-backend.onrender.com`
7. **Copy that URL** — you need it for the next step.

---

## STEP 3 — Set the Backend URL in Frontend

Open `frontend/js/config.js` and replace the placeholder:

```js
// BEFORE:
const BACKEND_URL = "https://YOUR-BACKEND.onrender.com";

// AFTER (your actual Render URL):
const BACKEND_URL = "https://gaymoggle-backend.onrender.com";
```

Commit and push:

```bash
git add frontend/js/config.js
git commit -m "Set backend URL"
git push
```

---

## STEP 4 — Deploy Frontend to Vercel

1. Go to **[vercel.com](https://vercel.com)** → Sign up (free)
2. Click **Add New → Project**
3. Import your GitHub repo (`gaymoggle`)
4. Settings:
   - **Root Directory:** `frontend`
   - Framework: **Other**
   - Build: leave empty (static site)
5. Click **Deploy**
6. Vercel gives you: `https://gaymoggle.vercel.app` (or similar)

---

## STEP 5 — Set CORS on Render

1. Go to your Render dashboard → your backend service
2. **Environment** tab → Add variable:
   - Key: `FRONTEND_URL`
   - Value: `https://gaymoggle.vercel.app` (your actual Vercel URL)
3. Click **Save** — Render redeploys automatically

---

## You're live. Test it:

1. Open your Vercel URL in **two different browsers** (or one normal + one incognito)
2. Click **Start Chat** on both
3. Both should connect within 3–5 seconds
4. Video should stream peer-to-peer

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Cannot reach server" on chat page | Wrong `BACKEND_URL` in `config.js` |
| Stuck on "Waiting for match" alone | Need 2 people online simultaneously |
| Video connects but no sound | Allow microphone in browser permissions |
| Video lags/freezes | Expected on free Render/TURN servers. Fine for demo. |
| CORS error in console | `FRONTEND_URL` env var not set on Render |
| Render sleeps after 15min (free plan) | First connection after sleep takes ~30s. Upgrade to $7/mo to avoid. |

---

## Free Tier Limits

| Service | Free Limit | Notes |
|---|---|---|
| Vercel | 100GB bandwidth/month | More than enough |
| Render | 750 hours/month, sleeps after 15min idle | Enough for hobby project |
| Video bandwidth | $0 | P2P — your server pays nothing |

---

*Original idea by **Or Brami** 🌈*
