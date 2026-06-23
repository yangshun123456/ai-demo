const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const message = document.querySelector('#message');
const log = document.querySelector('#log');
const clearLog = document.querySelector('#clearLog');
const videoForm = document.querySelector('#videoForm');
const videoResources = document.querySelector('#videoResources');
const videoResourceList = document.querySelector('#videoResourceList');
const downloadVideo = document.querySelector('#downloadVideo');
let currentEvents = null;
let currentVideoResourceId = '';

function setActiveTab(name) {
  tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
  panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
}

function appendLog(lines) {
  const nextLines = Array.isArray(lines) ? lines : [lines];
  log.textContent = nextLines.filter(Boolean).join('\n');
}

function setMessage(text, downloadUrl) {
  if (downloadUrl) {
    message.innerHTML = `${text} <a href="${downloadUrl}" target="_blank" rel="noreferrer">打开文件</a>`;
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
    setMessage(`完成，文件已保存到 ${result?.outputPath || 'downloads 目录'}。`, result?.downloadUrl);
  }
  button.disabled = false;
  if (currentEvents) {
    currentEvents.close();
    currentEvents = null;
  }
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

videoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  videoResources.hidden = true;
  currentVideoResourceId = '';
  submitTask(event.currentTarget, '/api/video/resources', '正在识别视频资源，请稍等。', {
    onDone: renderVideoResources,
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
  videoResources.hidden = true;
  currentVideoResourceId = '';
});
