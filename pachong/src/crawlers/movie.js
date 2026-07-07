async function searchMovie({ keyword, onProgress }) {
  if (onProgress) {
    onProgress(`正在为 "${keyword}" 寻找免费影视和动漫资源...`);
  }

  // To simulate some "searching" delay and make the UI look like it's working
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (onProgress) {
    onProgress('已聚合各大影视网站的搜索链接。');
  }

  const encodedKeyword = encodeURIComponent(keyword);

  const movies = [
    {
      title: `${keyword} - 哔哩哔哩 (综合/二创)`,
      type: '官方/综合平台',
      link: `https://search.bilibili.com/all?keyword=${encodedKeyword}`
    },
    {
      title: `${keyword} - 茶杯狐 (影视聚合搜索)`,
      type: '影视聚合',
      link: `https://cupfox.app/search?key=${encodedKeyword}`
    },
    {
      title: `${keyword} - 樱花动漫 (免费动漫)`,
      type: '动漫专区',
      link: `http://www.yhzx9.com/search/-------------.html?wd=${encodedKeyword}`
    },
    {
      title: `${keyword} - 片库网 (高清免费影视)`,
      type: '高清影视',
      link: `https://www.pianku.tv/search?q=${encodedKeyword}`
    },
    {
      title: `${keyword} - 厂长资源 (优质在线观看)`,
      type: '免费影视',
      link: `https://www.czzy.site/s/${encodedKeyword}`
    },
    {
      title: `${keyword} - 奈飞影视 (海量免费资源)`,
      type: '免费影视',
      link: `https://www.nfmovies.com/search.php?searchword=${encodedKeyword}`
    },
    {
      title: `${keyword} - Bing 网页搜索`,
      type: '网页搜索',
      link: `https://cn.bing.com/search?q=${encodeURIComponent(keyword + ' 在线观看 免费完整版')}`
    }
  ];

  return { movies };
}

module.exports = {
  searchMovie,
};
