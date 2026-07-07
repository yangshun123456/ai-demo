const axios = require('axios');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function cleanKeyword(keyword) {
  return String(keyword || '').trim();
}

function getArchiveDetailUrl(identifier) {
  return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}

function getArchiveSearchUrl(keyword) {
  return `https://archive.org/search?query=${encodeURIComponent(keyword)}&and[]=mediatype:%22movies%22`;
}

function getOfficialSearchLinks(keyword) {
  const encodedKeyword = encodeURIComponent(keyword);

  return [
    {
      title: `${keyword} - Internet Archive 视频公开档案搜索`,
      type: '公开档案搜索',
      link: getArchiveSearchUrl(keyword),
    },
    {
      title: `${keyword} - 哔哩哔哩官方搜索`,
      type: '官方平台搜索',
      link: `https://search.bilibili.com/all?keyword=${encodedKeyword}`,
    },
    {
      title: `${keyword} - YouTube 官方搜索`,
      type: '官方平台搜索',
      link: `https://www.youtube.com/results?search_query=${encodedKeyword}`,
    },
    {
      title: `${keyword} - Vimeo 官方搜索`,
      type: '官方平台搜索',
      link: `https://vimeo.com/search?q=${encodedKeyword}`,
    },
  ];
}

function createArchiveQuery(keyword) {
  const escaped = keyword.replace(/"/g, '\\"');
  return `(${escaped}) AND mediatype:(movies)`;
}

async function searchInternetArchive(keyword, onProgress) {
  onProgress('正在查询 Internet Archive 公开影视档案。');

  const response = await axios.get('https://archive.org/advancedsearch.php', {
    timeout: 20000,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    params: {
      q: createArchiveQuery(keyword),
      fl: ['identifier', 'title', 'mediatype', 'year', 'creator', 'description'],
      rows: 12,
      page: 1,
      output: 'json',
      sort: ['downloads desc', 'date desc'],
    },
  });

  const docs = response.data?.response?.docs || [];
  onProgress(`Internet Archive 返回 ${docs.length} 条公开资源。`);

  return docs
    .filter((item) => item.identifier)
    .map((item) => {
      const title = item.title || item.identifier;
      const detail = [
        item.year,
        Array.isArray(item.creator) ? item.creator.join(', ') : item.creator,
      ].filter(Boolean);

      return {
        title: detail.length ? `${title} (${detail.join(' / ')})` : title,
        type: '公开档案资源',
        link: getArchiveDetailUrl(item.identifier),
        source: 'Internet Archive',
      };
    });
}

async function searchMovie({ keyword, onProgress = () => {} }) {
  const clean = cleanKeyword(keyword);
  if (!clean) throw new Error('请输入要搜索的影视名称。');

  onProgress(`正在为 "${clean}" 查询真实公开资源。`);

  let archiveMovies = [];
  try {
    archiveMovies = await searchInternetArchive(clean, onProgress);
  } catch (error) {
    onProgress(`Internet Archive 查询失败: ${error.message}`);
  }

  const platformLinks = getOfficialSearchLinks(clean);
  const movies = [...archiveMovies, ...platformLinks];

  if (archiveMovies.length > 0) {
    onProgress(`已找到 ${archiveMovies.length} 条可打开的公开档案资源，并附带官方平台搜索入口。`);
  } else {
    onProgress('没有匹配到公开档案条目，已提供官方平台搜索入口。');
  }

  return { movies };
}

module.exports = {
  searchMovie,
};
