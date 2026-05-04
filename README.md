# Lab Editor

Browser-based 3D editor for placing walls, doors, and box objects inside a glTF lab scene. Notes can be attached to any placed object as billboard labels in 3D space.

## Run locally

### Static-only (single-user, browser-local)

```sh
python3 -m http.server 8124
```

Open http://localhost:8124. The badge in the lower-right of the viewport will read **`local only`** — layouts save to your browser's `localStorage`, so only you see them.

### Shared (multi-user, server-side persistence)

```sh
python3 server.py
```

Open http://localhost:8124. The badge will switch to **`shared layout`**. Layouts now save to `layout.json` on disk via `PUT /api/layout`; anyone who loads the page sees the same scene. Edits made by other users show up the next time you reload the page (no live sync).

`server.py` accepts environment variables:

- `PORT` — listen port (default `8124`)
- `HOST` — bind address (default `0.0.0.0`)
- `LAYOUT_FILE` — where to persist the layout JSON (default `./layout.json`)

## Deployment

The frontend probes `./api/layout` on load. If it gets a real response (200 or 404), it switches to shared mode. If the probe fails (network error, CORS, no endpoint), it falls back to localStorage automatically. **Static-only deploys keep working** — they just won't share state.

### Static hosts (GitHub Pages, Netlify, Vercel static, S3 + CloudFront)

Drop the files in. You'll get the localStorage flavor by default. Each visitor sees their own layout.

### Stateful hosts (any VPS, fly.io, Railway, Render, a Pi on the local network)

Run `python3 server.py`. The script is plain stdlib — no `pip install` needed. The persistence file path needs to be on a **persistent volume**: stateless container platforms (Cloudflare Workers, Vercel serverless functions) won't keep `layout.json` between requests, so layouts will appear to vanish.

If you put the editor behind a different path (`https://demo.example.com/lab/`), make sure `./api/layout` resolves to the same server — the frontend uses a relative URL.

### Adding persistence to a host that already has a backend

If your demo page is served from a different stack (Express, Django, Rails, etc.), you don't need `server.py`. Just make sure these two routes exist next to your static files:

- `GET /api/layout` — return the current layout JSON, or 404 if there's no save yet
- `PUT /api/layout` — overwrite the layout from the request body (validate it's JSON; persist however you like — file, sqlite, blob storage, whatever)

The frontend doesn't care what's on the server side as long as the contract is held.

## Conflict model

Last-write-wins. No locking, no merging, no per-object versioning. If Theresa and Ron edit at the same time, whichever browser fires the `PUT` last wins. Fine for small teams that aren't co-editing simultaneously; not fine for a real CMS.

## Files

- `index.html`, `main.js` — frontend (no build step, three.js via CDN import map)
- `54lab.glb` — base scene; replace this file in place to swap models
- `server.py` — optional Python static + persistence server (stdlib only)
- `layout.json` — created on first save in shared mode (gitignored)
