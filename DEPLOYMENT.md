# MediaPull Deployment

## Vercel

Deploy the frontend to Vercel as a Vite static site.

Set this Vercel environment variable:

```text
VITE_API_BASE_URL=https://your-downloader-api-domain.com
```

Do not run the downloader backend on Vercel Functions. The backend uses `yt-dlp`, `ffmpeg`, Python/`instaloader`, temporary files, child processes, and large media responses. Vercel Functions have duration limits and a 4.5 MB request/response payload limit, so large video downloads will fail there.

## Downloader API Host

Run this same project on a server that supports long-running Node processes and system binaries, such as a VPS, Render, Railway, Fly.io, or Docker host.

Required binaries:

```text
yt-dlp
ffmpeg
python with instaloader
```

Start command:

```bash
npm install
npm run dev
```

For production, set CORS so the Vercel frontend can call the API:

```text
CORS_ORIGIN=https://your-vercel-domain.vercel.app
PORT=3000
```

Then set `VITE_API_BASE_URL` on Vercel to the public URL of this backend.
