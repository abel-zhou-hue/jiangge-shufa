// 全局配置管理:API Keys + 用户偏好,持久化到 localStorage
const KEY = 'jiangge_config_v1';

const DEFAULT = {
  deepseekKey: '',
  deepseekModel: 'deepseek-v4-pro',
  // 火山引擎 — 新版控制台只需 X-Api-Key
  volcApiKey: '',
  // 火山引擎 — 旧版控制台 / V1 TTS 仍需 AppID + Access Token
  volcAppId: '',
  volcToken: '',
  volcCluster: 'volcano_tts',
  volcVoiceId: '',         // 当前默认使用的克隆音色 id
  voices: [],              // 克隆音色库:[{ id, name, createdAt, demoAudio?, modelVersion? }]
  doubaoKey: '',
  doubaoModel: 'ep-20260427205304-9kmtr', // Abel 的 ark 接入点
  corsProxy: 'http://localhost:5174',
};

// 一次性迁移:老的模型名替换成 endpoint ID
const MIGRATIONS = [
  (c) => {
    if (c.doubaoModel === 'doubao-seed-1-6-vision-250815' || c.doubaoModel === 'doubao-1.5-vision-pro-32k') {
      c.doubaoModel = 'ep-20260427205304-9kmtr';
    }
    return c;
  },
  // 把已经训练好的单个 volcVoiceId 自动种到 voices 列表里,避免「看不到我的音色」
  (c) => {
    if (!Array.isArray(c.voices)) c.voices = [];
    if (c.volcVoiceId && !c.voices.some(v => v.id === c.volcVoiceId)) {
      c.voices.unshift({
        id: c.volcVoiceId,
        name: '我的克隆音色 #1',
        createdAt: Date.now(),
      });
    }
    return c;
  },
];

export function loadConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    let cfg = { ...DEFAULT, ...JSON.parse(raw) };
    // 应用迁移
    for (const m of MIGRATIONS) cfg = m(cfg);
    return cfg;
  } catch (e) {
    console.warn('config 读取失败,使用默认', e);
    return { ...DEFAULT };
  }
}

export function saveConfig(patch) {
  const cur = loadConfig();
  const next = { ...cur, ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function getConfiguredCount() {
  const c = loadConfig();
  let n = 0;
  if (c.deepseekKey) n++;
  // 新或旧鉴权任一齐全即算 1
  if (c.volcApiKey || (c.volcAppId && c.volcToken)) n++;
  if (c.doubaoKey) n++;
  return n;
}

// ================= 克隆音色库 =================
export function listVoices() {
  return loadConfig().voices || [];
}

// 新训练完的音色登记进库;同时把它设为当前默认
export function addVoice(voice) {
  const cfg = loadConfig();
  const voices = Array.isArray(cfg.voices) ? cfg.voices.slice() : [];
  if (!voices.some(v => v.id === voice.id)) {
    voices.unshift({
      id: voice.id,
      name: voice.name || `我的克隆音色 #${voices.length + 1}`,
      createdAt: voice.createdAt || Date.now(),
      demoAudio: voice.demoAudio || '',
      modelVersion: voice.modelVersion || 2,
    });
  } else {
    // 已存在 → 顺手刷新 demoAudio(新轮询拿到的更新)
    for (const v of voices) if (v.id === voice.id) {
      if (voice.demoAudio) v.demoAudio = voice.demoAudio;
      if (voice.modelVersion) v.modelVersion = voice.modelVersion;
    }
  }
  return saveConfig({ voices, volcVoiceId: voice.id });
}

export function removeVoice(id) {
  const cfg = loadConfig();
  const voices = (cfg.voices || []).filter(v => v.id !== id);
  const patch = { voices };
  if (cfg.volcVoiceId === id) patch.volcVoiceId = voices[0]?.id || '';
  return saveConfig(patch);
}

export function setDefaultVoice(id) {
  return saveConfig({ volcVoiceId: id });
}

export function renameVoice(id, name) {
  const cfg = loadConfig();
  const voices = (cfg.voices || []).map(v => v.id === id ? { ...v, name } : v);
  return saveConfig({ voices });
}
