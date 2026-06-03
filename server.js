import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import express from 'express';
import cors from 'cors';
import sanitize from 'sanitize-filename';

const require = createRequire(import.meta.url);
const archiver = require('archiver');
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const ytdlpBinary = process.env.YTDLP_PATH || 'yt-dlp';
const ffmpegBinary = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobeBinary = process.env.FFPROBE_PATH || 'ffprobe';
const corsOrigin = process.env.CORS_ORIGIN || false;

// Write YouTube cookies from env var to a temp file for yt-dlp
let cookieFilePath = null;
if (process.env.YOUTUBE_COOKIES) {
  cookieFilePath = path.join(os.tmpdir(), 'yt-cookies.txt');
  let cookieContent = process.env.YOUTUBE_COOKIES;
  
  // Try to parse as JSON and convert to Netscape format
  try {
    const parsed = JSON.parse(cookieContent);
    if (Array.isArray(parsed)) {
      cookieContent = "# Netscape HTTP Cookie File\n# https://curl.haxx.se/rfc/cookie_spec.html\n# This is a generated file! Do not edit.\n\n" + 
        parsed.map(c => {
          const domain = c.domain || '';
          const includeSubDomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
          const path = c.path || '/';
          const secure = c.secure ? 'TRUE' : 'FALSE';
          const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
          return `${domain}\t${includeSubDomains}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`;
        }).join('\n');
      console.log('YouTube JSON cookies detected and converted to Netscape format.');
    }
  } catch (e) {
    // Not JSON, assume it's already in Netscape format
  }

  await fs.writeFile(cookieFilePath, cookieContent, 'utf8');
  console.log('YouTube cookies loaded from environment variable.');
}
const { ZipArchive } = archiver;
const allowedHosts = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
];

app.use(express.json({ limit: '64kb' }));
app.use(cors({
  origin: corsOrigin,
  credentials: false,
}));

// Set long timeouts to prevent download interruptions on cloud platforms
app.use((req, res, next) => {
  req.socket.setTimeout(30 * 60 * 1000); // 30 minutes
  res.setTimeout(30 * 60 * 1000);        // 30 minutes
  next();
});

function validateMediaUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Enter a valid YouTube, Instagram, or TikTok URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  const host = url.hostname.toLowerCase();
  const supported = allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (!supported) {
    throw new Error('Only YouTube, Instagram, and TikTok URLs are supported.');
  }

  return url.toString();
}

function getPlatform(value) {
  const host = new URL(value).hostname.toLowerCase();
  if (host.includes('youtu')) return 'YouTube';
  if (host.includes('instagram')) return 'Instagram';
  if (host.includes('tiktok')) return 'TikTok';
  return 'Media';
}

function safeFilename(value, fallback = 'mediapull-download') {
  const cleaned = sanitize(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, 140);
  return cleaned || fallback;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function createZipArchive() {
  return new ZipArchive({ zlib: { level: 9 } });
}

function formatDate(value) {
  const text = String(value || '');
  if (!/^\d{8}$/.test(text)) return '';
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function isAacAudio(codec) {
  return /^(aac|mp4a)/i.test(String(codec || ''));
}

function isDirectPlayableMp4(format) {
  return format?.url &&
    format.ext === 'mp4' &&
    format.acodec &&
    format.acodec !== 'none' &&
    isAacAudio(format.acodec) &&
    isSafeRemoteMediaUrl(format.url);
}

function runProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 120000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options.spawnOptions,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()));
      }
    });
  });
}

async function probeWithYtDlp(url) {
  const args = ['--dump-single-json', '--no-warnings', '--skip-download'];
  if (cookieFilePath) args.push('--cookies', cookieFilePath);
  if (getPlatform(url) === 'YouTube' && !new URL(url).searchParams.has('list')) {
    args.push('--no-playlist');
  }
  args.push(url);

  const { stdout } = await runProcess(ytdlpBinary, args, { timeoutMs: 180000 });
  const jsonStart = stdout.indexOf('{');
  if (jsonStart < 0) throw new Error('No metadata was returned for this URL.');
  return JSON.parse(stdout.slice(jsonStart));
}

async function probeInstagramWithInstaloader(url) {
  const script = `
import json, re, sys
import instaloader

source = sys.argv[1]
match = re.search(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)/?", source)
if not match:
    raise SystemExit("Unsupported Instagram URL format.")

shortcode = match.group(1)
route = match.group(0).split("/")[1]
loader = instaloader.Instaloader(
    download_videos=True,
    download_video_thumbnails=False,
    save_metadata=False,
    compress_json=False,
    quiet=True,
)
post = instaloader.Post.from_shortcode(loader.context, shortcode)
items = []

if post.typename == "GraphSidecar":
    for index, node in enumerate(post.get_sidecar_nodes(), start=1):
        items.append({
            "url": node.video_url if node.is_video else node.display_url,
            "thumbnail": node.display_url,
            "is_video": bool(node.is_video),
            "index": index,
        })
else:
    items.append({
        "url": post.video_url if post.is_video else post.url,
        "thumbnail": post.url,
        "is_video": bool(post.is_video),
        "index": 1,
    })

print(json.dumps({
    "platform": "Instagram",
    "sourceUrl": source,
    "shortcode": shortcode,
    "typename": post.typename,
    "route": route,
    "title": (post.caption or shortcode)[:140],
    "uploader": post.owner_username,
    "date": post.date_utc.strftime("%Y-%m-%d"),
    "duration": getattr(post, "video_duration", None) if post.is_video else None,
    "thumbnail": post.url,
    "items": items,
}, ensure_ascii=False))
`;

  const pythonCmd = os.platform() === 'win32' ? 'py' : 'python3';
  const { stdout } = await runProcess(pythonCmd, ['-c', script, url], { timeoutMs: 180000 });
  const jsonStart = stdout.indexOf('{');
  if (jsonStart < 0) throw new Error('No Instagram metadata was returned.');
  const payload = JSON.parse(stdout.slice(jsonStart));
  const isCollection = payload.items.length > 1;
  const first = payload.items[0];
  const isReelRoute = ['reel', 'reels'].includes(String(payload.route || '').toLowerCase());
  const mediaType = isCollection ? 'Carousel' : first?.is_video ? (isReelRoute ? 'Reel' : 'Video') : 'Post';

  return {
    platform: 'Instagram',
    mediaType,
    sourceUrl: url,
    isCollection,
    entryCount: payload.items.length,
    title: payload.title || 'Instagram media',
    uploader: payload.uploader || 'Instagram',
    duration: formatDuration(Number(payload.duration)),
    date: payload.date || '',
    viewCount: isCollection ? `${payload.items.length} Items` : mediaType,
    thumbnail: payload.thumbnail || first?.thumbnail || first?.url || '',
    formats: {
      video: isCollection ? [
        {
          id: 'instagram-direct-zip',
          selector: 'direct',
          label: 'ALL',
          description: 'Carousel originals / ZIP',
          size: `${payload.items.length} items`,
          ext: 'zip',
          kind: 'instagram-direct-collection',
          directUrls: payload.items.map((item) => item.url),
        },
      ] : [
        {
          id: 'instagram-direct',
          selector: 'direct',
          label: first?.is_video ? 'VIDEO' : 'IMAGE',
          description: first?.is_video ? `${mediaType} / MP4` : 'Original / JPG',
          size: '',
          ext: first?.is_video ? 'mp4' : 'jpg',
          kind: 'instagram-direct',
          directUrl: first?.url,
        },
      ],
      audio: [],
    },
  };
}

function pickThumbnail(info) {
  const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  const picked = [...thumbnails].reverse().find((item) => item?.url);
  return picked?.url || info.thumbnail || '';
}

function isSafeRemoteMediaUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return [
    'googlevideo.com',
    'ytimg.com',
    'youtube.com',
    'ggpht.com',
    'tiktok.com',
    'tiktokcdn.com',
    'tiktokv.com',
    'byteoversea.com',
    'cdninstagram.com',
    'fbcdn.net',
    'instagram.com',
  ].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function fetchRemoteMedia(url, range = '') {
  if (!isSafeRemoteMediaUrl(url)) {
    throw new Error('Unsupported remote media host.');
  }

  const remoteUrl = new URL(url);
  const remoteHost = remoteUrl.hostname.toLowerCase();
  const referer = remoteHost.endsWith('tiktok.com') || remoteHost.endsWith('tiktokcdn.com') || remoteHost.endsWith('tiktokv.com')
    ? 'https://www.tiktok.com/'
    : remoteHost.endsWith('googlevideo.com') || remoteHost.endsWith('ytimg.com') || remoteHost.endsWith('youtube.com') || remoteHost.endsWith('ggpht.com')
      ? 'https://www.youtube.com/'
      : 'https://www.instagram.com/';
  return fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 MediaPull',
      Referer: referer,
      ...(range ? { Range: range } : {}),
    },
  });
}

async function pipeRemoteMedia(url, res, filename = '') {
  const range = typeof res.req?.headers?.range === 'string' ? res.req.headers.range : '';
  const upstream = await fetchRemoteMedia(url, range);
  if (!upstream.ok || !upstream.body) {
    throw new Error('Could not fetch remote media.');
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (upstream.status === 206) res.status(206);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
  if (filename) res.attachment(filename);
  Readable.fromWeb(upstream.body).pipe(res);
}

function buildVideoFormats(info, platform = '') {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const bestByHeight = new Map();

  for (const format of formats) {
    if (!format?.format_id || !format.height || format.vcodec === 'none') continue;
    if (['mhtml', 'storyboard'].includes(format.ext)) continue;

    const score = (
      (format.ext === 'mp4' ? 1000000 : 0) +
      (format.acodec && format.acodec !== 'none' ? 100000 : 0) +
      Number(format.tbr || 0) +
      Number(format.filesize || format.filesize_approx || 0) / 1000000000
    );
    const currentScore = bestByHeight.get(format.height)?.score ?? -1;
    if (score <= currentScore) continue;

    // Use height-based selector with fallbacks so it works even if a specific
    // format ID is unavailable at download time (e.g. with/without cookies).
    const h = format.height;
    const selector = format.acodec && format.acodec !== 'none'
      ? `${format.format_id}/bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${h}]+bestaudio/best[height<=${h}]/best`
      : `${format.format_id}+bestaudio[ext=m4a]/bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${h}]+bestaudio/best[height<=${h}]/best`;
    const canDirectStream = platform !== 'TikTok' && isDirectPlayableMp4(format);

    bestByHeight.set(format.height, {
      score,
      id: String(format.format_id),
      selector,
      label: `${format.height}P`,
      description: `${(format.vcodec || 'video').split('.')[0].toUpperCase()} / ${(format.ext || 'MP4').toUpperCase()}`,
      size: formatBytes(format.filesize || format.filesize_approx),
      ext: format.ext === 'mp4' ? 'mp4' : 'mkv',
      height: format.height,
      kind: canDirectStream ? 'direct' : 'video',
      directUrl: canDirectStream ? format.url : undefined,
    });
  }

  return [...bestByHeight.values()]
    .sort((a, b) => b.height - a.height)
    .map(({ score, ...format }) => format);
}

function buildAudioFormats(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const rows = [
    {
      id: 'mp3-320',
      selector: 'bestaudio/best',
      label: 'MP3 320',
      description: 'Audio / MP3',
      size: '',
      ext: 'mp3',
      kind: 'audio',
      audioFormat: 'mp3',
      audioQuality: '0',
    },
    {
      id: 'mp3-192',
      selector: 'bestaudio/best',
      label: 'MP3 192',
      description: 'Audio / MP3',
      size: '',
      ext: 'mp3',
      kind: 'audio',
      audioFormat: 'mp3',
      audioQuality: '5',
    },
  ];

  const bestByExt = new Map();
  for (const format of formats) {
    if (!format?.format_id || format.acodec === 'none' || format.vcodec !== 'none') continue;
    const key = format.ext || 'audio';
    const current = bestByExt.get(key);
    const score = Number(format.abr || format.tbr || 0);
    if (current && score <= current.score) continue;
    bestByExt.set(key, {
      score,
      id: String(format.format_id),
      selector: String(format.format_id),
      label: `${key.toUpperCase()}${format.abr ? ` ${Math.round(format.abr)}` : ''}`,
      description: `${(format.acodec || 'audio').split('.')[0].toUpperCase()} / ${key.toUpperCase()}`,
      size: formatBytes(format.filesize || format.filesize_approx),
      ext: key,
      kind: 'audio',
    });
  }

  return [...rows, ...[...bestByExt.values()].map(({ score, ...format }) => format)].slice(0, 8);
}

function mapMetadata(info, sourceUrl) {
  const entries = Array.isArray(info.entries) ? info.entries.filter(Boolean) : [];
  const first = entries[0] || info;
  const isCollection = entries.length > 1;

  return {
    platform: getPlatform(sourceUrl),
    sourceUrl,
    isCollection,
    entryCount: entries.length,
    title: info.title || first.title || 'Untitled media',
    uploader: info.uploader || info.channel || first.uploader || first.channel || getPlatform(sourceUrl),
    duration: formatDuration(info.duration || first.duration),
    date: formatDate(info.upload_date || first.upload_date),
    viewCount: Number.isFinite(info.view_count) ? `${Intl.NumberFormat('en', { notation: 'compact' }).format(info.view_count)} Views` : '',
    thumbnail: pickThumbnail(first),
    formats: {
      video: isCollection ? [
        {
          id: 'collection-best',
          selector: 'best',
          label: 'ALL',
          description: 'Original files / ZIP',
          size: `${entries.length} items`,
          ext: 'zip',
          kind: 'collection',
        },
      ] : buildVideoFormats(info, getPlatform(sourceUrl)),
      audio: isCollection ? [] : buildAudioFormats(info),
    },
  };
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile() && !entry.name.endsWith('.part')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function getMediaStreams(file) {
  const { stdout } = await runProcess(ffprobeBinary, [
    '-v',
    'error',
    '-show_streams',
    '-of',
    'json',
    file,
  ], { timeoutMs: 60000 });
  return JSON.parse(stdout || '{"streams":[]}').streams || [];
}

async function ensureMp4AudioCompatibility(file, tempDir, title) {
  if (path.extname(file).toLowerCase() !== '.mp4') return file;

  let streams = [];
  try {
    streams = await getMediaStreams(file);
  } catch {
    streams = [];
  }

  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const needsAacAudio = audioStreams.some((stream) => !isAacAudio(stream.codec_name));
  if (!needsAacAudio) return file;

  const output = path.join(tempDir, `${safeFilename(title, 'mediapull-download')}.compatible.mp4`);
  await runProcess(ffmpegBinary, [
    '-y',
    '-i',
    file,
    '-map',
    '0:v:0?',
    '-map',
    '0:a?',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    output,
  ], { timeoutMs: 30 * 60 * 1000 });
  return output;
}

function cleanupSoon(dir) {
  setTimeout(() => {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }, 30000);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ytdlp: ytdlpBinary });
});

app.get('/api/media', async (req, res) => {
  try {
    await pipeRemoteMedia(String(req.query.url || ''), res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(400).json({ error: error.message || 'Could not load media preview.' });
    }
  }
});

app.post('/api/probe', async (req, res) => {
  try {
    const sourceUrl = validateMediaUrl(req.body?.url);
    if (getPlatform(sourceUrl) === 'Instagram') {
      try {
        res.json(await probeInstagramWithInstaloader(sourceUrl));
        return;
      } catch {
        res.json(mapMetadata(await probeWithYtDlp(sourceUrl), sourceUrl));
        return;
      }
    }

    try {
      const info = await probeWithYtDlp(sourceUrl);
      res.json(mapMetadata(info, sourceUrl));
    } catch (error) {
      throw error;
    }
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not analyze this URL.' });
  }
});

function getDownloadParam(req, name, fallback = '') {
  const source = req.method === 'GET' ? req.query : req.body;
  const value = source?.[name];
  return value === undefined || value === null ? fallback : value;
}

function getDownloadArrayParam(req, name) {
  const value = getDownloadParam(req, name, []);
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function handleDownload(req, res) {
  let tempDir;
  try {
    const sourceUrl = validateMediaUrl(getDownloadParam(req, 'url'));
    const selector = String(getDownloadParam(req, 'selector', 'best'));
    const kind = String(getDownloadParam(req, 'kind', 'video'));
    const ext = safeFilename(getDownloadParam(req, 'ext', kind === 'audio' ? 'mp3' : 'mp4'), 'mp4').replace(/^\.+/, '');
    const title = safeFilename(getDownloadParam(req, 'title', 'mediapull-download'));

    if (!/^[A-Za-z0-9_+./:,=\-[\]^]+$/.test(selector)) {
      throw new Error('Unsupported format selector.');
    }

    tempDir = path.join(os.tmpdir(), `mediapull-${crypto.randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    if (kind === 'direct') {
      await pipeRemoteMedia(String(getDownloadParam(req, 'directUrl')), res, `${title}.${ext || 'mp4'}`);
      cleanupSoon(tempDir);
      return;
    }

    if (kind === 'instagram-direct') {
      const directUrl = new URL(String(getDownloadParam(req, 'directUrl')));
      if (!directUrl.hostname.includes('cdninstagram.com') && !directUrl.hostname.includes('fbcdn.net')) {
        throw new Error('Unsupported Instagram media host.');
      }
      await pipeRemoteMedia(directUrl.toString(), res, `${title}.${ext || 'jpg'}`);
      cleanupSoon(tempDir);
      return;
    }

    if (kind === 'instagram-direct-collection') {
      const directUrls = getDownloadArrayParam(req, 'directUrls')
        .map((item) => new URL(item));
      if (directUrls.length === 0) throw new Error('No Instagram files were returned.');

      res.attachment(`${title}.zip`);
      const archive = createZipArchive();
      archive.pipe(res);
      let index = 1;
      for (const directUrl of directUrls) {
        if (!directUrl.hostname.includes('cdninstagram.com') && !directUrl.hostname.includes('fbcdn.net')) {
          throw new Error('Unsupported Instagram media host.');
        }
        const upstream = await fetchRemoteMedia(directUrl.toString());
        if (!upstream.ok || !upstream.body) continue;
        const fileExt = directUrl.pathname.toLowerCase().includes('.mp4') ? 'mp4' : 'jpg';
        archive.append(Readable.fromWeb(upstream.body), { name: `${title}-${index}.${fileExt}` });
        index += 1;
      }
      await archive.finalize();
      cleanupSoon(tempDir);
      return;
    }

    if (kind === 'collection') {
      const outputTemplate = path.join(tempDir, '%(title).180B.%(ext)s');
      const collectionArgs = ['--ignore-errors', '--no-warnings', '-o', outputTemplate];
      if (cookieFilePath) collectionArgs.push('--cookies', cookieFilePath);
      collectionArgs.push(sourceUrl);
      await runProcess(ytdlpBinary, collectionArgs, {
        timeoutMs: 30 * 60 * 1000,
      });
      const files = await listFiles(tempDir);
      if (files.length === 0) throw new Error('No downloadable files were produced.');

      res.attachment(`${title}.zip`);
      const archive = createZipArchive();
      archive.on('error', (error) => {
        throw error;
      });
      res.on('finish', () => cleanupSoon(tempDir));
      archive.pipe(res);
      for (const file of files) {
        archive.file(file, { name: path.basename(file) });
      }
      await archive.finalize();
      return;
    }

    const outputTemplate = path.join(tempDir, `${title}.%(ext)s`);
    const args = [
      '--no-warnings', '--no-playlist',
      '-f', selector,
      '-o', outputTemplate,
      '--concurrent-fragments', '16',   // download 16 fragments in parallel
      '--buffer-size', '16K',           // larger read buffer
      '--http-chunk-size', '10M',       // fetch in 10MB chunks
      '--retries', '10',                // retry on failure
      '--fragment-retries', '10',       // retry fragments
    ];
    if (cookieFilePath) args.push('--cookies', cookieFilePath);

    if (kind === 'audio') {
      if (getDownloadParam(req, 'audioFormat')) {
        args.push('-x', '--audio-format', String(getDownloadParam(req, 'audioFormat')));
        if (getDownloadParam(req, 'audioQuality')) args.push('--audio-quality', String(getDownloadParam(req, 'audioQuality')));
      }
    } else {
      args.push('--merge-output-format', ext === 'mkv' ? 'mkv' : 'mp4');
    }

    args.push(sourceUrl);
    await runProcess(ytdlpBinary, args, { timeoutMs: 30 * 60 * 1000 });
    const files = await listFiles(tempDir);
    if (files.length === 0) throw new Error('No downloadable file was produced.');

    let file = files.sort((a, b) => b.length - a.length)[0];
    if (kind !== 'audio') {
      file = await ensureMp4AudioCompatibility(file, tempDir, title);
    }
    const stat = await fs.stat(file);
    const responseFilename = path.extname(file).toLowerCase() === '.mp4' ? `${title}.mp4` : path.basename(file);
    res.setHeader('Content-Length', String(stat.size));
    res.download(file, responseFilename, () => cleanupSoon(tempDir));
  } catch (error) {
    if (tempDir) cleanupSoon(tempDir);
    if (!res.headersSent) {
      res.status(400).json({ error: error.message || 'Download failed.' });
    }
  }
}

app.get('/api/download', handleDownload);
app.post('/api/download', handleDownload);

if (isProduction) {
  app.use(express.static(path.resolve('dist')));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.resolve('dist/index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`MediaPull running at http://0.0.0.0:${port}/`);
});
