# 80-in-8

Optiver-format mental-arithmetic trainer. 80 multiple-choice questions, 8:00 on the
clock, negative marking, sequential (no skip / no back). Tracks score trend and
per-type accuracy across sessions in the browser via `localStorage`.

Stack: React 18 + Vite. Chart: Recharts. No backend — history lives in your browser.

---

## Run it locally

Needs Node 18+ (`node -v` to check).

```bash
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173).

To check the production build before deploying:

```bash
npm run build
npm run preview
```

---

## Put it on GitHub

```bash
git init
git add .
git commit -m "80-in-8 arithmetic trainer"
git branch -M main
git remote add origin https://github.com/<your-username>/80-in-8.git
git push -u origin main
```

Create the empty `80-in-8` repo on github.com first (no README/gitignore — this
project already has them), then run the above.

`node_modules` and `dist` are gitignored, so you're only pushing source.

---

## Deploy to Vercel

1. Go to vercel.com, sign in with GitHub.
2. **Add New → Project**, import the `80-in-8` repo.
3. Vercel auto-detects Vite. Leave the defaults:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. **Deploy.** You get a live `*.vercel.app` URL in ~30 seconds.

Every `git push` to `main` redeploys automatically.

### Custom subdomain (e.g. 80in8.aarinbhatt.com)

Only do this if aarinbhatt.com's DNS is reachable from Vercel.

1. In the Vercel project: **Settings → Domains → Add**, enter `80in8.aarinbhatt.com`.
2. Vercel shows a CNAME record. Add it at whoever hosts your DNS for aarinbhatt.com
   (a `CNAME` from `80in8` → `cname.vercel-dns.com`).
3. Wait for it to verify (minutes to an hour).

---

## Notes

- Scoring: +1 correct, −1 wrong, 0 for questions not reached. This is the dominant
  reported Optiver rule; −2/wrong is disputed in sources.
- The tiers (<55 / 55–69 / 70–76 / 77–80) are community-reported, not official, and
  are **not** a percentile. Optiver has never published score distributions.
- All state is client-side. Clearing browser data wipes your history. There's a
  "reset history" button on the dashboard if you want to start fresh.
- To edit the question mix, see the `GENS` array near the top of `src/App.jsx`.
