#!/usr/bin/env node

const http = require('http');
const fsSync = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { URL } = require('url');
const { crawlNovel } = require('./crawlers/novel');
const { crawlVideo, getVideoResources } = require('./crawlers/video');
const { crawlSales, loginSalesPlatform } = require('./crawlers/sales');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DOWNLOAD_DIR = path.join(ROOT_DIR, 'downloads');
const TEMP_DOWNLOAD_DIR = path.join(os.tmpdir(), 'crawler-suite-downloads');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
};

const jobs = new Map();
const videoResourceCache = new Map();
const browserDownloads = new Map();

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

async function createBrowserOutputDir(type) {
  await fs.mkdir(TEMP_DOWNLOAD_DIR, { recursive: true });
  return fs.mkdtemp(path.join(TEMP_DOWNLOAD_DIR, `${type}-`));
}

function registerBrowserDownload(filePath, cleanupDir = path.dirname(filePath)) {
  const id = randomUUID();
  const timeout = setTimeout(() => {
    cleanupBrowserDownload(id);
  }, 60 * 60 * 1000);

  browserDownloads.set(id, {
    filePath,
    cleanupDir,
    timeout,
  });

  return `/api/downloads/${encodeURIComponent(id)}`;
}

function cleanupBrowserDownload(id) {
  const item = browserDownloads.get(id);
  if (!item) return;

  clearTimeout(item.timeout);
  browserDownloads.delete(id);
  fs.rm(item.cleanupDir, { recursive: true, force: true }).catch(() => {});
}

function getAttachmentFileName(filePath) {
  const fileName = path.basename(filePath);
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function createJob(type, runner) {
  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    status: 'running',
    logs: [],
    result: null,
    error: '',
    clients: new Set(),
    createdAt: Date.now(),
  };

  jobs.set(job.id, job);

  const push = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of job.clients) {
      client.write(payload);
    }
  };

  const addLog = (message) => {
    const text = String(message);
    const last = job.logs[job.logs.length - 1];
    if (text.startsWith('下载中:') && String(last || '').startsWith('下载中:')) {
      job.logs[job.logs.length - 1] = text;
    } else if (last !== text) {
      job.logs.push(text);
    }
    if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300);
    push('progress', { message: text, logs: job.logs, status: job.status });
  };

  runner(addLog)
    .then((result) => {
      job.status = 'done';
      job.result = result;
      push('done', { status: job.status, result, logs: job.logs });
      closeJobClients(job);
    })
    .catch((error) => {
      job.status = 'error';
      job.error = error.message || '任务失败';
      push('error', { status: job.status, error: job.error, logs: job.logs });
      closeJobClients(job);
    });

  return job;
}

function closeJobClients(job) {
  setTimeout(() => {
    for (const client of job.clients) {
      client.end();
    }
    job.clients.clear();
  }, 300);
}

function streamJob(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    sendError(res, 404, '任务不存在。');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify({
    status: job.status,
    logs: job.logs,
    result: job.result,
    error: job.error,
  })}\n\n`);

  if (job.status !== 'running') {
    res.end();
    return;
  }

  job.clients.add(res);
  req.on('close', () => {
    job.clients.delete(res);
  });
}

async function serveFile(res, filePath, attachment = false) {
  try {
    const extension = path.extname(filePath);
    const stats = await fs.stat(filePath);
    const headers = {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': stats.size,
    };
    if (attachment) {
      headers['Content-Disposition'] = getAttachmentFileName(filePath);
    }
    res.writeHead(200, headers);

    const stream = fsSync.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (error) {
    sendError(res, error.code === 'ENOENT' ? 404 : 500, '文件不存在。');
  }
}

async function serveBrowserDownload(res, id) {
  const item = browserDownloads.get(id);
  if (!item) {
    sendError(res, 404, '下载文件已过期，请重新执行任务。');
    return;
  }

  res.on('finish', () => cleanupBrowserDownload(id));
  await serveFile(res, item.filePath, true);
}

async function serveStatic(req, res, pathname) {
  const isDownload = pathname.startsWith('/downloads/');
  const baseDir = isDownload ? DOWNLOAD_DIR : PUBLIC_DIR;
  const relativePath = isDownload
    ? decodeURIComponent(pathname.replace('/downloads/', ''))
    : decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1));
  const filePath = path.resolve(baseDir, relativePath);

  if (!filePath.startsWith(baseDir)) {
    sendError(res, 403, '没有权限访问该路径。');
    return;
  }

  await serveFile(res, filePath, isDownload);
}

async function handleNovel(req, res) {
  const body = await readJsonBody(req);
  const job = createJob('novel', async (addLog) => {
    const outputDir = await createBrowserOutputDir('novel');
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
      outputDir,
      onProgress: addLog,
    }).catch(async (error) => {
      await fs.rm(outputDir, { recursive: true, force: true });
      throw error;
    });

    return {
      type: 'novel',
      outputPath: result.outputPath,
      downloadUrl: registerBrowserDownload(result.outputPath, outputDir),
      chapters: result.chapters,
    };
  });

  sendJson(res, 202, {
    ok: true,
    jobId: job.id,
  });
}

async function handleVideo(req, res) {
  const body = await readJsonBody(req);
  const job = createJob('video', async (addLog) => {
    const outputDir = await createBrowserOutputDir('video');
    const cached = body.resourceId ? videoResourceCache.get(body.resourceId) : null;
    if (body.resourceId && !cached) {
      await fs.rm(outputDir, { recursive: true, force: true });
      throw new Error('视频资源已过期，请重新识别。');
    }

    const result = await crawlVideo({
        url: cached?.url || body.url,
        videos: cached?.videos,
        videoIndex: Math.max(0, Math.trunc(toNumber(body.videoIndex, 0))),
        outputDir,
        onProgress: addLog,
      })
      .catch(async (error) => {
        await fs.rm(outputDir, { recursive: true, force: true });
        throw error;
      });
    const outputPath = typeof result.outputPath === 'string' ? result.outputPath : '';

    return {
      type: 'video',
      outputPath,
      downloadUrl: outputPath ? registerBrowserDownload(outputPath, outputDir) : '',
      result: result.outputPath,
      videos: result.videos,
    };
  });

  sendJson(res, 202, {
    ok: true,
    jobId: job.id,
  });
}

async function handleVideoResources(req, res) {
  const body = await readJsonBody(req);
  const job = createJob('video-resources', async (addLog) => {
    const result = await getVideoResources(body.url, addLog);
    const resourceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    videoResourceCache.set(resourceId, {
      url: body.url,
      videos: result.videos,
      createdAt: Date.now(),
    });

    return {
      type: 'video-resources',
      resourceId,
      resources: result.resources,
    };
  });

  sendJson(res, 202, {
    ok: true,
    jobId: job.id,
  });
}

async function handleSales(req, res) {
  const body = await readJsonBody(req);
  const job = createJob('sales', async (addLog) => {
    const result = await crawlSales({
      keyword: body.keyword,
      limit: Math.max(5, Math.trunc(toNumber(body.limit, 20))),
      storageDir: path.join(DOWNLOAD_DIR, 'sales'),
      onProgress: addLog,
    });

    return result;
  });

  sendJson(res, 202, {
    ok: true,
    jobId: job.id,
  });
}

async function handleSalesAuth(req, res) {
  const body = await readJsonBody(req);
  const job = createJob('sales-auth', async (addLog) => {
    const result = await loginSalesPlatform({
      platform: body.platform,
      storageDir: path.join(DOWNLOAD_DIR, 'sales'),
      onProgress: addLog,
    });

    return result;
  });

  sendJson(res, 202, {
    ok: true,
    jobId: job.id,
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

    if (req.method === 'POST' && pathname === '/api/video/resources') {
      await handleVideoResources(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/sales') {
      await handleSales(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/sales/auth') {
      await handleSalesAuth(req, res);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
      streamJob(req, res, pathname.replace('/api/jobs/', ''));
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/downloads/')) {
      await serveBrowserDownload(res, decodeURIComponent(pathname.replace('/api/downloads/', '')));
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
  await fs.mkdir(TEMP_DOWNLOAD_DIR, { recursive: true });
  await fs.mkdir(path.join(DOWNLOAD_DIR, 'sales'), { recursive: true });

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
