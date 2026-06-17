// 火山引擎 V3 大模型语音合成 — HTTP Chunked 单向流式
// 文档:https://www.volcengine.com/docs/6561/1598757
// 同一文档说:HTTP Chunked 协议,一次性输入全部合成文本,流式输出音频
//
// 鉴权(优先新版):
//   X-Api-Key: <api_key>
//   X-Api-Resource-Id: seed-tts-2.0 | seed-tts-1.0 | seed-icl-2.0 | seed-icl-1.0
//   X-Api-Request-Id: <uuid>
//
// 旧版控制台兼容:X-Api-App-Id + X-Api-Access-Key
//
// 浏览器不能给 WebSocket 设自定义 header,所以走 HTTP Chunked

import { loadConfig } from './config.js';
import { pollCloneStatus } from './volcengine-clone.js';

// 缓存克隆音色的「V3 引擎 ID」(uranus 系,model_type=5),避免每次 TTS 都查一次
const v3IdCache = new Map();

const TTS_HTTP_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const TTS_V1_ENDPOINT   = 'https://openspeech.bytedance.com/api/v1/tts'; // legacy fallback
const DEFAULT_PROXY     = 'http://localhost:5174'; // 火山接口不支持浏览器 CORS,必须走代理

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0;
    const v = c === 'x' ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}

// 查这个克隆音色对应的 V3 引擎 ID(model_type=5,uranus 系命名)
// 火山训练时会同时生成 3 个 model 版本:1=V1 / 4=V2(默认) / 5=V3(uranus,最新)
async function getV3SpeakerId(customSpeakerId) {
  if (v3IdCache.has(customSpeakerId)) return v3IdCache.get(customSpeakerId);
  try {
    const data = await pollCloneStatus(customSpeakerId);
    const v3 = (data?.speaker_status || []).find(s => s.model_type === 5 || (s.icl_speaker_id || '').includes('uranus'));
    const id = v3?.icl_speaker_id || null;
    v3IdCache.set(customSpeakerId, id);
    return id;
  } catch (e) {
    console.warn('[TTS] 查 V3 ID 失败', e);
    return null;
  }
}

// 根据 voiceType 自动选 Resource-Id
function pickResourceId(voiceType, isCustom) {
  if (isCustom) return 'seed-icl-2.0';   // V3 训练的克隆音色,跑 2.0 效果
  // 系统大模型音色,*_mars_bigtts、*_moon_bigtts 这类是 1.0;
  // *_uranus_bigtts、*_neptune_bigtts 等新音色是 2.0。
  // 文档没给完整列表,保守按命名推:
  if (/_uranus_|_neptune_|_pluto_|_saturn_/.test(voiceType)) return 'seed-tts-2.0';
  return 'seed-tts-1.0';
}

// 鉴权 headers
function authHeaders(cfg, resourceId) {
  const h = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': uuid(),
    'X-Api-Connect-Id': uuid(),
  };
  if (cfg.volcApiKey) {
    h['X-Api-Key'] = cfg.volcApiKey;
  } else if (cfg.volcAppId && cfg.volcToken) {
    h['X-Api-App-Id'] = cfg.volcAppId;
    h['X-Api-Access-Key'] = cfg.volcToken;
  } else {
    throw new Error('请在「设置」配置火山 API Key(新版控制台)或 AppID + Access Token(旧版控制台)');
  }
  return h;
}

// ============= 单段合成(V3) =============
async function synthOneV3(text, opts = {}) {
  const cfg = loadConfig();

  const isCustom = opts.voiceType === 'custom';
  let voice = isCustom
    ? (cfg.volcVoiceId || (() => { throw new Error('未配置克隆音色 voice_id'); })())
    : (opts.voiceType || 'zh_female_wenrounvsheng_mars_bigtts');

  let resourceId = pickResourceId(voice, isCustom);

  // 用户选「V3 引擎」 → 把克隆音色切到 uranus(model_type=5)。
  // 关键:ICL 类音色必须配 seed-icl-* 资源,不能配 seed-tts-*(否则报 55000000 mismatch)
  if (isCustom && opts.useV3) {
    const v3Id = await getV3SpeakerId(voice);
    if (v3Id) {
      voice = v3Id;
      resourceId = 'seed-icl-2.0';   // 仍然是 ICL 资源,uranus 是 ICL 类的 V3 内部 ID
      console.log('[TTS] 用 V3 引擎合成:', v3Id);
    } else {
      console.warn('[TTS] 拿不到 V3 ID(可能音色还在训练中),回退到 V2');
    }
  }

  // audio_params:速度、音量、音高 + (2.0 模型)情感
  const audio_params = {
    format: 'mp3',
    sample_rate: 24000,
    // 0.8 → -25, 1.0 → 0, 1.2 → 25(原来只有 ±10 太弱,改 ±25 更明显)
    speech_rate: Math.round((Number(opts.speed || 1.0) - 1) * 125),
  };
  if (typeof opts.loudness === 'number') audio_params.loudness_rate = opts.loudness; // -50..50
  if (typeof opts.pitch === 'number')    audio_params.pitch_rate    = opts.pitch;    // -50..50

  // 关键:2.0 模型(包括克隆音色 seed-icl-2.0、官方 seed-tts-2.0)才支持情感参数
  // 1.0 模型(Mars 系)传了会被忽略甚至报错
  const is2x = /-2\.0$/.test(resourceId);
  // UI 三档 → 火山情感:'自然'→默认中性(不传);'亲切'→ happy;'专业'→ 默认(不传)
  const emotionMap = { '亲切': 'happy', '兴奋': 'excited', '感动': 'affectionate' };
  const emo = emotionMap[opts.emotion];
  if (is2x && emo) {
    audio_params.emotion = emo;
    audio_params.enable_emotion = true;
    // 默认 5(拉满);动态模式下每块会传不同 scale,让块间情感强度有对比
    audio_params.emotion_scale = (typeof opts.emotionScale === 'number') ? opts.emotionScale : 5;
  }

  const payload = {
    user: { uid: 'jiangge_workbench' },
    req_params: {
      text,
      speaker: voice,
      audio_params,
    },
  };

  // 火山接口不开 CORS,强制走代理(默认本地 5174)
  const proxy = cfg.corsProxy || DEFAULT_PROXY;
  const url = `${proxy}/?target=${encodeURIComponent(TTS_HTTP_ENDPOINT)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(cfg, resourceId),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`V3 TTS 失败 [${res.status}]: ${txt.slice(0, 300)}`);
  }

  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
  const body = await res.arrayBuffer();
  return parseV3TtsBody(body, contentType);
}

// ============= V3 TTS 响应解析(多策略) =============
function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function concatBytes(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function parseV3TtsBody(arrayBuf, contentType) {
  // 策略 A: content-type 明说是音频 → 直接当音频
  if (contentType && (contentType.includes('audio/') || contentType.includes('octet-stream'))) {
    return new Blob([arrayBuf], { type: 'audio/mpeg' });
  }

  const text = new TextDecoder('utf-8').decode(arrayBuf);

  // 策略 B: 整体就是一个 JSON
  try {
    const data = JSON.parse(text);
    if (data?.code && data.code !== 0 && data.code !== 200 && data.code !== 3000) {
      throw new Error(`V3 TTS 业务失败 [${data.code}] ${data.message || ''}`);
    }
    if (data?.data) return new Blob([b64ToBytes(data.data)], { type: 'audio/mpeg' });
    // 嵌套(常见路径:payload.audio / result.audio)
    const nested = data?.payload?.audio || data?.result?.audio || data?.audio;
    if (nested) return new Blob([b64ToBytes(nested)], { type: 'audio/mpeg' });
  } catch (e) {
    if (e.message?.startsWith('V3 TTS 业务失败')) throw e;
    // 不是单段 JSON,接着试
  }

  // 策略 C: NDJSON / 多段 JSON 流(unidirectional 流式合成的典型格式)
  const chunks = [];
  let bizError = null;
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // 业务错误码
      if (obj?.code && obj.code !== 0 && obj.code !== 200 && obj.code !== 3000) {
        bizError = `V3 TTS 业务失败 [${obj.code}] ${obj.message || ''}`;
        continue;
      }
      const piece = obj?.data || obj?.payload?.audio || obj?.audio;
      if (piece) chunks.push(b64ToBytes(piece));
    } catch (_) { /* 单行解析失败,跳 */ }
  }
  if (bizError && chunks.length === 0) throw new Error(bizError);
  if (chunks.length > 0) return new Blob([concatBytes(chunks)], { type: 'audio/mpeg' });

  // 策略 D: 用正则把所有看起来像 {... "data": "xxx" ...} 的对象挑出来
  const objRegex = /\{[^{}]*"data"\s*:\s*"([A-Za-z0-9+/=]+)"[^{}]*\}/g;
  let m;
  while ((m = objRegex.exec(text)) !== null) {
    try { chunks.push(b64ToBytes(m[1])); } catch (_) {}
  }
  if (chunks.length > 0) return new Blob([concatBytes(chunks)], { type: 'audio/mpeg' });

  // 都失败 → 抛带诊断的清晰错误,别再当 mp3 蒙
  const preview = text.slice(0, 300).replace(/\s+/g, ' ');
  throw new Error(`V3 TTS 响应无法解析为音频(前 300 字节:${preview})`);
}

// ============= 单段合成(V1 旧接口,作为 fallback) =============
async function synthOneV1(text, opts = {}) {
  const cfg = loadConfig();
  if (!cfg.volcAppId || !cfg.volcToken) {
    throw new Error('V1 TTS 需要 AppID + Access Token');
  }

  const voice = opts.voiceType === 'custom' ? (cfg.volcVoiceId || '') : (opts.voiceType || 'zh_female_wenrounvsheng_mars_bigtts');
  if (opts.voiceType === 'custom' && !voice) {
    throw new Error('未配置克隆音色 voice_id');
  }

  const payload = {
    app: { appid: cfg.volcAppId, token: cfg.volcToken, cluster: cfg.volcCluster || 'volcano_tts' },
    user: { uid: 'jiangge_workbench' },
    audio: {
      voice_type: voice,
      encoding: 'mp3',
      rate: 24000,
      speed_ratio: Number(opts.speed || 1.0),
      volume_ratio: 1.0,
      pitch_ratio: 1.0,
    },
    request: {
      reqid: uuid(),
      text,
      text_type: 'plain',
      operation: 'query',
      with_frontend: 1,
      frontend_type: 'unitTson',
    },
  };

  const proxy = cfg.corsProxy || DEFAULT_PROXY;
  const url = `${proxy}/?target=${encodeURIComponent(TTS_V1_ENDPOINT)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer;${cfg.volcToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`V1 TTS 失败 [${res.status}]: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.code !== 3000) throw new Error(`V1 TTS 业务失败 [${data.code}]: ${data.message || ''}`);
  const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
  return new Blob([bytes], { type: 'audio/mpeg' });
}

// 主调用 — 优先 V3。失败的三段降级:
//   1) 如果是 V3 引擎(opts.useV3)失败 → 先关掉 V3 重试一次(用默认 V2 通道)
//   2) 还失败 → 才考虑 V1(只对官方音色有意义,克隆音色 V1 不支持)
//   3) 都不行 → 抛
async function synthOne(text, opts) {
  const cfg = loadConfig();
  if (!cfg.volcApiKey) return synthOneV1(text, opts);

  try {
    return await synthOneV3(text, opts);
  } catch (e) {
    // V3 引擎模式失败 → 先尝试关掉 V3 引擎再走 V2
    if (opts.useV3) {
      console.warn('[TTS] V3 引擎合成失败,自动回退 V2:', e.message);
      try {
        return await synthOneV3(text, { ...opts, useV3: false });
      } catch (e2) {
        console.warn('[TTS] V2 通道也失败:', e2.message);
        e = e2;
      }
    } else {
      console.warn('[TTS] V3 通道失败:', e.message);
    }
    // 最后兜底:V1(仅当鉴权齐全 + 不是克隆音色)
    const isCustom = opts.voiceType === 'custom';
    if (!isCustom && cfg.volcAppId && cfg.volcToken) {
      console.warn('[TTS] fallback V1');
      return synthOneV1(text, opts);
    }
    throw e;
  }
}

// ============================================================
//  动态语速 / 情感映射 — 不同块给不同合成参数,听感才有起伏
// ============================================================
// 块名(模糊匹配)→ 这一段应该怎么念
//   speedMul:  乘在用户全局语速上的倍率(0.92 = 比标准慢 8%)
//   emotion:   覆盖用户的全局情感选择;null = 沿用用户选的
//   scale:     emotion_scale 强度 1-5
const BLOCK_DELIVERY = {
  hook:    { speedMul: 1.10, emotion: '兴奋',   scale: 5, label: '钩子→快+兴奋' },
  preview: { speedMul: 1.00, emotion: null,     scale: 4, label: '预告→标准' },
  body:    { speedMul: 0.96, emotion: null,     scale: 3, label: '干货→稍慢清晰' },
  twist:   { speedMul: 1.06, emotion: '兴奋',   scale: 5, label: '反转→偏快惊喜' },
  outro:   { speedMul: 0.92, emotion: '感动',   scale: 4, label: '收尾→慢+温暖' },
};

function detectBlockKind(tag) {
  const t = String(tag || '');
  if (/钩子|开场|hook/i.test(t))        return 'hook';
  if (/预告|价值|preview/i.test(t))      return 'preview';
  if (/反转|惊喜|彩蛋|twist/i.test(t))    return 'twist';
  if (/结尾|收尾|互动|outro|CTA/i.test(t)) return 'outro';
  return 'body'; // 默认 → 当作干货
}

// PCM 拼接 — 解码每段 → 取 Float32 channel data → concat → 包成 WAV
// 这种拼法 0 间隙,听感上和单次合成无差别,但每段可以用不同的合成参数
async function mergeAudioBlobsToWav(blobs) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buffers = [];
  let sampleRate = 0;
  for (const blob of blobs) {
    const buf = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    sampleRate = decoded.sampleRate;
    buffers.push(decoded.getChannelData(0).slice());
  }
  ctx.close();

  const total = buffers.reduce((s, b) => s + b.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const b of buffers) { merged.set(b, off); off += b.length; }
  return pcmFloat32ToWavBlob(merged, sampleRate);
}

function pcmFloat32ToWavBlob(samples, sampleRate) {
  const numCh = 1, bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ============================================================
//  generateTTS — 支持两种模式
//  ① 单次合成(opts.dynamicDelivery=false 或没传 blocks)→ 整段一速,跨句最顺
//  ② 动态合成(opts.dynamicDelivery=true 且有 blocks)→ 按块分别合成 + 各自速度/情感 + PCM 无缝拼接
// ============================================================
export async function generateTTS(text, opts = {}) {
  const cleaned = text.replace(/[【】\[\]]/g, '').trim();
  if (!cleaned) throw new Error('讲稿为空');

  // 动态模式:有 blocks 数组 + 用户开了动态开关
  if (opts.dynamicDelivery && Array.isArray(opts.blocks) && opts.blocks.length >= 2) {
    return generateTTSDynamic(opts.blocks, opts);
  }

  // 单次合成(原有逻辑)
  const audioBlob = await synthOne(cleaned, opts);
  const duration = await audioDuration(audioBlob);

  const sentences = cleaned
    .split(/(?<=[。！？!?\n])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length === 0) {
    return { audioBlob, subtitles: [{ index: 0, start: 0, end: duration, text: cleaned }], duration };
  }

  const totalChars = sentences.reduce((s, x) => s + x.length, 0) || 1;
  let cursor = 0;
  const subtitles = sentences.map((s, i) => {
    const dur = (s.length / totalChars) * duration;
    const item = { index: i, start: cursor, end: cursor + dur, text: s, blockIdx: 0 };
    cursor += dur;
    return item;
  });
  return { audioBlob, subtitles, duration };
}

// 动态合成 — 5 个块各自调一次 TTS(并行),用各自的速度/情感参数,最后 PCM 拼接
async function generateTTSDynamic(blocks, opts) {
  const userSpeed = Number(opts.speed || 1.0);
  console.log('[TTS动态] 开始按块并行合成,共', blocks.length, '块');

  // 并行合成 — 总时长 ≈ 最慢那一块,不是 N 倍
  const synthPromises = blocks.map(async (b) => {
    const kind = detectBlockKind(b.tag);
    const d = BLOCK_DELIVERY[kind];
    const blockOpts = {
      ...opts,
      speed: userSpeed * d.speedMul,
      emotion: d.emotion || opts.emotion,
      emotionScale: d.scale,   // 块间情感强度对比:body=3、hook/twist=5
    };
    const cleanText = (b.text || '').replace(/[【】\[\]]/g, '').trim();
    if (!cleanText) return null;
    console.log(`[TTS动态] ${d.label}: speed=${blockOpts.speed.toFixed(2)} emotion=${blockOpts.emotion}`);
    const blob = await synthOne(cleanText, blockOpts);
    return { blob, text: cleanText, tag: b.tag, kind };
  });

  const results = (await Promise.all(synthPromises)).filter(Boolean);
  if (!results.length) throw new Error('动态合成全部失败');

  // 量每块时长 + PCM 无缝拼接
  const durations = await Promise.all(results.map(r => audioDuration(r.blob)));
  const audioBlob = await mergeAudioBlobsToWav(results.map(r => r.blob));

  // 字幕:按块 → 块内按句 → 块内时长按字符数等比分配
  const subtitles = [];
  let cursor = 0;
  for (let bi = 0; bi < results.length; bi++) {
    const text = results[bi].text;
    const blockDur = durations[bi];
    const sentences = text.split(/(?<=[。！？!?])/).map(s => s.trim()).filter(s => s.length > 0);
    if (sentences.length === 0) { cursor += blockDur; continue; }
    const total = sentences.reduce((s, x) => s + x.length, 0) || 1;
    for (const s of sentences) {
      const dur = (s.length / total) * blockDur;
      subtitles.push({ index: subtitles.length, start: cursor, end: cursor + dur, text: s, blockIdx: bi });
      cursor += dur;
    }
  }

  return { audioBlob, subtitles, duration: cursor };
}

function audioDuration(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.src = url;
    a.addEventListener('loadedmetadata', () => {
      if (isFinite(a.duration) && a.duration > 0) {
        URL.revokeObjectURL(url);
        resolve(a.duration);
      } else {
        decodeDuration(blob).then(resolve).catch(reject);
      }
    });
    a.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      decodeDuration(blob).then(resolve).catch(reject);
    });
  });
}

async function decodeDuration(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await ctx.decodeAudioData(buf);
  const dur = audio.duration;
  ctx.close();
  return dur;
}

export function toSRT(subtitles) {
  const fmt = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  };
  return subtitles.map((s, i) =>
    `${i+1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${s.text}\n`
  ).join('\n');
}

// 连通性测试 — 优先用你的克隆音色(seed-icl-2.0),跟生产路径一致
// 没训练过克隆音色才退回 Mars 1.0(很多账号没开,可能 55000000)
export async function testTTS() {
  const cfg = loadConfig();
  if (cfg.volcVoiceId) {
    // 用克隆音色测,跟实际用法完全一致
    return synthOne('你好。', { voiceType: 'custom' });
  }
  return synthOne('你好。', {});
}
