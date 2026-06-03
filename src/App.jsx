import React, { useEffect, useMemo, useRef } from 'react';
import designDocument from '../design.html?raw';
import mediaPullLogo from './assets/mediapull-logo.svg';

const stylePattern = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const bodyPattern = /<body[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/body>/i;
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

function extractDesign(documentSource) {
  const styles = [...documentSource.matchAll(stylePattern)]
    .map((match) => match[1])
    .join('\n\n');
  const bodyMatch = documentSource.match(bodyPattern);
  const badgeDot = String.fromCharCode(194, 183);

  const bodyMarkup = (bodyMatch?.[2] ?? '')
    .replaceAll(' &middot; ', ` ${badgeDot} `)
    .replaceAll(' \u00b7 ', ` ${badgeDot} `)
    .replace('section class="mb-16 space-y-4" vid="74"', 'section class="mb-16 space-y-4 hidden" vid="74"')
    .replace(
      'div class="fixed bottom-6 right-6 z-[100] translate-y-0 opacity-100 transition-all duration-300" vid="227"',
      'div class="fixed bottom-6 right-6 z-[100] translate-y-6 opacity-0 pointer-events-none transition-all duration-300" vid="227"',
    );

  return {
    bodyClassName: bodyMatch?.[1] ?? '',
    bodyMarkup,
    styles,
  };
}

function isSupportedUrl(value) {
  try {
    const url = new URL(value);
    return ['youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'vm.tiktok.com'].some((host) =>
      url.hostname.toLowerCase().includes(host),
    );
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseFilenameFromDisposition(value) {
  if (!value) return '';
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = value.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] || '';
}

function formatRow(format, index) {
  const active = index === 0;
  return `
    <div class="flex items-center justify-between p-2.5 rounded ${
      active
        ? 'bg-mediapull-surface border border-mediapull-border hover:border-mediapull-red/50 group'
        : 'bg-mediapull-surface/50 border border-transparent hover:border-mediapull-border'
    } transition-all">
      <div class="flex items-center gap-4 min-w-0">
        <span class="px-2 py-0.5 ${
          active ? 'bg-mediapull-red/10 text-mediapull-red' : 'bg-mediapull-border text-[#9090A0]'
        } text-[10px] font-mono font-bold rounded uppercase">${escapeHtml(format.label)}</span>
        <span class="text-[11px] font-mono text-[#9090A0] truncate">${escapeHtml(format.description)}</span>
      </div>
      <div class="flex items-center gap-4 shrink-0">
        <span class="text-[11px] font-mono text-[#55555F]">${escapeHtml(format.size || '')}</span>
        <button
          class="js-format-download px-3 py-1 bg-mediapull-card border border-mediapull-border ${
            active ? 'group-hover:bg-mediapull-red group-hover:text-white' : 'hover:bg-mediapull-surface'
          } transition-all rounded text-[10px] font-bold text-[#F0F0F2]"
          data-format-index="${index}"
        >
          DOWNLOAD
        </button>
      </div>
    </div>
  `;
}

export default function App() {
  const rootRef = useRef(null);
  const design = useMemo(() => extractDesign(designDocument), []);

  useEffect(() => {
    const previousClassName = document.body.className;
    document.body.className = design.bodyClassName;

    return () => {
      document.body.className = previousClassName;
    };
  }, [design.bodyClassName]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const state = {
      activeTab: 'video',
      metadata: null,
      formats: { video: [], audio: [] },
      probeController: null,
      progressCancel: null,
      activeDownloads: new Set(),
    };

    root.querySelector('[vid="227"]')?.remove();
    [
      [root.querySelector('[vid="10"]'), 'w-[19px] h-[19px]'],
      [root.querySelector('[vid="216"]'), 'w-[16px] h-[16px]'],
    ].forEach(([mark, sizeClass]) => {
      if (!mark) return;
      mark.innerHTML = `<img src="${mediaPullLogo}" alt="" class="${sizeClass} block" />`;
    });

    const sections = [...root.querySelectorAll('main > section')];
    const resultSection = sections[1];
    const resultCard = resultSection?.children?.[0];
    const progressCard = resultSection?.children?.[1];
    const skeletonCard = resultSection?.children?.[2];
    const input = root.querySelector('input[type="text"]');
    const error = root.querySelector('[vid="68"]');
    const errorText = root.querySelector('[vid="73"]');
    const primaryDownloadButton = [...root.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === 'DOWNLOAD' && node.className.includes('btn-primary'),
    );
    const pasteButton = [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === 'PASTE');
    const themeButton = root.querySelector('nav button');
    const videoTab = root.querySelector('[vid="94"]');
    const audioTab = root.querySelector('[vid="95"]');
    const thumbnail = root.querySelector('[vid="76"]');
    const thumbnailSkeleton = root.querySelector('[vid="77"]');
    const thumbnailOverlay = root.querySelector('[vid="78"]');
    const durationBadge = root.querySelector('[vid="83"]');
    const platformBadge = root.querySelector('[vid="84"]');
    const title = root.querySelector('[vid="86"]');
    const uploader = root.querySelector('[vid="88"]');
    const views = root.querySelector('[vid="90"]');
    const date = root.querySelector('[vid="92"]');
    const rows = root.querySelector('[vid="96"]');
    const progressText = root.querySelector('[vid="117"]');
    const progressFill = root.querySelector('[vid="120"]');
    const progressCancelButton = root.querySelector('[vid="118"]');
    const toast = root.querySelector('.fixed.bottom-6.right-6');
    const toastTitle = root.querySelector('[vid="235"]');
    const toastFile = root.querySelector('[vid="236"]');
    const toastClose = toast?.querySelector('button');

    const setErrorVisible = (visible, message = 'Could not detect a valid URL. Please check your link and try again.') => {
      if (errorText) errorText.textContent = message;
      error?.classList.toggle('hidden', !visible);
    };

    const setResultVisible = (visible) => {
      resultSection?.classList.toggle('hidden', !visible);
    };

    const setProgressVisible = (visible, label = 'Fetching media streams...', width = '33%', onCancel = null) => {
      progressCard?.classList.toggle('hidden', !visible);
      if (progressText) progressText.textContent = label;
      if (progressFill) progressFill.style.width = width;
      state.progressCancel = visible ? onCancel : null;
    };

    const setToastVisible = (visible, heading = 'Download Started', file = 'MediaPull download') => {
      if (!toast) return;
      if (toastTitle) toastTitle.textContent = heading;
      if (toastFile) toastFile.textContent = file;
      toast.classList.toggle('opacity-100', visible);
      toast.classList.toggle('opacity-0', !visible);
      toast.classList.toggle('translate-y-0', visible);
      toast.classList.toggle('translate-y-6', !visible);
      toast.classList.toggle('pointer-events-none', !visible);
    };

    const ensureToastStack = () => {
      let stack = root.querySelector('.js-toast-stack');
      if (stack) return stack;

      stack = document.createElement('div');
      stack.className = 'js-toast-stack fixed bottom-6 right-6 z-[120] flex flex-col gap-3 items-end max-w-[calc(100vw-48px)]';
      root.appendChild(stack);
      return stack;
    };

    const createDownloadToast = (file, onCancel) => {
      const stack = ensureToastStack();
      const item = document.createElement('div');
      let settled = false;
      item.className = 'bg-mediapull-elevated border border-mediapull-border rounded-lg card-shadow p-3 pr-8 flex items-center gap-3 relative overflow-hidden min-w-[320px] max-w-full transition-all duration-300';
      item.innerHTML = `
        <div class="js-toast-accent w-1 h-full absolute left-0 top-0 bg-mediapull-red transition-all duration-300"></div>
        <div class="w-8 h-8 rounded bg-mediapull-red/10 flex items-center justify-center text-mediapull-red">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <span class="js-toast-title text-[11px] font-bold text-white uppercase">Preparing Download</span>
          <span class="text-[10px] text-[#9090A0] font-mono truncate">${escapeHtml(file)}</span>
          <div class="mt-2 h-1.5 bg-mediapull-card rounded-full overflow-hidden border border-mediapull-border">
            <div class="js-toast-progress h-full bg-mediapull-red rounded-full transition-all duration-300" style="width: 8%"></div>
          </div>
        </div>
        <button class="js-toast-close absolute top-2 right-2 text-[#55555F] hover:text-[#F0F0F2]">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"></line><line x1="6" x2="18" y1="6" y2="18"></line></svg>
        </button>
      `;

      stack.prepend(item);
      item.querySelector('.js-toast-close')?.addEventListener('click', () => {
        if (settled) {
          item.remove();
          return;
        }
        onCancel?.();
      });

      const titleNode = item.querySelector('.js-toast-title');
      const progressNode = item.querySelector('.js-toast-progress');
      const accentNode = item.querySelector('.js-toast-accent');

      return {
        update(percent, label = 'Downloading') {
          const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
          if (settled) return;
          if (titleNode) titleNode.textContent = `${label} ${safePercent}%`;
          if (progressNode) progressNode.style.width = `${safePercent}%`;
          if (accentNode) {
            accentNode.style.background = `linear-gradient(to bottom, #E8383A ${safePercent}%, #2A2A2E ${safePercent}%)`;
          }
        },
        complete(label = 'Download Completed') {
          settled = true;
          if (titleNode) titleNode.textContent = label;
          if (progressNode) progressNode.style.width = '100%';
          if (accentNode) accentNode.style.background = '#22c55e';
          window.setTimeout(() => item.classList.add('opacity-90'), 500);
        },
        fail(message = 'Download Failed') {
          settled = true;
          if (titleNode) titleNode.textContent = message;
          if (progressNode) {
            progressNode.style.width = '100%';
            progressNode.style.background = '#f59e0b';
          }
          if (accentNode) accentNode.style.background = '#f59e0b';
        },
        cancel() {
          settled = true;
          if (titleNode) titleNode.textContent = 'Download Canceled';
          if (progressNode) {
            progressNode.style.width = '100%';
            progressNode.style.background = '#55555F';
          }
          if (accentNode) accentNode.style.background = '#55555F';
          window.setTimeout(() => item.remove(), 1800);
        },
      };
    };

    const setResultCardVisible = (visible) => {
      resultCard?.classList.toggle('hidden', !visible);
    };

    const setSkeletonVisible = (visible) => {
      skeletonCard?.classList.toggle('hidden', !visible);
    };

    const setTab = (tabName) => {
      state.activeTab = tabName;
      const activeClasses = ['border-b-2', 'border-mediapull-red', 'text-white'];
      const inactiveClasses = ['text-[#9090A0]'];

      [
        [videoTab, 'video'],
        [audioTab, 'audio'],
      ].forEach(([tab, name]) => {
        if (!tab) return;
        tab.classList.remove(...activeClasses, ...inactiveClasses);
        tab.classList.add(...(name === tabName ? activeClasses : inactiveClasses));
      });

      renderRows();
    };

    const renderRows = () => {
      if (!rows) return;
      const formats = state.formats[state.activeTab] || [];
      rows.innerHTML = formats.length
        ? formats.map(formatRow).join('')
        : '<div class="p-2.5 rounded bg-mediapull-surface/50 border border-transparent text-[11px] font-mono text-[#9090A0]">No formats returned for this tab.</div>';
    };

    const applyMetadata = (metadata) => {
      state.metadata = metadata;
      state.formats = metadata.formats || { video: [], audio: [] };

      if (title) title.textContent = metadata.title || 'Untitled media';
      if (uploader) uploader.textContent = metadata.uploader || metadata.platform || 'MediaPull';
      if (views) views.textContent = metadata.viewCount || (metadata.isCollection ? `${metadata.entryCount} Items` : metadata.platform);
      if (date) date.textContent = metadata.date || 'Ready';
      if (durationBadge) durationBadge.textContent = metadata.duration || (metadata.isCollection ? `${metadata.entryCount} files` : 'Ready');
      if (platformBadge) platformBadge.textContent = metadata.mediaType
        ? `${metadata.platform} ${metadata.mediaType}`
        : metadata.platform || 'Media';

      thumbnail?.querySelector('.js-preview-media')?.remove();
      const firstVideoFormat = (metadata.formats?.video || []).find((format) => format.directUrl && format.ext === 'mp4');
      const proxiedThumbnail = metadata.thumbnail
        ? apiUrl(`/api/media?url=${encodeURIComponent(metadata.thumbnail)}`)
        : '';
      const proxiedVideo = firstVideoFormat?.directUrl
        ? apiUrl(`/api/media?url=${encodeURIComponent(firstVideoFormat.directUrl)}`)
        : '';

      if (thumbnail && proxiedVideo && metadata.platform !== 'YouTube') {
        thumbnail.style.backgroundImage = '';
        const video = document.createElement('video');
        video.className = 'js-preview-media absolute inset-0 w-full h-full object-cover';
        video.src = proxiedVideo;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.controls = true;
        video.preload = 'metadata';
        thumbnail.prepend(video);
        thumbnailSkeleton?.classList.add('hidden');
        thumbnailOverlay?.classList.add('hidden');
      } else if (thumbnail && proxiedThumbnail) {
        thumbnail.style.backgroundImage = `url("${proxiedThumbnail}")`;
        thumbnail.style.backgroundSize = 'cover';
        thumbnail.style.backgroundPosition = 'center';
        thumbnailSkeleton?.classList.add('hidden');
        thumbnailOverlay?.classList.add('hidden');
      } else if (thumbnail) {
        thumbnail.style.backgroundImage = '';
        thumbnailSkeleton?.classList.remove('hidden');
        thumbnailOverlay?.classList.remove('hidden');
      }

      setResultVisible(true);
      setResultCardVisible(true);
      setSkeletonVisible(false);
      setTab(metadata.isCollection ? 'video' : 'video');
    };

    const handleSubmit = async () => {
      const url = input?.value?.trim() ?? '';
      if (!isSupportedUrl(url)) {
        setErrorVisible(true);
        setResultVisible(false);
        setToastVisible(false);
        return;
      }

      state.probeController?.abort();
      const probeController = new AbortController();
      state.probeController = probeController;

      setErrorVisible(false);
      setResultVisible(true);
      setResultCardVisible(false);
      setSkeletonVisible(true);
      setProgressVisible(true, 'Analyzing URL and fetching available formats...', '45%', () => probeController.abort());
      setToastVisible(false);

      try {
        const response = await fetch(apiUrl('/api/probe'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: probeController.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not fetch media formats.');
        applyMetadata(payload);
        setProgressVisible(false);
      } catch (errorMessage) {
        setProgressVisible(false);
        setSkeletonVisible(false);
        if (errorMessage.name === 'AbortError') {
          setErrorVisible(false);
          if (state.metadata) {
            setResultVisible(true);
            setResultCardVisible(true);
          } else {
            setResultVisible(false);
          }
          return;
        }
        setResultVisible(false);
        setErrorVisible(true, errorMessage.message || 'Could not fetch media formats.');
      } finally {
        if (state.probeController === probeController) {
          state.probeController = null;
        }
      }
    };

    const saveBlob = (blob, filename) => {
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename || 'mediapull-download';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
    };

    const handleFormatDownload = async (event) => {
      const button = event.target.closest('.js-format-download');
      if (!button || !state.metadata) return;

      const formats = state.formats[state.activeTab] || [];
      const format = formats[Number(button.dataset.formatIndex)];
      if (!format) return;

      const expectedName = `${state.metadata.title || 'MediaPull'}.${format.ext || 'mp4'}`;
      const downloadController = new AbortController();
      state.activeDownloads.add(downloadController);
      const downloadToast = createDownloadToast(expectedName, () => downloadController.abort());
      let stagedProgress = 8;
      const prepTimer = window.setInterval(() => {
        stagedProgress = Math.min(64, stagedProgress + 4);
        downloadToast.update(stagedProgress, 'Preparing');
        setProgressVisible(true, `Preparing ${format.label} download...`, `${stagedProgress}%`, () => downloadController.abort());
      }, 900);

      setProgressVisible(true, `Preparing ${format.label} download...`, '8%', () => downloadController.abort());
      setToastVisible(false);

      const downloadPayload = {
        url: state.metadata.sourceUrl,
        selector: format.selector,
        kind: format.kind || state.activeTab,
        ext: format.ext || 'mp4',
        title: state.metadata.title || 'mediapull-download',
      };
      if (format.audioFormat) downloadPayload.audioFormat = format.audioFormat;
      if (format.audioQuality) downloadPayload.audioQuality = format.audioQuality;
      if (format.directUrl) downloadPayload.directUrl = format.directUrl;
      if (format.directUrls) downloadPayload.directUrls = format.directUrls;

      try {
        const response = await fetch(apiUrl('/api/download'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(downloadPayload),
          signal: downloadController.signal,
        });
        window.clearInterval(prepTimer);
        if (!response.ok) {
          let message = 'Download failed.';
          try {
            const payload = await response.json();
            message = payload.error || message;
          } catch {
            message = response.statusText || message;
          }
          throw new Error(message);
        }

        const total = Number(response.headers.get('content-length') || 0);
        const filename = parseFilenameFromDisposition(response.headers.get('content-disposition')) || expectedName;

        if (!response.body) {
          const blob = await response.blob();
          downloadToast.update(100);
          saveBlob(blob, filename);
          downloadToast.complete();
          setProgressVisible(false);
          return;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        let done = false;
        while (!done) {
          const read = await reader.read();
          done = read.done;
          if (read.value) {
            chunks.push(read.value);
            received += read.value.byteLength;
            const transferPercent = total ? Math.round((received / total) * 100) : Math.min(95, 65 + Math.round(received / 250000));
            downloadToast.update(transferPercent, 'Downloading');
            setProgressVisible(true, `Downloading ${format.label}...`, `${transferPercent}%`, () => downloadController.abort());
          }
        }

        const blob = new Blob(chunks);
        saveBlob(blob, filename);
        downloadToast.complete();
        setProgressVisible(false);
      } catch (errorMessage) {
        window.clearInterval(prepTimer);
        if (errorMessage.name === 'AbortError') {
          downloadToast.cancel();
          setProgressVisible(false);
          setErrorVisible(false);
          return;
        }
        downloadToast.fail(errorMessage.message || 'Download Failed');
        setProgressVisible(false);
        setErrorVisible(true, errorMessage.message || 'Download failed.');
      } finally {
        state.activeDownloads.delete(downloadController);
      }
    };

    const handlePaste = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (input && text) {
          input.value = text;
          input.focus();
        }
      } catch {
        input?.focus();
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
      }
    };

    const handleThemeToggle = () => {
      const light = !root.classList.contains('mediapull-light');
      root.classList.toggle('mediapull-light', light);
      document.body.classList.toggle('mediapull-light-body', light);
      window.localStorage.setItem('mediapull-theme', light ? 'light' : 'dark');
    };

    const handleProgressCancel = () => {
      state.progressCancel?.();
    };

    const savedTheme = window.localStorage.getItem('mediapull-theme');
    if (savedTheme === 'light') {
      root.classList.add('mediapull-light');
      document.body.classList.add('mediapull-light-body');
    }

    setResultVisible(false);
    setResultCardVisible(false);
    setSkeletonVisible(false);
    setProgressVisible(false);
    setToastVisible(false);
    setErrorVisible(false);

    primaryDownloadButton?.addEventListener('click', handleSubmit);
    pasteButton?.addEventListener('click', handlePaste);
    videoTab?.addEventListener('click', () => setTab('video'));
    audioTab?.addEventListener('click', () => setTab('audio'));
    toastClose?.addEventListener('click', () => setToastVisible(false));
    input?.addEventListener('keydown', handleKeyDown);
    progressCancelButton?.addEventListener('click', handleProgressCancel);
    themeButton?.addEventListener('click', handleThemeToggle);
    resultSection?.addEventListener('click', handleFormatDownload);

    return () => {
      state.probeController?.abort();
      state.activeDownloads.forEach((controller) => controller.abort());
      primaryDownloadButton?.removeEventListener('click', handleSubmit);
      pasteButton?.removeEventListener('click', handlePaste);
      input?.removeEventListener('keydown', handleKeyDown);
      progressCancelButton?.removeEventListener('click', handleProgressCancel);
      themeButton?.removeEventListener('click', handleThemeToggle);
      resultSection?.removeEventListener('click', handleFormatDownload);
    };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: design.styles }} />
      <style>
        {`
          .mediapull-design input[type="text"] {
            min-width: 0;
          }

          .mediapull-design .pointer-events-none {
            pointer-events: none;
          }

          body.mediapull-light-body {
            background: #f6f6f8 !important;
            color: #161618 !important;
          }

          .mediapull-light nav,
          .mediapull-light footer,
          .mediapull-light .bg-mediapull-bg\\/80 {
            background-color: rgba(255, 255, 255, 0.86) !important;
            border-color: #dedee4 !important;
            color: #161618 !important;
          }

          .mediapull-light .bg-mediapull-surface,
          .mediapull-light .bg-mediapull-surface\\/30,
          .mediapull-light .bg-mediapull-surface\\/50,
          .mediapull-light .bg-mediapull-card,
          .mediapull-light .bg-mediapull-elevated {
            background-color: #ffffff !important;
            border-color: #dedee4 !important;
          }

          .mediapull-light h1,
          .mediapull-light h2,
          .mediapull-light h3,
          .mediapull-light h4,
          .mediapull-light .font-display,
          .mediapull-light .text-white,
          .mediapull-light .text-\\[\\#F0F0F2\\] {
            color: #161618 !important;
          }

          .mediapull-light p,
          .mediapull-light .text-\\[\\#9090A0\\] {
            color: #5f6069 !important;
          }

          .mediapull-light .btn-primary,
          .mediapull-light .bg-mediapull-red,
          .mediapull-light .group:hover .group-hover\\:bg-mediapull-red {
            background-color: #e8383a !important;
            color: #ffffff !important;
          }

          @media (max-width: 640px) {
            .mediapull-design .fixed.bottom-6.right-6 {
              max-width: calc(100vw - 48px);
            }
          }
        `}
      </style>
      <div className="mediapull-design" ref={rootRef} dangerouslySetInnerHTML={{ __html: design.bodyMarkup }} />
    </>
  );
}
