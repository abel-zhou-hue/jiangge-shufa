// 全局配置管理:API Keys + 用户偏好
// 优先级:localStorage(用户在设置页填的) > 服务端 env(/api/config) > 内置默认值
const KEY = 'jiangge_config_v1';

// 服务端配置缓存(启动时从 /api/config 拉一次)
let _serverConfig = {};
let _serverSource = {};   // 哪些 key 来自服务端,UI 用来显示"✓ 服务端已配置"

export async function fetchServerConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    _serverConfig = j.config || {};
    _serverSource = j.source || {};
    console.log('[config] 服务端已配置字段:', Object.keys(_serverSource));
  } catch (e) {
    console.log('[config] /api/config 不可用 (本地静态托管 / GH Pages 等),仅用 localStorage');
  }
}

// 哪些字段是服务端注入的 — 设置页用,显示"✓ 服务端已配置"小标签
export function serverConfiguredKeys() { return Object.keys(_serverSource); }

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
    const stored = raw ? JSON.parse(raw) : {};
    // 合并顺序:DEFAULT 兜底 → 服务端 env 填空 → localStorage 优先
    // 注意:服务端配置只对"空字符串"字段生效,用户主动填了的不会被覆盖
    const merged = { ...DEFAULT, ..._serverConfig, ...stored };
    // 但是 stored 里如果某 key 是空字符串,应该让服务端值生效(否则服务端配的就没用)
    for (const k of Object.keys(_serverConfig)) {
      if (!stored[k] && _serverConfig[k]) merged[k] = _serverConfig[k];
    }
    let cfg = merged;
    for (const m of MIGRATIONS) cfg = m(cfg);
    return cfg;
  } catch (e) {
    console.warn('config 读取失败,使用默认', e);
    return { ...DEFAULT, ..._serverConfig };
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
