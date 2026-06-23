const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const axios = require('axios');
const { chromium } = require('playwright');

function resolveUrl(src, pageUrl) {
  if (!src) return '';
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return src;
  }
}

function getFileNameFromUrl(videoUrl, index) {
  const parsedUrl = new URL(videoUrl);
  const baseName = path.basename(parsedUrl.pathname);
  const cleanName = decodeURIComponent(baseName).replace(/[<>:"/\\|?*]/g, '_');

  if (cleanName && path.extname(cleanName)) {
    return cleanName;
  }

  return `video-${index + 1}.mp4`;
}

function getSafeFileName(name, fallback) {
  const cleanName = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_');

  return cleanName || fallback;
}

function formatBytes(bytes) {
  if (!bytes) return '未知大小';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function getBilibiliQualityName(playInfo, qualityId) {
  const data = playInfo?.data || playInfo?.result || {};
  const qualities = data.accept_quality || [];
  const descriptions = data.accept_description || [];
  const qualityIndex = qualities.indexOf(qualityId);

  if (qualityIndex >= 0 && descriptions[qualityIndex]) {
    return descriptions[qualityIndex];
  }

  return qualityId ? `${qualityId}P` : '未知清晰度';
}

function getBilibiliPlayInfoVideos(playInfo) {
  const data = playInfo?.data || playInfo?.result || {};
  const dash = data.dash;

  if (!dash?.video?.length) return [];

  const bestAudio = [...(dash.audio || [])].sort(
    (a, b) => (b.bandwidth || 0) - (a.bandwidth || 0),
  )[0];

  return dash.video
    .map((video, index) => {
      const videoUrl =
        video.baseUrl || video.base_url || video.backupUrl?.[0] || video.backup_url?.[0];
      const audioUrl = bestAudio
        ? bestAudio.baseUrl ||
          bestAudio.base_url ||
          bestAudio.backupUrl?.[0] ||
          bestAudio.backup_url?.[0]
        : '';

      return {
        kind: 'bilibili-dash',
        videoIndex: index,
        src: videoUrl,
        audioSrc: audioUrl,
        type: video.mimeType || video.mime_type || 'video/mp4',
        codec: video.codecs || '',
        bandwidth: video.bandwidth || 0,
        width: video.width || 0,
        height: video.height || 0,
        quality: getBilibiliQualityName(playInfo, video.id),
      };
    })
    .filter((video) => video.src);
}

function getBilibiliProgressiveVideos(playInfo) {
  const data = playInfo?.data || playInfo?.result || {};
  const durl = Array.isArray(data.durl) ? data.durl : [];
  const segments = durl.map((segment) => segment.url).filter(Boolean);

  if (!segments.length) return [];

  return [
    {
      kind: 'bilibili-progressive',
      videoIndex: 0,
      src: segments[0],
      backupUrls: durl[0].backup_url || durl[0].backupUrl || [],
      segments: durl.map((segment) => segment.url).filter(Boolean),
      size: durl.reduce((total, item) => total + Number(item.size || 0), 0),
      quality: getBilibiliQualityName(playInfo, data.quality),
    },
  ];
}

async function collectVideos(pageUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(pageUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    const videos = await page.evaluate(async (currentUrl) => {
      const toAbsoluteUrl = (src) => {
        if (!src) return '';
        try {
          return new URL(src, currentUrl).href;
        } catch {
          return src;
        }
      };

      const tagVideos = Array.from(document.querySelectorAll('video'))
        .flatMap((video, videoIndex) => {
          const candidates = [];

          if (video.currentSrc || video.src) {
            candidates.push({
              kind: 'direct',
              videoIndex,
              src: video.currentSrc || video.src,
              type: video.getAttribute('type') || '',
              poster: video.poster || '',
            });
          }

          video.querySelectorAll('source').forEach((source) => {
            candidates.push({
              kind: 'direct',
              videoIndex,
              src: source.src || source.getAttribute('src') || '',
              type: source.type || source.getAttribute('type') || '',
              poster: video.poster || '',
            });
          });

          return candidates;
        })
        .filter((item) => item.src)
        .map((item) => ({
          ...item,
          src: toAbsoluteUrl(item.src),
          poster: toAbsoluteUrl(item.poster),
        }));

      const initialState = window.__INITIAL_STATE__ || null;
      let playInfo = window.__playinfo__ || null;
      let progressivePlayInfo = null;

      if (!playInfo && initialState?.videoData?.bvid) {
        const videoData = initialState.videoData;
        const cid = videoData.cid || videoData.pages?.[0]?.cid;

        if (cid) {
          try {
            const progressiveUrl =
              'https://api.bilibili.com/x/player/wbi/playurl' +
              `?bvid=${encodeURIComponent(videoData.bvid)}` +
              `&cid=${encodeURIComponent(cid)}` +
              '&qn=80&fnval=0&fourk=1';
            const response = await fetch(progressiveUrl, { credentials: 'include' });
            const result = await response.json();
            if (result.code === 0 && result.data) progressivePlayInfo = result;
          } catch {
            progressivePlayInfo = null;
          }

          try {
            const dashUrl =
              'https://api.bilibili.com/x/player/wbi/playurl' +
              `?bvid=${encodeURIComponent(videoData.bvid)}` +
              `&cid=${encodeURIComponent(cid)}` +
              '&qn=127&fnval=4048&fourk=1';
            const response = await fetch(dashUrl, { credentials: 'include' });
            const result = await response.json();
            if (result.code === 0 && result.data) playInfo = result;
          } catch {
            playInfo = null;
          }
        }
      }

      return { playInfo, progressivePlayInfo, tagVideos };
    }, pageUrl);

    const cookieHeader = (await page.context().cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
    const progressiveVideos = getBilibiliProgressiveVideos(videos.progressivePlayInfo);
    const bilibiliVideos = getBilibiliPlayInfoVideos(videos.playInfo);

    return [...videos.tagVideos, ...progressiveVideos, ...bilibiliVideos].map((video) => ({
      ...video,
      pageUrl,
      cookieHeader,
    }));
  } finally {
    await browser.close();
  }
}

function uniqueVideos(videos) {
  const seen = new Set();

  return videos.filter((video) => {
    const key = `${video.kind}:${video.src}:${video.audioSrc || ''}`;
    if (!video.src || (video.kind === 'direct' && video.src.startsWith('blob:'))) {
      return false;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeVideo(video) {
  if (video.kind === 'bilibili-progressive') {
    const segmentText = video.segments?.length > 1 ? `, ${video.segments.length} 段` : '';
    return `Bilibili 完整视频 ${video.quality || ''}${segmentText}${
      video.size ? `, ${formatBytes(video.size)}` : ''
    }`;
  }

  if (video.kind === 'bilibili-dash') {
    const size = video.width && video.height ? `${video.width}x${video.height}` : '未知尺寸';
    const bandwidth = video.bandwidth ? `, ${formatBytes(video.bandwidth)}/s` : '';
    return `Bilibili DASH ${video.quality || ''} ${size}${bandwidth}${
      video.codec ? `, ${video.codec}` : ''
    }`;
  }

  return `${video.src}${video.type ? ` (${video.type})` : ''}`;
}

function getRequestHeaders(referer, cookieHeader = '') {
  return {
    Referer: referer,
    Origin: new URL(referer).origin,
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
}

async function downloadToFile(
  videoUrl,
  outputPath,
  referer = videoUrl,
  cookieHeader = '',
  onProgress,
  append = false,
) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const response = await axios({
    method: 'GET',
    url: videoUrl,
    responseType: 'stream',
    timeout: 120000,
    headers: getRequestHeaders(referer, cookieHeader),
  });

  const totalLength = Number(response.headers['content-length'] || 0);
  let downloadedLength = 0;

  response.data.on('data', (chunk) => {
    downloadedLength += chunk.length;
    if (onProgress) {
      onProgress(
        totalLength
          ? `下载中: ${((downloadedLength / totalLength) * 100).toFixed(2)}% (${formatBytes(
              downloadedLength,
            )} / ${formatBytes(totalLength)})`
          : `下载中: ${formatBytes(downloadedLength)}`,
      );
    }
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath, append ? { flags: 'a' } : undefined);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  return outputPath;
}

async function downloadVideo(videoUrl, outputDir, index = 0, referer = videoUrl, cookieHeader = '', onProgress) {
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = getFileNameFromUrl(videoUrl, index);
  return downloadToFile(
    videoUrl,
    path.join(outputDir, fileName),
    referer,
    cookieHeader,
    onProgress,
  );
}

async function downloadBilibiliDash(video, outputDir, index, referer, onProgress) {
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = getSafeFileName(`bilibili-${video.quality || index + 1}`, `bilibili-${index + 1}`);
  const videoPath = path.join(outputDir, `${baseName}.video.m4s`);
  const audioPath = path.join(outputDir, `${baseName}.audio.m4s`);

  onProgress(`开始下载视频流: ${video.quality || index + 1}`);
  await downloadToFile(video.src, videoPath, referer, video.cookieHeader, onProgress);

  if (video.audioSrc) {
    onProgress('开始下载音频流');
    await downloadToFile(video.audioSrc, audioPath, referer, video.cookieHeader, onProgress);
  }

  throw new Error(
    `当前只识别到 DASH 分离流，已保存 m4s 到 ${outputDir}。不使用 ffmpeg 时无法把独立音频轨和视频轨封装成一个 mp4，请选择“Bilibili 完整视频”资源序号重试。`,
  );
}

async function downloadBilibiliProgressive(video, outputDir, index, referer, onProgress) {
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = getSafeFileName(`bilibili-${video.quality || index + 1}`, `bilibili-${index + 1}`);
  const outputPath = path.join(outputDir, `${baseName}.mp4`);
  const segments = video.segments?.length ? video.segments : [video.src];

  for (let i = 0; i < segments.length; i += 1) {
    onProgress(
      segments.length > 1
        ? `开始下载完整视频分段 ${i + 1}/${segments.length}`
        : '开始下载完整视频',
    );
    await downloadToFile(
      resolveUrl(segments[i], referer),
      outputPath,
      referer,
      video.cookieHeader,
      onProgress,
      i > 0,
    );
  }

  return outputPath;
}

async function getVideoResources(url, onProgress = () => {}) {
  if (!url) throw new Error('请填写视频网页链接。');

  onProgress('正在打开网页并识别视频资源。');
  const videos = uniqueVideos(await collectVideos(url));
  if (videos.length === 0) {
    throw new Error('当前网页没有识别到 video 标签或 source 视频地址。');
  }

  onProgress('识别到的视频资源:');
  videos.forEach((video, resourceIndex) => {
    onProgress(`${resourceIndex}. ${describeVideo(video)}`);
  });

  return {
    videos,
    resources: videos.map((video, index) => ({
      index,
      label: describeVideo(video),
      kind: video.kind,
    })),
  };
}

async function downloadSelectedVideo(options, videos) {
  const index = Math.min(Math.max(Number(options.videoIndex) || 0, 0), videos.length - 1);
  const selectedVideo = videos[index];
  const resolvedVideoUrl = resolveUrl(selectedVideo.src, options.url);
  const resolvedOutputDir = path.resolve(options.outputDir);

  options.onProgress(`已选择资源: ${describeVideo(selectedVideo)}`);

  if (selectedVideo.kind === 'bilibili-progressive') {
    const outputPath = await downloadBilibiliProgressive(
      {
        ...selectedVideo,
        src: resolvedVideoUrl,
      },
      resolvedOutputDir,
      index,
      options.url,
      options.onProgress,
    );
    return { outputPath, videos: videos.map(describeVideo) };
  }

  if (selectedVideo.kind === 'bilibili-dash') {
    const result = await downloadBilibiliDash(
      {
        ...selectedVideo,
        src: resolvedVideoUrl,
        audioSrc: resolveUrl(selectedVideo.audioSrc, options.url),
      },
      resolvedOutputDir,
      index,
      options.url,
      options.onProgress,
    );
    return { outputPath: result, videos: videos.map(describeVideo) };
  }

  const outputPath = await downloadVideo(
    resolvedVideoUrl,
    resolvedOutputDir,
    index,
    options.url,
    selectedVideo.cookieHeader,
    options.onProgress,
  );
  return { outputPath, videos: videos.map(describeVideo) };
}

async function crawlVideo(userOptions) {
  const options = {
    url: '',
    outputDir: path.resolve(process.cwd(), 'downloads/videos'),
    videoIndex: 0,
    onProgress: () => {},
    ...userOptions,
  };

  if (!options.url) throw new Error('请填写视频网页链接。');

  const videos = options.videos || (await getVideoResources(options.url, options.onProgress)).videos;
  return downloadSelectedVideo(options, videos);
}

module.exports = {
  collectVideos,
  crawlVideo,
  downloadVideo,
  getVideoResources,
};
