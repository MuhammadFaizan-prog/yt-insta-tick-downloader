# YouTube Download Troubleshooting Guide

## Problem: 400 Bad Request Error on Render

### Quick Diagnosis

Visit your deployed app at: `https://your-app.onrender.com/api/health`

This will show:
```json
{
  "status": "ok",
  "cookies": {
    "configured": true/false,
    "fileExists": true/false,
    "filePath": "/tmp/yt-cookies.txt"
  }
}
```

### Common Issues & Solutions

#### 1. ❌ Cookies Not Configured
```json
"configured": false
```

**Solution:** 
- You haven't set the `YOUTUBE_COOKIES` environment variable on Render
- Follow the guide in `export-cookies.md` to export and set cookies

#### 2. ⚠️ Cookies Expired
**Symptoms:**
- Render logs show: `Skipping expired cookie: __Secure-3PSID`
- Or: `All YouTube cookies are expired!`

**Solution:**
1. Export FRESH cookies (see `export-cookies.md`)
2. Your current `test-cookies.json` has cookies from January 2025 that expired in June 2026
3. Since we're in June 2026, they're expired!
4. Export new cookies from your currently logged-in browser session

#### 3. 🔧 Cookie Format Issues
**Symptoms:**
- Logs show: `YouTube cookies detected in Netscape format` but downloads still fail
- Or: Cookie file exists but yt-dlp returns 400

**Possible Causes:**
a) **Encoding issues** - Render env vars might have wrong line breaks
b) **Missing required cookies** - Not all cookies were exported
c) **Cookie domain mismatch** - Some cookies are for `www.youtube.com` but need `.youtube.com`

**Solutions:**

**A. Use yt-dlp to export cookies directly:**
```bash
# On your local machine
yt-dlp --cookies-from-browser chrome --write-cookies youtube-cookies.txt https://www.youtube.com/watch?v=dQw4w9WgXcQ

# Copy the content
cat youtube-cookies.txt

# Set this exact content as YOUTUBE_COOKIES on Render
```

**B. Verify cookie file on Render:**
Add this temporary route to `server.js` (remove after debugging):
```javascript
app.get('/api/debug-cookies', async (req, res) => {
  if (!cookieFilePath) {
    return res.json({ error: 'No cookie file' });
  }
  const content = await fs.readFile(cookieFilePath, 'utf8');
  res.json({ 
    path: cookieFilePath,
    lines: content.split('\n').length,
    preview: content.slice(0, 500)
  });
});
```

#### 4. 🚫 YouTube Bot Detection
**Symptoms:**
- Error: "Sign in to confirm you're not a bot"
- Error: "This video is unavailable"

**Causes:**
- YouTube detected automated access
- Player client strategy blocked
- IP address flagged

**Solutions:**

**A. Change player client strategy:**

In `server.js`, find this line (~265):
```javascript
args.push('--extractor-args', 'youtube:player_client=android,web');
```

Try these alternatives:
```javascript
// Option 1: iOS client (often more reliable)
args.push('--extractor-args', 'youtube:player_client=ios,web');

// Option 2: Android only
args.push('--extractor-args', 'youtube:player_client=android');

// Option 3: Remove player client restriction entirely
// Just comment out the line
```

**B. Update yt-dlp:**

Add to `package.json`:
```json
"scripts": {
  "postinstall": "pip install -U yt-dlp || true"
}
```

Or set up a monthly cron job on Render to update yt-dlp.

#### 5. 📦 Missing Dependencies on Render
**Symptoms:**
- `yt-dlp: command not found`
- `python: command not found`

**Solution:**

Check your Render service build settings:

**Build Command:**
```bash
pip install yt-dlp instaloader && npm install
```

**Start Command:**
```bash
npm start
```

Or add a `render.yaml`:
```yaml
services:
  - type: web
    name: mediapull
    env: node
    buildCommand: pip install yt-dlp instaloader && npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: YOUTUBE_COOKIES
        sync: false  # Set this manually in Render dashboard
```

#### 6. 🕐 Request Timeout
**Symptoms:**
- Download starts but times out
- No response after long wait

**Solution:**

Render free tier has 15-minute request timeout. For long downloads:

**A. Use streaming download** (already implemented in your code)

**B. Increase timeouts:**
In `server.js` (~115):
```javascript
req.socket.setTimeout(30 * 60 * 1000); // Already set to 30 mins
```

**C. Optimize format selection:**
Choose lower quality formats for faster downloads, or implement a background job queue.

## Step-by-Step Fix for Your Current Issue

Based on your screenshot showing 400 error on `/api/probe`:

### Step 1: Export Fresh Cookies

1. Open Chrome/Firefox
2. Go to https://www.youtube.com
3. Make sure you're logged in
4. Install and use "Get cookies.txt LOCALLY" extension
5. Export cookies for youtube.com

### Step 2: Update Render Environment Variables

1. Go to Render Dashboard
2. Select your service (yt-insta-tick-downloader)
3. Go to "Environment" tab
4. Find or add `YOUTUBE_COOKIES`
5. Paste the ENTIRE cookie file content (Netscape format)
6. Save changes

### Step 3: Redeploy

Render should auto-deploy when you save env vars. If not:
- Go to "Manual Deploy" → "Deploy latest commit"

### Step 4: Verify

1. Check deployment logs for:
   ```
   ✅ YouTube cookies loaded: 15 valid cookies (0 expired)
   Cookie file written to: /tmp/yt-cookies.txt
   ```

2. Visit: `https://your-app.onrender.com/api/health`
   Should show:
   ```json
   {
     "cookies": {
       "configured": true,
       "fileExists": true
     }
   }
   ```

3. Try downloading a simple YouTube video

## Still Not Working?

### Debug Checklist

- [ ] Cookies are less than 6 months old
- [ ] Cookies include domain `.youtube.com` (with leading dot)
- [ ] Key cookies present: `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`
- [ ] yt-dlp version is recent (check logs for version)
- [ ] Test the SAME URL locally with the same cookies
- [ ] Try a different YouTube video (some may be region-locked)

### Local Testing

Test locally before deploying:

```bash
# Set the cookie content
export YOUTUBE_COOKIES="$(cat your-cookies.txt)"

# Run the server
npm run dev

# Test in another terminal
curl -X POST http://localhost:3000/api/probe \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

If it works locally but not on Render:
- Check Render's IP isn't blocked by YouTube (less likely)
- Verify yt-dlp version matches between local and Render
- Check Render logs for the EXACT error from yt-dlp

### Last Resort Options

If cookies keep failing:

1. **Use YouTube API officially** (requires API key, quotas)
2. **Try alternative services** like Invidious API
3. **Run on a VPS** instead of Render (more control)
4. **Implement OAuth flow** for users to auth with their own YouTube accounts

## Prevention

- **Refresh cookies monthly** - Set a calendar reminder
- **Monitor logs** - Check for cookie expiration warnings
- **Keep yt-dlp updated** - YouTube changes their API frequently
- **Have backup cookies** - Export from multiple browsers/accounts

## Need More Help?

1. Check yt-dlp GitHub issues: https://github.com/yt-dlp/yt-dlp/issues
2. Look for recent YouTube extractor issues
3. Share your SANITIZED Render logs (remove cookie values!)
