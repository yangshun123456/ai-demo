const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const DEFAULT_DELAY = 600;
const DEFAULT_TIMEOUT = 15000;
const BQG_API_HOSTS = ['https://apibi.cc', 'https://apiqu.cc', 'https://apige.cc'];
const BQG_TOKEN_SECRET = 'book@token.html';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CHAPTER_TEXT_HINTS = [
  '#content',
  '.content',
  '.chapter-content',
  '.chapterContent',
  '.read-content',
  '.readContent',
  '.article-content',
  '.book-content',
  '.text',
  '.txt',
  '.entry-content',
  'article',
];

const CHAPTER_TITLE_HINTS = ['h1', '.chapter-title', '.title', '.bookname h1'];
const BLOCK_SELECTOR =
  'script,style,noscript,iframe,header,footer,nav,.nav,.ads,.ad,.advertisement';

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getCharsetFromContentType(contentType = '') {
  const matched = String(contentType).match(/charset=([^;]+)/i);
  return matched ? matched[1].trim() : '';
}

function getCharsetFromHtml(html = '') {
  const direct = html.match(/<meta[^>]+charset=["']?\s*([^"'\s/>]+)/i);
  if (direct) return direct[1].trim();

  const httpEquiv = html.match(
    /<meta[^>]+content=["'][^"']*charset=([^"'\s;]+)[^"']*["'][^>]*>/i,
  );
  return httpEquiv ? httpEquiv[1].trim() : '';
}

function normalizeCharset(charset) {
  const value = String(charset).toLowerCase().replace(/["']/g, '').trim();
  if (value === 'gb2312' || value === 'gbk' || value === 'gb18030') {
    return 'gb18030';
  }
  return value || 'utf-8';
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    validateStatus(status) {
      return status >= 200 && status < 400;
    },
  });

  const buffer = Buffer.from(response.data);
  const headerCharset = getCharsetFromContentType(response.headers['content-type']);
  const preview = buffer.toString('ascii', 0, Math.min(buffer.length, 4096));
  const metaCharset = getCharsetFromHtml(preview);
  return iconv.decode(buffer, normalizeCharset(headerCharset || metaCharset || 'utf-8'));
}

function looksLikeChapter(title, pathname) {
  const compactTitle = title.replace(/\s/g, '');
  if (/^(上一章|下一章|目录|返回|首页|书架|推荐|排行|登录|注册)$/i.test(compactTitle)) {
    return false;
  }

  return (
    /第.{1,12}[章回节卷集]/.test(compactTitle) ||
    /chapter\s*\d+/i.test(compactTitle) ||
    /^\d{1,5}[.、\s_-]/.test(compactTitle) ||
    /\/\d+\.html?$/i.test(pathname) ||
    /chapter[-_/]?\d+/i.test(pathname)
  );
}

function parseChapterLinks(html, pageUrl, selector) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const links = [];
  const seen = new Set();
  const linkNodes = selector ? $(selector) : $('a');

  linkNodes.each((_, element) => {
    const $element = $(element);
    const href = $element.attr('href');
    const title = normalizeText($element.text());
    if (!href || !title) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, pageUrl);
    } catch {
      return;
    }

    if (!['http:', 'https:'].includes(absoluteUrl.protocol)) return;
    if (absoluteUrl.origin !== base.origin) return;
    absoluteUrl.hash = '';

    const url = absoluteUrl.toString();
    if (seen.has(url)) return;
    if (!selector && !looksLikeChapter(title, absoluteUrl.pathname)) return;

    seen.add(url);
    links.push({ title, url });
  });

  return links;
}

function pickText($, preferredSelector, fallbackSelectors) {
  const selectors = [preferredSelector, ...fallbackSelectors].filter(Boolean);
  for (const selector of selectors) {
    const text = normalizeText($(selector).first().text());
    if (text) return text;
  }
  return '';
}

function scoreContent(text) {
  const value = String(text || '');
  const chineseChars = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  const lineCount = value.split('\n').filter((line) => line.trim().length > 0).length;
  return chineseChars + lineCount * 20 + value.length * 0.1;
}

function isUsefulContent(text) {
  return scoreContent(text) >= 200;
}

function extractReadableText($, node) {
  if (!node || !node.length) return '';

  const html = node.clone().find(BLOCK_SELECTOR).remove().end().html();
  if (!html) return '';

  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\/\s*section\s*>/gi, '\n');

  return sanitizeText(cheerio.load(`<div>${withBreaks}</div>`).text());
}

function pickChapterContent($, preferredSelector) {
  const selectors = [preferredSelector, ...CHAPTER_TEXT_HINTS].filter(Boolean);

  for (const selector of selectors) {
    const text = extractReadableText($, $(selector).first());
    if (isUsefulContent(text)) return text;
  }

  let bestText = '';
  $('div,section,article,main').each((_, element) => {
    const text = extractReadableText($, $(element));
    if (scoreContent(text) > scoreContent(bestText)) {
      bestText = text;
    }
  });

  return isUsefulContent(bestText) ? bestText : '';
}

function parseChapter(html, pageUrl, options) {
  const $ = cheerio.load(html, { decodeEntities: false });
  $(BLOCK_SELECTOR).remove();

  const title = pickText($, options.titleSelector, CHAPTER_TITLE_HINTS) || pageUrl;
  const content = pickChapterContent($, options.contentSelector);
  if (!content) {
    throw new Error('没有识别到章节正文，请填写正文选择器后重试。');
  }

  return { title: sanitizeText(title), content };
}

function getSafeFileName(name) {
  return String(name || 'novel')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function getOutputFileName(out, title) {
  const baseName = out || `${getTimestamp()}_${getSafeFileName(title)}.txt`;
  const safeName = getSafeFileName(baseName);
  return path.extname(safeName) ? safeName : `${safeName}.txt`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function selectChapterRange(chapters, start, limit) {
  const fromIndex = start - 1;
  const selected = chapters.slice(fromIndex);
  return limit > 0 ? selected.slice(0, limit) : selected;
}

function getBqgBookId(url) {
  const matched = String(url).match(/(?:#\/book|\/book)\/(\d+)/i);
  return matched ? Number(matched[1]) : 0;
}

function createBqgToken(payload) {
  const code = crypto.createHash('md5').update(BQG_TOKEN_SECRET).digest('hex');
  const iv = Buffer.from(code.slice(0, 16), 'utf8');
  const key = Buffer.from(code.slice(16), 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

async function fetchBqgApi(endpoint, payload) {
  const token = encodeURIComponent(createBqgToken(payload));
  let lastError;

  for (const host of BQG_API_HOSTS) {
    try {
      const response = await axios.get(`${host}/api/${endpoint}?token=${token}`, {
        timeout: DEFAULT_TIMEOUT,
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'https://ff21f.bqg995.xyz/',
          Accept: 'application/json,text/plain,*/*',
        },
      });

      if (response.data && typeof response.data === 'object') {
        return response.data;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`笔趣阁接口请求失败: ${lastError ? lastError.message : endpoint}`);
}

async function crawlBqg(options, bookId, emit) {
  const book = await fetchBqgApi('book', { id: bookId });
  const dirId = Number(book.dirid || book.id || bookId);
  const chapterList = await fetchBqgApi('booklist', { id: dirId });
  const chapterNames = Array.isArray(chapterList.list) ? chapterList.list : [];

  if (!chapterNames.length) {
    throw new Error('笔趣阁接口没有返回章节列表。');
  }

  const selectedChapters = selectChapterRange(
    chapterNames.map((title, index) => ({ title, chapterId: index + 1 })),
    options.start,
    options.limit,
  );
  const output = [];

  emit(`识别到 ${chapterNames.length} 章，开始爬取 ${selectedChapters.length} 章。`);

  for (let i = 0; i < selectedChapters.length; i += 1) {
    const chapter = selectedChapters[i];
    const index = options.start + i;
    emit(`[${index}/${chapterNames.length}] ${chapter.title}`);

    const data = await fetchBqgApi('chapter', {
      id: dirId,
      chapterid: chapter.chapterId,
    });
    const title = data.chaptername || chapter.title || `第 ${index} 章`;
    const content = sanitizeText(data.txt || '');
    if (!content) throw new Error(`第 ${index} 章没有返回正文。`);

    output.push(`${title}\n\n${content}`);
    if (i < selectedChapters.length - 1 && options.delay > 0) await sleep(options.delay);
  }

  const fileName = getOutputFileName(options.out, book.title || `book_${bookId}`);
  const outputPath = path.join(options.outputDir, fileName);
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.writeFile(outputPath, output.join('\n\n\n'), 'utf8');
  return outputPath;
}

async function crawlNovel(userOptions) {
  const options = {
    url: '',
    out: '',
    chapterLinkSelector: '',
    contentSelector: '',
    titleSelector: '',
    delay: DEFAULT_DELAY,
    start: 1,
    limit: 0,
    single: false,
    outputDir: path.resolve(process.cwd(), 'downloads/novels'),
    onProgress: () => {},
    ...userOptions,
  };
  const emit = (message) => options.onProgress(String(message));

  if (!options.url) throw new Error('请填写小说目录页或章节页链接。');
  if (!Number.isInteger(options.start) || options.start < 1) {
    throw new Error('开始章节必须是大于等于 1 的整数。');
  }
  if (!Number.isInteger(options.limit) || options.limit < 0) {
    throw new Error('章节数量必须是大于等于 0 的整数。');
  }

  const bqgBookId = getBqgBookId(options.url);
  if (bqgBookId && /bqg995\.xyz|apibi\.cc|apiqu\.cc|apige\.cc/i.test(options.url)) {
    const outputPath = await crawlBqg(options, bqgBookId, emit);
    return { outputPath, logs: [] };
  }

  const html = await fetchHtml(options.url);
  const chapters = options.single
    ? [{ title: '', url: options.url }]
    : parseChapterLinks(html, options.url, options.chapterLinkSelector);

  if (!chapters.length) {
    throw new Error('没有识别到章节链接，请填写章节链接选择器，或勾选单章模式。');
  }

  const selectedChapters = selectChapterRange(chapters, options.start, options.limit);
  const output = [];
  let bookTitle = pickText(cheerio.load(html), 'h1', ['h1', '.book-title', '.title']) || 'novel';

  emit(`识别到 ${chapters.length} 个章节，开始爬取 ${selectedChapters.length} 个章节。`);

  for (let i = 0; i < selectedChapters.length; i += 1) {
    const chapter = selectedChapters[i];
    const index = options.start + i;
    emit(`[${index}/${chapters.length}] ${chapter.title || chapter.url}`);

    const chapterHtml = chapter.url === options.url ? html : await fetchHtml(chapter.url);
    const parsed = parseChapter(chapterHtml, chapter.url, options);
    const title = parsed.title || chapter.title || `第 ${index} 章`;
    if (i === 0 && bookTitle === 'novel') bookTitle = title;
    output.push(`${title}\n\n${parsed.content}`);

    if (i < selectedChapters.length - 1 && options.delay > 0) await sleep(options.delay);
  }

  const fileName = getOutputFileName(options.out, bookTitle);
  const outputPath = path.join(options.outputDir, fileName);
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.writeFile(outputPath, output.join('\n\n\n'), 'utf8');
  return { outputPath, chapters: selectedChapters.length };
}

module.exports = {
  crawlNovel,
};
