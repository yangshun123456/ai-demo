#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { URL } = require('url');
const axios = require('axios');
const { chromium } = require('playwright');

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'downloads');

function printUsage() {
  console.log(`
用法:
  node index.js <网页URL> [输出目录]

示例:
  node index.js https://example.com/video-page
  node index.js https://example.com/video-page ./videos
`);
}

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

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

async function collectVideos(pageUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(pageUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    return await page.evaluate((currentUrl) => {
      const toAbsoluteUrl = (src) => {
        if (!src) return '';
        try {
          return new URL(src, currentUrl).href;
        } catch {
          return src;
        }
      };

      return Array.from(document.querySelectorAll('video'))
        .flatMap((video, videoIndex) => {
          const candidates = [];

          if (video.currentSrc || video.src) {
            candidates.push({
              videoIndex,
              src: video.currentSrc || video.src,
              type: video.getAttribute('type') || '',
              poster: video.poster || '',
            });
          }

          video.querySelectorAll('source').forEach((source) => {
            candidates.push({
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
    }, pageUrl);
  } finally {
    await browser.close();
  }
}

function uniqueVideos(videos) {
  const seen = new Set();

  return videos.filter((video) => {
    if (seen.has(video.src)) return false;
    seen.add(video.src);
    return true;
  });
}

async function selectVideo(videos) {
  if (videos.length === 1) {
    return videos[0];
  }

  console.log('检测到多个视频资源:');
  videos.forEach((video, index) => {
    console.log(
      `${index + 1}. ${video.src}${video.type ? ` (${video.type})` : ''}`,
    );
  });

  while (true) {
    const answer = await askQuestion(`请选择要下载的视频序号 (1-${videos.length}): `);
    const selectedIndex = Number.parseInt(answer, 10) - 1;

    if (selectedIndex >= 0 && selectedIndex < videos.length) {
      return videos[selectedIndex];
    }

    console.log('输入无效，请重新输入。');
  }
}

async function downloadVideo(videoUrl, outputDir, index = 0, referer = videoUrl) {
  fs.mkdirSync(outputDir, { recursive: true });

  const fileName = getFileNameFromUrl(videoUrl, index);
  const outputPath = path.join(outputDir, fileName);
  const response = await axios({
    method: 'GET',
    url: videoUrl,
    responseType: 'stream',
    timeout: 120000,
    headers: {
      Referer: referer,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    },
  });

  const totalLength = Number(response.headers['content-length'] || 0);
  let downloadedLength = 0;

  response.data.on('data', (chunk) => {
    downloadedLength += chunk.length;

    if (totalLength) {
      const percent = ((downloadedLength / totalLength) * 100).toFixed(2);
      process.stdout.write(
        `\r下载中: ${percent}% (${formatBytes(downloadedLength)} / ${formatBytes(totalLength)})`,
      );
    } else {
      process.stdout.write(`\r下载中: ${formatBytes(downloadedLength)}`);
    }
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);

    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  process.stdout.write('\n');
  return outputPath;
}

async function crawlVideo(pageUrl, outputDir = DEFAULT_OUTPUT_DIR) {
  const videos = uniqueVideos(await collectVideos(pageUrl));

  if (videos.length === 0) {
    throw new Error('当前网页没有识别到 video 标签或 source 视频地址。');
  }

  const selectedVideo = await selectVideo(videos);
  const resolvedVideoUrl = resolveUrl(selectedVideo.src, pageUrl);

  console.log(`开始下载: ${resolvedVideoUrl}`);
  return downloadVideo(
    resolvedVideoUrl,
    path.resolve(outputDir),
    videos.indexOf(selectedVideo),
    pageUrl,
  );
}

async function main() {
  const [, , pageUrl, outputDir = DEFAULT_OUTPUT_DIR] = process.argv;

  if (!pageUrl) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const savedPath = await crawlVideo(pageUrl, outputDir);
    console.log(`下载完成: ${savedPath}`);
  } catch (error) {
    console.error(`下载失败: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectVideos,
  crawlVideo,
  downloadVideo,
};
