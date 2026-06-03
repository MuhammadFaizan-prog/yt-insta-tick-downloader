# 🔧 YouTube 400 Error Fix

## Problem Summary

You're getting **400 (Bad Request)** errors when trying to download YouTube videos on Render, while TikTok and Instagram work perfectly.

## Root Cause

Your YouTube cookies are **EXPIRED**! Looking at your `test-cookies.json`:
- Cookies expire around June 2026 (timestamp: 1812040546)
- Current date is June 3, 2026
- **All cookies are already expired or about to expire**

YouTube requires valid authentication cookies to:
1. Access video metadata via yt-dlp
2. Download age-restricted or members-only content
3. Avoid bot detection

## Why TikTok/Instagram Still Work

- **TikTok**: Doesn't require authentication for most videos
- **Instagram**: Uses Python's `instaloader` library as primary method (doesn't need cookies), falls back to yt-dlp
- **YouTube**: ONLY uses yt-dlp with cookies - no fallback method

## 🚀 Quick Fix (3 Steps)

### Step 1: Export Fresh Cookies

**Option A - Browser Extension (Easiest):**

1. Install [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Go to https://www.youtube.com (make sure you're logged in)
3. Click the extension icon → it downloads `cookies.txt`
4. Done! ✅

**Option B - Using yt-dlp (Best):**

```bash
yt-dlp --cookies-from-browser chrome --write-cookies cookies.txt https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

This extracts cookies directly from your Chrome browser.

### Step 2: Test Locally (Optional but Recommended)

```bash
# Test your cookies work before deploying
node test-cookies-validation.js ./cookies.txt

# Should show: ✅ SUCCESS! Cookies are working!
```

### Step 3: Deploy to Render

1. **Open your cookie file** (`cookies.txt`) in a text editor
2. **Copy ALL the content** (entire file)
3. **Go to Render Dashboard**:
   - Select your service
   - Go to "Environment" tab
   - Find/Add: `YOUTUBE_COOKIES`
   - Paste the entire cookie file content
   - Click "Save Changes"
4. **Wait for auto-deploy** (or manually trigger deploy)
5. **Check logs** for:
   ```
   ✅ YouTube cookies loaded: 15 valid cookies (0 expired)
   ```

### Step 4: Verify

Visit: `https://your-app.onrender.com/api/health`

Should show:
```json
{
  "status": "ok",
  "cookies": {
    "configured": true,
    "fileExists": true,
    "filePath": "/tmp/yt-cookies.txt"
  }
}
```

## 🔍 What Changed in the Code

I've updated your `server.js` with:

1. **Cookie Expiration Detection** (lines 22-50):
   - Filters out expired cookies automatically
   - Logs which cookies are expired
   - Shows clear error if all cookies are expired

2. **Better Error Messages** (lines 260-295):
   - Specific messages for different failure types
   - Hints about cookie expiration
   - More detailed logging for debugging

3. **Health Check Endpoint** (new):
   - `GET /api/health` - Shows cookie status
   - Helps diagnose issues without checking logs

## 📚 Documentation Added

1. **`export-cookies.md`** - Complete guide to export fresh cookies
2. **`TROUBLESHOOTING.md`** - Comprehensive troubleshooting guide
3. **`test-cookies-validation.js`** - Script to validate cookies before deploying
4. **`README-YOUTUBE-FIX.md`** - This file!

## 🎯 Alternative Solutions

If cookies keep failing, try:

### Solution 1: Change Player Client Strategy

Edit `server.js` line ~275:

```javascript
// Current
args.push('--extractor-args', 'youtube:player_client=android,web');

// Try iOS instead (often more reliable)
args.push('--extractor-args', 'youtube:player_client=ios,web');
```

### Solution 2: Update yt-dlp Automatically

Add to `package.json`:

```json
{
  "scripts": {
    "postinstall": "pip install -U yt-dlp || true"
  }
}
```

YouTube changes their API frequently, so keeping yt-dlp updated helps.

### Solution 3: Use Render Build Script

Create `render.yaml` in your project root:

```yaml
services:
  - type: web
    name: mediapull-api
    env: node
    buildCommand: |
      pip install --upgrade yt-dlp instaloader
      npm install
      npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: YOUTUBE_COOKIES
        sync: false
```

## 🔄 Maintenance

**Important:** Cookies expire! You'll need to refresh them periodically:

- **Set a reminder** for every 6 months
- **Monitor Render logs** for expiration warnings
- **Keep yt-dlp updated** (YouTube changes their API often)

## ❓ Still Having Issues?

1. **Check Render logs** for the exact error message
2. **Test locally first** using the validation script
3. **Try a different YouTube video** (some may be region-locked)
4. **Read** `TROUBLESHOOTING.md` for detailed debugging steps

## 📊 Technical Details

### Cookie Requirements

YouTube requires these essential cookies:
- `SID`, `HSID`, `SSID` - Session identifiers
- `APISID`, `SAPISID` - API authentication
- `__Secure-3PSID` - Secure session cookie
- `LOGIN_INFO` - Login authentication token

### Format Support

Your app supports both:
- **Netscape format** (preferred by yt-dlp)
- **JSON format** (auto-converted to Netscape)

### Cookie Conversion Process

1. Read `YOUTUBE_COOKIES` env var
2. Detect if JSON or Netscape format
3. If JSON: Convert to Netscape, filter expired cookies
4. Write to `/tmp/yt-cookies.txt`
5. Pass to yt-dlp via `--cookies` flag

## 🎉 Success Indicators

You'll know it's working when:

1. **Render logs show**:
   ```
   ✅ YouTube cookies loaded: 15 valid cookies (0 expired)
   Cookie file written to: /tmp/yt-cookies.txt
   Using cookie file: /tmp/yt-cookies.txt
   ```

2. **Health endpoint returns**:
   ```json
   {"cookies": {"configured": true, "fileExists": true}}
   ```

3. **YouTube downloads work** without 400 errors!

---

**Need help?** Check the other guides:
- `export-cookies.md` - How to export cookies
- `TROUBLESHOOTING.md` - Detailed debugging steps
- Run `node test-cookies-validation.js` to test locally
