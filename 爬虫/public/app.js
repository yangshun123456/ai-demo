const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
const message = document.querySelector('#message');
const log = document.querySelector('#log');
const clearLog = document.querySelector('#clearLog');
let currentEvents = null;

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

async function submitTask(form, endpoint, pendingText) {
  const button = form.querySelector('button[type="submit"]');
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
      body: JSON.stringify(formToJson(form)),
    });
    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || '任务失败');
    }

    if (!result.jobId) {
      throw new Error('服务没有返回任务 ID');
    }

    watchTask(result.jobId, button);
  } catch (error) {
    setMessage(`失败：${error.message}`);
    appendLog(error.stack || error.message);
    button.disabled = false;
  }
}

function watchTask(jobId, button) {
  currentEvents = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}`);

  currentEvents.addEventListener('snapshot', (event) => {
    const data = JSON.parse(event.data);
    appendLog(data.logs || []);
    if (data.status === 'done') finishTask(data.result, button);
    if (data.status === 'error') failTask(data.error, data.logs, button);
  });

  currentEvents.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    appendLog(data.logs || [data.message]);
    log.scrollTop = log.scrollHeight;
  });

  currentEvents.addEventListener('done', (event) => {
    const data = JSON.parse(event.data);
    finishTask(data.result, button);
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

function finishTask(result, button) {
  setMessage(`完成，文件已保存到 ${result?.outputPath || 'downloads 目录'}。`, result?.downloadUrl);
  button.disabled = false;
  if (currentEvents) {
    currentEvents.close();
    currentEvents = null;
  }
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

document.querySelector('#videoForm').addEventListener('submit', (event) => {
  event.preventDefault();
  submitTask(event.currentTarget, '/api/video', '视频识别和下载中，请保持页面打开。');
});

clearLog.addEventListener('click', () => {
  setMessage('等待任务提交。');
  appendLog('');
});
