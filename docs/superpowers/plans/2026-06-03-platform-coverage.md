# Platform Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MediaPull explicitly support YouTube Shorts plus Instagram posts, Reels, and carousels.

**Architecture:** Keep `server.js` as the downloader API boundary. Prefer `instaloader` for Instagram metadata so carousels expose every original media URL, and fall back to `yt-dlp` for public posts that `instaloader` cannot read. The React UI already renders API-provided format rows, so carousel support should be represented as an `ALL / ZIP` format.

**Tech Stack:** Express, yt-dlp, Python instaloader, React/Vite.

---

### Task 1: Confirm Current Coverage

**Files:**
- Inspect: `server.js`
- Inspect: `src/App.jsx`

- [ ] Probe YouTube Shorts with `/api/probe`.
- [ ] Probe Instagram image post with `/api/probe`.
- [ ] Probe Instagram Reel with `/api/probe`.
- [ ] Probe or identify a public Instagram carousel sample.

### Task 2: Instagram Probe Priority

**Files:**
- Modify: `server.js`

- [ ] In `/api/probe`, route Instagram URLs to `probeInstagramWithInstaloader()` first.
- [ ] If `probeInstagramWithInstaloader()` fails, fall back to `probeWithYtDlp()`.
- [ ] Keep YouTube, YouTube Shorts, and TikTok on the existing `yt-dlp` path.

### Task 3: Instagram Item Metadata

**Files:**
- Modify: `server.js`

- [ ] Add a `mediaType` field to Instagram probe responses.
- [ ] For `GraphSidecar`, return `mediaType: "Carousel"` and `viewCount: "<N> Items"`.
- [ ] For Reels/videos, return `mediaType: "Reel"` or `"Video"` and a direct MP4 format.
- [ ] For single image posts, return `mediaType: "Post"` and a direct JPG format.

### Task 4: Verification

**Files:**
- Verify: `server.js`
- Verify: `src/App.jsx`

- [ ] Run `npm run build`.
- [ ] Verify `/api/probe` and `/api/download` for a YouTube Shorts URL.
- [ ] Verify `/api/probe` and `/api/download` for Instagram post/Reel URLs that are public and reachable.
- [ ] Verify carousel ZIP behavior when a public carousel URL is reachable.
- [ ] Refresh `http://127.0.0.1:3000/` in the in-app browser.
