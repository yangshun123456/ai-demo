#!/usr/bin/env node

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { crawlNovel } = require('./crawlers/novel');
const { crawlVideo, getVideoResources } = require('./crawlers/video');

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

const jobs = new Map();
const videoResourceCache = new Map();

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
  const job = createJob('novel', async (addLog) => {
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
      onProgress: addLog,
    });

    return {
      type: 'novel',
      outputPath: result.outputPath,
      downloadUrl: getDownloadUrl(result.outputPath),
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
    const cached = body.resourceId ? videoResourceCache.get(body.resourceId) : null;
    if (body.resourceId && !cached) {
      throw new Error('视频资源已过期，请重新识别。');
    }

    const result = await crawlVideo({
      url: cached?.url || body.url,
      videos: cached?.videos,
      videoIndex: Math.max(0, Math.trunc(toNumber(body.videoIndex, 0))),
      outputDir: path.join(DOWNLOAD_DIR, 'videos'),
      onProgress: addLog,
    });
    const outputPath = typeof result.outputPath === 'string' ? result.outputPath : '';

    return {
      type: 'video',
      outputPath,
      downloadUrl: outputPath ? getDownloadUrl(outputPath) : '',
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

    if (req.method === 'GET' && pathname.startsWith('/api/jobs/')) {
      streamJob(req, res, pathname.replace('/api/jobs/', ''));
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
