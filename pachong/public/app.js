const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const message = document.querySelector('#message');
const log = document.querySelector('#log');
const clearLog = document.querySelector('#clearLog');
const movieForm = document.querySelector('#movieForm');
const movieOutput = document.querySelector('#movieOutput');
const movieTable = document.querySelector('#movieTable');
const videoForm = document.querySelector('#videoForm');
const videoResources = document.querySelector('#videoResources');
const videoResourceList = document.querySelector('#videoResourceList');
const downloadVideo = document.querySelector('#downloadVideo');
const salesForm = document.querySelector('#salesForm');
const salesOutput = document.querySelector('#salesOutput');
const salesMeta = document.querySelector('#salesMeta');
const salesTable = document.querySelector('#salesTable');
const salesChartEl = document.querySelector('#salesChart');
const loginTaobao = document.querySelector('#loginTaobao');
const loginJd = document.querySelector('#loginJd');
let currentEvents = null;
let currentVideoResourceId = '';
let salesChart = null;

function setActiveTab(name) {
  tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
  panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
}

function appendLog(lines) {
  const nextLines = Array.isArray(lines) ? lines : [lines];
  log.textContent = nextLines.filter(Boolean).join('\n');
}

function getDownloadFileName(downloadUrl) {
  const encodedName = String(downloadUrl || '').split('/').pop() || 'download';
  try {
    return decodeURIComponent(encodedName);
  } catch (error) {
    return encodedName;
  }
}

function triggerBrowserDownload(downloadUrl) {
  if (!downloadUrl) return;

  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = getDownloadFileName(downloadUrl);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

function setMessage(text, downloadUrl) {
  if (downloadUrl) {
    message.innerHTML = `${text} <a href="${downloadUrl}" download="${escapeHtml(
      getDownloadFileName(downloadUrl),
    )}">重新下载</a>`;
    return;
  }
  message.textContent = text;
}

function formToJson(form) {
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    data[input.name] = input.checked;
  });

  return data;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '未识别';
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  return number.toLocaleString('zh-CN');
}

async function submitTask(form, endpoint, pendingText, options = {}) {
  const button = options.button || form.querySelector('button[type="submit"]');
  if (currentEvents) {
    currentEvents.close();
    currentEvents = null;
  }

  button.disabled = true;
  setMessage(pendingText);
  appendLog('任务提交中，请等待。');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body || formToJson(form)),
    });
    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || '任务失败');
    }

    if (!result.jobId) {
      throw new Error('服务没有返回任务 ID');
    }

    watchTask(result.jobId, button, options.onDone);
  } catch (error) {
    setMessage(`失败：${error.message}`);
    appendLog(error.stack || error.message);
    button.disabled = false;
  }
}

function watchTask(jobId, button, onDone) {
  currentEvents = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}`);

  currentEvents.addEventListener('snapshot', (event) => {
    const data = JSON.parse(event.data);
    appendLog(data.logs || []);
    if (data.status === 'done') finishTask(data.result, button, onDone);
    if (data.status === 'error') failTask(data.error, data.logs, button);
  });

  currentEvents.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    appendLog(data.logs || [data.message]);
    log.scrollTop = log.scrollHeight;
  });

  currentEvents.addEventListener('done', (event) => {
    const data = JSON.parse(event.data);
    finishTask(data.result, button, onDone);
  });

  currentEvents.addEventListener('error', (event) => {
    if (event.data) {
      const data = JSON.parse(event.data);
      failTask(data.error, data.logs, button);
      return;
    }

    if (button.disabled) {
      failTask('实时连接已断开，请查看服务是否仍在运行。', null, button);
    }
  });
}

function finishTask(result, button, onDone) {
  if (onDone) {
    onDone(result);
  } else {
    triggerBrowserDownload(result?.downloadUrl);
    setMessage('完成，文件已发送到浏览器下载。', result?.downloadUrl);
  }
  button.disabled = false;
  if (currentEvents) {
    currentEvents.close();
    currentEvents = null;
  }
}

function renderMovieResult(result) {
  const movies = result?.movies || [];
  movieOutput.hidden = movies.length === 0;

  if (!movies.length) {
    setMessage('没有找到相关的免费资源。');
    return;
  }

  movieTable.innerHTML = movies
    .map((m) => {
      const title = escapeHtml(m.title);
      const actionText = m.type === '官方平台搜索' || m.type === '公开档案搜索' ? '打开搜索' : '查看资源';
      const link = m.link
        ? `<a class="product-link" href="${escapeHtml(m.link)}" target="_blank" rel="noreferrer">${actionText}</a>`
        : `<span class="muted">暂无链接</span>`;
      return `
        <tr>
          <td>${title}</td>
          <td>${escapeHtml(m.type || '-')}</td>
          <td>${link}</td>
        </tr>
      `;
    })
    .join('');

  setMessage(`搜索完成，为您找到 ${movies.length} 条公开资源或官方搜索入口。`);
}

function renderVideoResources(result) {
  currentVideoResourceId = result?.resourceId || '';
  const resources = result?.resources || [];

  if (!currentVideoResourceId || resources.length === 0) {
    videoResources.hidden = true;
    setMessage('没有可选择的视频资源。');
    return;
  }

  videoResourceList.innerHTML = resources
    .map(
      (resource, index) => `
        <label class="resource-option">
          <input type="radio" name="videoResource" value="${resource.index}" ${index === 0 ? 'checked' : ''} />
          <span>
            <strong>${resource.index}. ${escapeHtml(resource.kind || 'video')}</strong>
            <span>${escapeHtml(resource.label)}</span>
          </span>
        </label>
      `,
    )
    .join('');
  videoResources.hidden = false;
  setMessage('请选择要下载的视频资源。');
}

function renderSalesResult(result) {
  const products = result?.products || [];
  salesOutput.hidden = products.length === 0;

  if (!products.length) {
    setMessage('没有抓取到销量数据。');
    return;
  }

  const platformText = (result.platforms || [])
    .map((platform) => {
      if (platform.ok) return `${platform.platform} ${platform.count} 条`;
      return `${platform.platform} 失败`;
    })
    .join(' / ');

  salesMeta.textContent = `${result.keyword || ''} · ${platformText}`;
  salesTable.innerHTML = products
    .map((product) => {
      const title = escapeHtml(product.title);
      const link = product.link
        ? `<a class="product-link" href="${escapeHtml(product.link)}" target="_blank" rel="noreferrer">${title}</a>`
        : `<span class="product-link">${title}</span>`;
      return `
        <tr>
          <td>${product.rank}</td>
          <td>${escapeHtml(product.platform)}</td>
          <td>${link}</td>
          <td>${escapeHtml(product.price || '-')}</td>
          <td>${escapeHtml(product.salesText || formatNumber(product.sales))}</td>
          <td><span class="muted">${escapeHtml(product.shop || '-')}</span></td>
        </tr>
      `;
    })
    .join('');

  renderSalesChart(products.slice(0, 12));
  setMessage(`销量分析完成，共生成 ${products.length} 条榜单数据。`);
}

function renderSalesChart(products) {
  if (!window.echarts) {
    salesChartEl.innerHTML = '<div class="message">ECharts 加载失败，已保留表格结果。</div>';
    return;
  }

  if (!salesChart) {
    salesChart = window.echarts.init(salesChartEl);
    window.addEventListener('resize', () => salesChart?.resize());
  }

  salesChart.setOption({
    color: ['#2563eb', '#16a34a'],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(items) {
        const item = items[0];
        const product = products[item.dataIndex];
        return `${escapeHtml(product.platform)}<br/>${escapeHtml(product.title)}<br/>销量/热度：${formatNumber(product.sales)}`;
      },
    },
    grid: { left: 72, right: 28, top: 24, bottom: 72 },
    xAxis: {
      type: 'category',
      data: products.map((product) => `${product.rank}.${product.platform}`),
      axisLabel: { interval: 0, rotate: 35 },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter(value) {
          return formatNumber(value);
        },
      },
    },
    series: [
      {
        name: '销量/热度',
        type: 'bar',
        data: products.map((product) => product.sales || 0),
        barMaxWidth: 36,
      },
    ],
  });
}

function failTask(error, logs, button) {
  setMessage(`失败：${error || '任务失败'}`);
  if (logs) appendLog(logs);
  button.disabled = false;
  if (currentEvents) {
    currentEvents.close();
    currentEvents = null;
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
});

document.querySelector('#novelForm').addEventListener('submit', (event) => {
  event.preventDefault();
  submitTask(event.currentTarget, '/api/novel', '小说爬取中，章节较多时会需要一些时间。');
});

movieForm.addEventListener('submit', (event) => {
  event.preventDefault();
  movieOutput.hidden = true;
  submitTask(event.currentTarget, '/api/movie', '正在搜索免费资源，请稍等...', {
    onDone: renderMovieResult,
  });
});

videoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  videoResources.hidden = true;
  currentVideoResourceId = '';
  submitTask(event.currentTarget, '/api/video/resources', '正在识别视频资源，请稍等。', {
    onDone: renderVideoResources,
  });
});

salesForm.addEventListener('submit', (event) => {
  event.preventDefault();
  salesOutput.hidden = true;
  submitTask(event.currentTarget, '/api/sales', '正在抓取淘宝、京东销量数据，请稍等。', {
    onDone: renderSalesResult,
  });
});

loginTaobao.addEventListener('click', () => {
  submitTask(salesForm, '/api/sales/auth', '正在打开淘宝登录窗口。登录完成后会保存登录态。', {
    button: loginTaobao,
    body: { platform: 'taobao' },
    onDone() {
      setMessage('淘宝登录态已保存，可以开始销量分析。');
    },
  });
});

loginJd.addEventListener('click', () => {
  submitTask(salesForm, '/api/sales/auth', '正在打开京东登录窗口。登录完成后会保存登录态。', {
    button: loginJd,
    body: { platform: 'jd' },
    onDone() {
      setMessage('京东登录态已保存，可以开始销量分析。');
    },
  });
});

downloadVideo.addEventListener('click', () => {
  const selected = videoResourceList.querySelector('input[name="videoResource"]:checked');
  if (!currentVideoResourceId || !selected) {
    setMessage('请先识别并选择一个视频资源。');
    return;
  }

  const data = formToJson(videoForm);
  data.resourceId = currentVideoResourceId;
  data.videoIndex = selected.value;

  submitTask(
    videoForm,
    '/api/video',
    '开始下载选中的视频资源。',
    {
      button: downloadVideo,
      body: data,
    },
  );
});

clearLog.addEventListener('click', () => {
  setMessage('等待任务提交。');
  appendLog('');
  movieOutput.hidden = true;
  videoResources.hidden = true;
  salesOutput.hidden = true;
  currentVideoResourceId = '';
});
