import { updateConfig } from '../repositories/config-repository.js';

export async function saveAiProfile(profile) {
  const nextProfile = {
    id: profile.id || crypto.randomUUID(),
    name: (profile.name || '').trim(),
    baseUrl: (profile.baseUrl || '').trim(),
    apiKey: profile.apiKey || '',
    model: (profile.model || '').trim(),
    models: Array.isArray(profile.models) ? profile.models.filter(Boolean) : []
  };

  return updateConfig((config) => {
    const aiProfiles = config.aiProfiles.some((item) => item.id === nextProfile.id)
      ? config.aiProfiles.map((item) => (item.id === nextProfile.id ? nextProfile : item))
      : [...config.aiProfiles, nextProfile];

    return {
      ...config,
      aiProfiles,
      preferences: {
        ...config.preferences,
        activeAiProfileId: nextProfile.id
      }
    };
  });
}

export async function activateAiProfile(profileId) {
  return updateConfig((config) => ({
    ...config,
    preferences: {
      ...config.preferences,
      activeAiProfileId: profileId
    }
  }));
}

export async function listAiModels(profile) {
  const baseUrl = (profile.baseUrl || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('请先填写 Base URL');
  }
  if (!profile.apiKey) {
    throw new Error('请先填写 API Key');
  }

  // OpenAI 标准接口：GET /v1/models + Bearer Token
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${profile.apiKey}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `获取模型失败: ${response.status}`);
  }

  const payload = await response.json();
  return (payload.data || [])
    .map((item) => item?.id)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export async function sendAiChat(profile, messages) {
  const baseUrl = (profile.baseUrl || '').trim().replace(/\/$/, '');
  const apiKey = (profile.apiKey || '').trim();
  const model = (profile.model || '').trim();
  if (!baseUrl) throw new Error('请先填写 Base URL');
  if (!apiKey) throw new Error('请先填写 API Key');
  if (!model) throw new Error('请先选择模型');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(getAiErrorMessage(text, response.status));
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('接口未返回有效的回复内容');
  }
  return content;
}

function getAiErrorMessage(text, status) {
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message || payload?.message || text || `HTTP ${status}`;
  } catch {
    return text || `HTTP ${status}`;
  }
}
