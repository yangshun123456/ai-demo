import { updateConfig } from '../repositories/config-repository.js';

export async function saveAiProfile(profile) {
  const nextProfile = {
    id: profile.id || crypto.randomUUID(),
    name: (profile.name || '').trim(),
    baseUrl: (profile.baseUrl || '').trim(),
    apiKey: profile.apiKey || '',
    model: (profile.model || '').trim()
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

export async function sendAiChat(profile, messages) {
  const response = await fetch(`${profile.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${profile.apiKey}`
    },
    body: JSON.stringify({
      model: profile.model,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `AI 请求失败: ${response.status}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content ?? '';
}
