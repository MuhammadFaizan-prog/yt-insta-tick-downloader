# How to Export Fresh YouTube Cookies

## Why Your Cookies Are Expired

Your current cookies in `test-cookies.json` have expiration dates that have already passed (around June 2026 or earlier). YouTube requires fresh, valid authentication cookies to download videos.

## Step-by-Step: Export Fresh Cookies

### Method 1: Using Browser Extension (Recommended)

1. **Install "Get cookies.txt LOCALLY" Extension**
   - Chrome: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/

2. **Login to YouTube**
   - Go to https://www.youtube.com
   - Make sure you're logged in to your account
   - Watch any video to ensure cookies are active

3. **Export Cookies**
   - Click the extension icon while on youtube.com
   - It will download a `cookies.txt` file in Netscape format
   - This is the format yt-dlp prefers

4. **Set on Render**
   - Open the `cookies.txt` file in a text editor
   - Copy ALL the content
   - Go to Render Dashboard → Your Service → Environment
   - Set `YOUTUBE_COOKIES` = paste the entire cookie file content
   - **Important:** Render may have character limits. If it's too long, see Method 2.

### Method 2: Using yt-dlp Directly (Best for Render)

1. **On Your Local Machine**
   ```bash
   # Install yt-dlp if you haven't
   pip install yt-dlp

   # Login to YouTube via yt-dlp (opens browser)
   yt-dlp --cookies-from-browser chrome --write-cookies cookies.txt https://www.youtube.com/watch?v=dQw4w9WgXcQ

   # Or use Firefox
   yt-dlp --cookies-from-browser firefox --write-cookies cookies.txt https://www.youtube.com/watch?v=dQw4w9WgXcQ
   ```

2. **Check the Cookie File**
   ```bash
   cat cookies.txt
   ```

3. **Upload to Render**
   - Copy the content of `cookies.txt`
   - Set as `YOUTUBE_COOKIES` environment variable on Render

### Method 3: JSON Format (Alternative)

If you prefer JSON format:

1. **Install "Cookie-Editor" Extension**
   - Chrome: https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/

2. **Export as JSON**
   - Go to youtube.com (logged in)
   - Click the Cookie-Editor extension
   - Click "Export" → Export all cookies as JSON
   - Copy the JSON array

3. **Set on Render**
   - Paste the JSON array into `YOUTUBE_COOKIES` environment variable
   - The server will auto-convert to Netscape format

## Verify Cookies Are Working

After setting the environment variable on Render:

1. **Check Render Logs** for these messages:
   ```
   ✅ YouTube cookies loaded: X valid cookies (Y expired)
   Cookie file written to: /tmp/yt-cookies.txt
   ```

2. **If you see expired warnings:**
   - All cookies are expired → Export fresh cookies again
   - Some cookies expired → Should still work if critical ones are valid

3. **Test a Download**
   - Try downloading a public YouTube video
   - Check logs for `Using cookie file: /tmp/yt-cookies.txt`

## Important Notes

- **Cookies expire!** You'll need to refresh them periodically (usually every 6-12 months)
- **Private/Age-restricted videos** require valid logged-in cookies
- **Public videos** may work without cookies but are more reliable with them
- **Don't share your cookies** - they contain your authentication tokens

## Troubleshooting

### Still getting 400 errors?

1. **Try different player client:**
   Edit `server.js` line ~265 and change:
   ```javascript
   args.push('--extractor-args', 'youtube:player_client=ios,android,web');
   ```

2. **Update yt-dlp on Render:**
   Add to `package.json` scripts:
   ```json
   "postinstall": "pip install -U yt-dlp"
   ```

3. **Test locally first:**
   ```bash
   export YOUTUBE_COOKIES="$(cat cookies.txt)"
   npm run dev
   ```

### Cookie format issues?

- Make sure there are no extra quotes or escaping
- Render env vars should be raw text, no quotes around the value
- Multi-line is OK for Netscape format

### Size limits on Render?

If `YOUTUBE_COOKIES` is too large:
- Use a minimal cookie set (only include .youtube.com domain cookies)
- Or mount cookies from a file using Render disks (advanced)
