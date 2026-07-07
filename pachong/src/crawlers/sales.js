const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT = 45000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getNumberFromSalesText(value) {
  const text = normalizeText(value).replace(/,/g, '');
  if (!text) return 0;

  const matched = text.match(/(\d+(?:\.\d+)?)\s*(万\+?|w\+?|k\+?|千\+?)?/i);
  if (!matched) return 0;

  const number = Number(matched[1]);
  if (!Number.isFinite(number)) return 0;

  const unit = String(matched[2] || '').toLowerCase();
  if (unit.includes('万') || unit.includes('w')) return Math.round(number * 10000);
  if (unit.includes('千') || unit.includes('k')) return Math.round(number * 1000);
  return Math.round(number);
}

function getSafeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function inferSalesText(text) {
  const compact = normalizeText(text);
  const patterns = [
    /((?:\d+(?:\.\d+)?)(?:万|w|千|k)?\+?)\s*(?:人付款|人已买|已售|已成交|销量|付款)/i,
    /(?:月销|月售|销量|已售|成交)\s*((?:\d+(?:\.\d+)?)(?:万|w|千|k)?\+?)/i,
    /((?:\d+(?:\.\d+)?)(?:万|w|千|k)?\+?)\s*(?:条评价|评价|评论)/i,
  ];

  for (const pattern of patterns) {
    const matched = compact.match(pattern);
    if (matched) return matched[0];
  }

  return '';
}

function getBestSalesText(...values) {
  const candidates = values.map(normalizeText).filter(Boolean);
  candidates.sort((a, b) => getNumberFromSalesText(b) - getNumberFromSalesText(a));
  return candidates[0] || '';
}

function buildTaobaoUrl(keyword) {
  const q = encodeURIComponent(keyword);
  return `https://s.taobao.com/search?q=${q}&sort=sale-desc`;
}

function buildJdUrl(keyword) {
  const q = encodeURIComponent(keyword);
  return `https://search.jd.com/Search?keyword=${q}&enc=utf-8&wq=${q}&psort=3`;
}

function getAuthStatePath(storageDir, platform) {
  return path.join(storageDir, `${platform}-storage-state.json`);
}

function getProfileDir(storageDir, platform) {
  return path.join(storageDir, `${platform}-profile`);
}

function hasAuthState(storageDir, platform) {
  return Boolean(storageDir && fs.existsSync(getAuthStatePath(storageDir, platform)));
}

async function createScrapeContext(browser, storageDir, platform) {
  const statePath = getAuthStatePath(storageDir, platform);
  const contextOptions = {
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 1100 },
    locale: 'zh-CN',
  };

  if (storageDir && fs.existsSync(statePath)) {
    contextOptions.storageState = statePath;
  }

  return browser.newContext(contextOptions);
}

async function preparePage(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(1200);
  return page;
}

async function scrapeTaobao(context, keyword, limit) {
  const url = buildTaobaoUrl(keyword);
  const page = await preparePage(context, url);

  try {
    return await page.evaluate((maxItems) => {
      const textOf = (node, selector) =>
        Array.from(node.querySelectorAll(selector))
          .map((item) => item.textContent || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      const hrefOf = (node) => {
        const link = node.querySelector('a[href]');
        if (!link) return '';
        try {
          return new URL(link.getAttribute('href'), location.href).href;
        } catch {
          return link.getAttribute('href') || '';
        }
      };
      const imageOf = (node) => {
        const img = node.querySelector('img');
        if (!img) return '';
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
        if (!src) return '';
        try {
          return new URL(src, location.href).href;
        } catch {
          return src;
        }
      };

      const nodes = Array.from(
        document.querySelectorAll(
          [
            '[class*="item"]',
            '[class*="Item"]',
            '[class*="Card"]',
            '[data-category="auctions"]',
            '.items > div',
          ].join(','),
        ),
      );
      const seen = new Set();
      const products = [];

      for (const node of nodes) {
        const fullText = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (fullText.length < 20) continue;

        const link = hrefOf(node);
        const title =
          textOf(node, '[class*="title"], [class*="Title"], [class*="name"], [class*="Name"]') ||
          (node.querySelector('a[title]')?.getAttribute('title') || '').trim() ||
          fullText.slice(0, 80);
        const price =
          textOf(node, '[class*="price"], [class*="Price"]') ||
          (fullText.match(/[¥￥]\s*\d+(?:\.\d+)?/) || [''])[0];
        const salesText =
          textOf(node, '[class*="deal"], [class*="sell"], [class*="Sales"], [class*="sale"]') ||
          (fullText.match(/(?:月销|已售|付款|成交)\s*\d+(?:\.\d+)?(?:万|w|千|k)?\+?/i) || [''])[0] ||
          (fullText.match(/\d+(?:\.\d+)?(?:万|w|千|k)?\+?\s*(?:人付款|人已买|已售|已成交)/i) || [''])[0];
        const shop =
          textOf(node, '[class*="shop"], [class*="Shop"], [class*="seller"], [class*="Seller"]') ||
          '';

        const key = link || `${title}-${price}`;
        if (!title || seen.has(key)) continue;
        seen.add(key);
        products.push({ platform: '淘宝', title, price, salesText, shop, link, image: imageOf(node) });
        if (products.length >= maxItems * 2) break;
      }

      return products.slice(0, maxItems);
    }, limit);
  } finally {
    await page.close();
  }
}

async function scrapeJd(context, keyword, limit) {
  const url = buildJdUrl(keyword);
  const page = await preparePage(context, url);

  try {
    return await page.evaluate((maxItems) => {
      const textOf = (node, selector) =>
        Array.from(node.querySelectorAll(selector))
          .map((item) => item.textContent || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      const hrefOf = (node) => {
        const link = node.querySelector('a[href]');
        if (!link) return '';
        try {
          return new URL(link.getAttribute('href'), location.href).href;
        } catch {
          return link.getAttribute('href') || '';
        }
      };
      const imageOf = (node) => {
        const img = node.querySelector('img');
        if (!img) return '';
        const src =
          img.currentSrc ||
          img.src ||
          img.getAttribute('data-lazy-img') ||
          img.getAttribute('data-img') ||
          '';
        if (!src) return '';
        try {
          return new URL(src, location.href).href;
        } catch {
          return src;
        }
      };

      return Array.from(document.querySelectorAll('#J_goodsList .gl-item, .gl-item'))
        .map((node) => {
          const fullText = (node.textContent || '').replace(/\s+/g, ' ').trim();
          const title =
            textOf(node, '.p-name em, .p-name a, [class*="name"]') ||
            (node.querySelector('a[title]')?.getAttribute('title') || '').trim();
          const price =
            textOf(node, '.p-price, [class*="price"]') ||
            (fullText.match(/[¥￥]\s*\d+(?:\.\d+)?/) || [''])[0];
          const comments = textOf(node, '.p-commit, [class*="commit"], [class*="comment"]');
          const salesText =
            textOf(node, '[class*="sale"], [class*="buy"], [class*="deal"]') ||
            comments ||
            (fullText.match(/(?:销量|已售|月销|评价|评论)\s*\d+(?:\.\d+)?(?:万|w|千|k)?\+?/i) || [''])[0] ||
            (fullText.match(/\d+(?:\.\d+)?(?:万|w|千|k)?\+?\s*(?:条评价|评价|评论|已售)/i) || [''])[0];
          const shop = textOf(node, '.p-shop, [class*="shop"]');

          return { platform: '京东', title, price, salesText, shop, link: hrefOf(node), image: imageOf(node) };
        })
        .filter((item) => item.title)
        .slice(0, maxItems);
    }, limit);
  } finally {
    await page.close();
  }
}

function normalizeProduct(product, index) {
  const salesText = getBestSalesText(product.salesText, inferSalesText(product.title), inferSalesText(product.shop));
  return {
    rank: index + 1,
    platform: product.platform,
    title: normalizeText(product.title),
    price: normalizeText(product.price).replace(/\s+/g, ''),
    salesText: salesText || '未识别',
    sales: getSafeNumber(getNumberFromSalesText(salesText)),
    shop: normalizeText(product.shop),
    link: product.link || '',
    image: product.image || '',
  };
}

async function crawlSales(userOptions) {
  const options = {
    keyword: '',
    limit: DEFAULT_LIMIT,
    storageDir: '',
    onProgress: () => {},
    ...userOptions,
  };
  const keyword = normalizeText(options.keyword || options.category);
  const limit = Math.min(Math.max(Math.trunc(Number(options.limit) || DEFAULT_LIMIT), 5), 50);

  if (!keyword) throw new Error('请输入要分析的商品类别。');

  const browser = await chromium.launch({ headless: true });
  const platformResults = [];

  try {
    const taobaoContext = await createScrapeContext(browser, options.storageDir, 'taobao');
    const jdContext = await createScrapeContext(browser, options.storageDir, 'jd');
    const tasks = [
      ['淘宝', hasAuthState(options.storageDir, 'taobao'), () => scrapeTaobao(taobaoContext, keyword, limit)],
      ['京东', hasAuthState(options.storageDir, 'jd'), () => scrapeJd(jdContext, keyword, limit)],
    ];

    for (const [platform, authed, runner] of tasks) {
      options.onProgress(`正在抓取${platform}: ${keyword}${authed ? '（已加载登录态）' : '（未登录）'}`);
      try {
        const products = await runner();
        options.onProgress(`${platform}抓取到 ${products.length} 条候选商品。`);
        platformResults.push({ platform, ok: true, products });
      } catch (error) {
        options.onProgress(`${platform}抓取失败: ${error.message}`);
        platformResults.push({ platform, ok: false, error: error.message, products: [] });
      }
    }
    await taobaoContext.close();
    await jdContext.close();
  } finally {
    await browser.close();
  }

  const products = platformResults
    .flatMap((result) => result.products)
    .map(normalizeProduct)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit)
    .map((product, index) => ({ ...product, rank: index + 1 }));

  if (!products.length) {
    const errors = platformResults
      .filter((result) => !result.ok)
      .map((result) => `${result.platform}: ${result.error}`)
      .join('；');
    throw new Error(errors || '没有抓取到商品数据。淘宝/京东当前要求登录或验证，请先在销量分析页登录平台后重试。');
  }

  return {
    type: 'sales',
    keyword,
    generatedAt: new Date().toISOString(),
    products,
    platforms: platformResults.map((result) => ({
      platform: result.platform,
      ok: result.ok,
      count: result.products.length,
      error: result.error || '',
    })),
  };
}

async function loginSalesPlatform(userOptions) {
  const options = {
    platform: '',
    storageDir: '',
    onProgress: () => {},
    ...userOptions,
  };
  const platform = String(options.platform || '').toLowerCase();
  if (!['taobao', 'jd'].includes(platform)) {
    throw new Error('不支持的平台登录。');
  }
  if (!options.storageDir) throw new Error('缺少登录态保存目录。');

  fs.mkdirSync(options.storageDir, { recursive: true });
  const statePath = getAuthStatePath(options.storageDir, platform);
  const profileDir = getProfileDir(options.storageDir, platform);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    const isTaobao = platform === 'taobao';
    const loginUrl = isTaobao
      ? 'https://login.taobao.com/member/login.jhtml'
      : 'https://passport.jd.com/new/login.aspx';

    options.onProgress(`已打开${isTaobao ? '淘宝' : '京东'}登录窗口，请在浏览器里完成登录。`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

    let loggedIn = false;
    try {
      await page.waitForFunction(
        ({ taobao }) => {
          const text = document.body?.innerText || '';
          if (taobao) {
            return !location.href.includes('login.taobao.com') && !text.includes('亲，请登录');
          }
          return !location.href.includes('passport.jd.com') && !text.includes('登录页面');
        },
        { taobao: isTaobao },
        { timeout: 180000 },
      );
      loggedIn = true;
    } catch {
      loggedIn = false;
    }

    if (!loggedIn) {
      throw new Error('没有检测到登录完成，请重新点击登录按钮并在 3 分钟内完成登录。');
    }

    await context.storageState({ path: statePath });
    options.onProgress(`登录态已保存: ${statePath}`);

    return {
      type: 'sales-auth',
      platform,
      statePath,
      ok: true,
    };
  } finally {
    await context.close();
  }
}

module.exports = {
  crawlSales,
  loginSalesPlatform,
  getNumberFromSalesText,
};
