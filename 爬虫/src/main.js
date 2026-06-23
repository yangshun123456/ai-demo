#!/usr/bin/env node

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { crawlNovel } = require('./crawlers/novel');
const { crawlVideo } = require('./crawlers/video');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DOWNLOAD_DIR = path.join(ROOT_DIR, 'downloads');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { ok: false, error: message });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getDownloadUrl(filePath) {
  const relative = path.relative(DOWNLOAD_DIR, filePath);
  if (relative.startsWith('..')) return '';
  return `/downloads/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
}

async function serveFile(res, filePath) {
  try {
    const extension = path.extname(filePath);
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream' });
    res.end(content);
  } catch (error) {
    sendError(res, error.code === 'ENOENT' ? 404 : 500, '文件不存在。');
  }
}

async function serveStatic(req, res, pathname) {
  const baseDir = pathname.startsWith('/downloads/') ? DOWNLOAD_DIR : PUBLIC_DIR;
  const relativePath = pathname.startsWith('/downloads/')
    ? decodeURIComponent(pathname.replace('/downloads/', ''))
    : decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1));
  const filePath = path.resolve(baseDir, relativePath);

  if (!filePath.startsWith(baseDir)) {
    sendError(res, 403, '没有权限访问该路径。');
    return;
  }

  await serveFile(res, filePath);
}

async function handleNovel(req, res) {
  const body = await readJsonBody(req);
  const logs = [];
  const result = await crawlNovel({
    url: body.url,
    out: body.out,
    chapterLinkSelector: body.chapterLinkSelector,
    contentSelector: body.contentSelector,
    titleSelector: body.titleSelector,
    start: Math.max(1, Math.trunc(toNumber(body.start, 1))),
    limit: Math.max(0, Math.trunc(toNumber(body.limit, 0))),
    delay: Math.max(0, Math.trunc(toNumber(body.delay, 600))),
    single: Boolean(body.single),
    outputDir: path.join(DOWNLOAD_DIR, 'novels'),
    onProgress(message) {
      logs.push(message);
    },
  });

  sendJson(res, 200, {
    ok: true,
    type: 'novel',
    outputPath: result.outputPath,
    downloadUrl: getDownloadUrl(result.outputPath),
    logs,
  });
}

async function handleVideo(req, res) {
  const body = await readJsonBody(req);
  const logs = [];
  const result = await crawlVideo({
    url: body.url,
    videoIndex: Math.max(0, Math.trunc(toNumber(body.videoIndex, 0))),
    outputDir: path.join(DOWNLOAD_DIR, 'videos'),
    onProgress(message) {
      const last = logs[logs.length - 1];
      if (String(message).startsWith('下载中:') && String(last || '').startsWith('下载中:')) {
        logs[logs.length - 1] = message;
        return;
      }
      if (last !== message) logs.push(message);
      if (logs.length > 300) logs.splice(0, logs.length - 300);
    },
  });

  const outputPath = typeof result.outputPath === 'string' ? result.outputPath : '';
  sendJson(res, 200, {
    ok: true,
    type: 'video',
    outputPath,
    downloadUrl: outputPath ? getDownloadUrl(outputPath) : '',
    result: result.outputPath,
    videos: result.videos,
    logs,
  });
}

async function route(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'POST' && pathname === '/api/novel') {
      await handleNovel(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/video') {
      await handleVideo(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res, pathname);
      return;
    }

    sendError(res, 405, '不支持的请求方法。');
  } catch (error) {
    sendError(res, 500, error.message || '服务异常。');
  }
}

async function main() {
  await fs.mkdir(path.join(DOWNLOAD_DIR, 'novels'), { recursive: true });
  await fs.mkdir(path.join(DOWNLOAD_DIR, 'videos'), { recursive: true });

  http.createServer(route).listen(PORT, HOST, () => {
    console.log(`爬虫主页面已启动: http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
