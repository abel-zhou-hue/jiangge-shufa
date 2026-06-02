// 火山引擎「声音复刻 V3」(2026 推荐版本)
// 文档:https://www.volcengine.com/docs/6561/2227958
//   训练:POST https://openspeech.bytedance.com/api/v3/tts/voice_clone
//   查询:POST https://openspeech.bytedance.com/api/v3/tts/get_voice
// 关键变更 vs V1:
//   - audios[] 数组 → audio 单对象(我们浏览器多段录音 → 拼接 → 转 WAV 一次性提交)
//   - speaker_id 改成「后付费」:固定 "custom_speaker_id" + 自定义 custom_speaker_id
//   - 鉴权改 X-Api-Key (新控) 或 X-Api-App-Key + X-Api-Access-Key (旧控)
//   - 音频必须 wav/mp3/ogg/m4a/aac/pcm,不收 webm,所以浏览器内转码
import { loadConfig, saveConfig } from './config.js';

const TRAIN_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/voice_clone';
const STATUS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/get_voice';

// 训练用文本 v2 — 模仿真实短视频口播节奏,覆盖多种情感+句式+常用音素
//
// 设计原则:
//   ① 像「跟人说话」,不像「读课文」 — 多用"你/我/咱们"
//   ② 情感分布:亲切 / 严肃 / 反问 / 强调 / 调侃 / 温暖收尾 都要有
//   ③ 长度从短到长(8-40 字),让模型学会处理长短句的节奏
//   ④ 包含常用书法词汇 → 实际合成时不会出现陌生字读错
//   ⑤ 故意留自然停顿点(逗号、句号、感叹号、问号)
//
// 读的时候要点(对照括号里的情绪标签去演):
//   - 别"读"字,想象在拍视频时真的对着观众说话
//   - 情感跟着括号走 — 强调句就真的加重、亲切句就带笑意
//   - 录完每句听一下,僵的重录
//   - 麦克风离嘴 15-20cm,关空调、关风扇,微张嘴呼吸再开始
// 每条 = { hint: 怎么读(给你看的情绪指引), text: 实际要念出来的话 }
//
// v3 — 加到 15 句,刻意覆盖**极端韵律**(模型只能在你录过的范围内插值,
// 你录的范围越广,合成时能用的"动态空间"越大)
export const CLONE_TEXTS = [
  { hint: '亲切自我介绍 · 嘴角带笑',     text: '嘿,大家好,我是江哥,专门讲毛笔字怎么写。今天聊点儿干货,你听完就知道怎么练。' },
  { hint: '稳重知识点 · 老师口吻',       text: '毛笔字最讲究的是结构,外松内紧、左低右高,这八个字记住,写字就稳了一半。' },
  { hint: '反问 · 上挑、带怀疑',         text: '你有没有发现,自己写的字老是飘?飘的根源就在悬腕,今天教你三招稳住手。' },
  { hint: '🔥 极端强调 · 真的喊出来',    text: '听好了——这一笔,必、须、要、顿!不顿,整个字就废了,真的废了!' },
  { hint: '🌙 极端温柔 · 像哄人',        text: '你才学三天呐,写成这样真的已经很不错了,别急,慢慢来好不好。' },
  { hint: '平静叙事 · 讲故事节奏',       text: '王羲之写兰亭序那天,写完一遍觉得不够好,又写了好几张,最后还是觉得第一张最自然。' },
  { hint: '互动提问 · 真的想知道',       text: '评论区告诉我,你今天练的是什么字?把照片发上来,明天直播我抽三个点评。' },
  { hint: '😂 调侃 · 自嘲带笑',          text: '别问我为什么写得这么好,问就是临帖五千张。哈,其实也就刚入门,跟你一起练。' },
  { hint: '古风凝重 · 一字一顿',         text: '古人说——字如其人。写字的时候:心要静,手要稳,气要顺。三者缺一,字就散了。' },
  { hint: '温暖收尾 · 长辈语气',         text: '好,今天就到这儿。关注我,每天一字,一年之后回头看你写的字,会感谢现在的自己。' },
  // 下面 5 句新增 — 极端动态范围
  { hint: '⚡ 急促快语速 · 兴奋',         text: '快看!快看!这一笔!对就是这,起笔重、行笔稳、收笔利落,三个动作一秒钟搞定,练!' },
  { hint: '🐢 慢节奏低声 · 沉思',        text: '其实……写一辈子字……到最后……追求的也就两个字——自在。慢一点,你才能听见自己。' },
  { hint: '🎢 大起大落 · 先低后高',       text: '一开始你会觉得难,真的难……但是!坚持三十天之后,你回头一看——卧槽,我居然能写成这样?' },
  { hint: '💧 真情流露 · 带哽咽',         text: '我妈当年教我握毛笔的时候,手都在抖。她说:儿子,字写好了,做人就稳了。这话我记了二十年。' },
  { hint: '🎯 命令式 · 干净利落',         text: '坐直!肩膀放松!笔杆和桌面垂直!现在,深吸一口气,跟着我下笔——一,二,三。' },
];

// ===================== 工具:uuid / base64 =====================
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0;
    const v = c === 'x' ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result;
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ===================== 鉴权 header(新控优先) =====================
function authHeaders(cfg) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Request-Id': uuid(),
  };
  if (cfg.volcApiKey) {
    // 新版控制台:一个 Key 就行
    headers['X-Api-Key'] = cfg.volcApiKey;
  } else if (cfg.volcAppId && cfg.volcToken) {
    // 旧版控制台:AppID + Access Token
    headers['X-Api-App-Key'] = cfg.volcAppId;
    headers['X-Api-Access-Key'] = cfg.volcToken;
  } else {
    throw new Error('请在「设置」配置火山 API Key(新版控制台)或 AppID + Access Token(旧版控制台)');
  }
  return headers;
}

// ===================== 多段 webm → 单个 24kHz mono WAV =====================
// 关键:webm 每段都有自己的 header,直接 Blob 拼接不是合法 webm,只能解出第一段。
// 正确做法:逐段 decodeAudioData → 拿 PCM samples → 拼 Float32Array → 重采样 → 封 WAV。
async function clipsToWav(blobs, targetSR = 24000) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const allChannels = [];
  for (const blob of blobs) {
    const buf = await blob.arrayBuffer();
    try {
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      // 取第 0 个声道(单声道)
      const ch0 = decoded.getChannelData(0).slice();
      allChannels.push({ data: ch0, sampleRate: decoded.sampleRate });
    } catch (e) {
      console.warn('某段音频解码失败,跳过:', e);
    }
  }
  ctx.close();

  if (allChannels.length === 0) throw new Error('所有录音段都解码失败');

  // 拼成一条 Float32(各段 sampleRate 可能不同 → 都重采样到目标 SR 再拼)
  const merged = await resampleAndConcat(allChannels, targetSR);
  // 用 OfflineAudioContext 包成 AudioBuffer 再转 WAV
  const audioBuf = new (window.AudioBuffer || function(opts){ return null; })({
    length: merged.length, numberOfChannels: 1, sampleRate: targetSR,
  });
  if (audioBuf && audioBuf.copyToChannel) {
    audioBuf.copyToChannel(merged, 0);
    return audioBufferToWavBlob(audioBuf);
  }
  // fallback:直接构 PCM WAV
  return pcmFloat32ToWavBlob(merged, targetSR);
}

// 把多段 PCM(可能不同采样率) → 统一目标 SR → 拼成一条
async function resampleAndConcat(channels, targetSR) {
  const resampledList = [];
  for (const { data, sampleRate } of channels) {
    if (sampleRate === targetSR) {
      resampledList.push(data);
      continue;
    }
    // 用 OfflineAudioContext 重采样
    const buf = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate });
    buf.copyToChannel(data, 0);
    const outLen = Math.ceil(data.length * targetSR / sampleRate);
    const offline = new OfflineAudioContext(1, outLen, targetSR);
    const src = offline.createBufferSource();
    src.buffer = buf;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    resampledList.push(rendered.getChannelData(0).slice());
  }
  const total = resampledList.reduce((s, x) => s + x.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const r of resampledList) { merged.set(r, off); off += r.length; }
  return merged;
}

function pcmFloat32ToWavBlob(samples, sampleRate) {
  const numCh = 1;
  const length = samples.length;
  const bytesPerSample = 2;
  const dataSize = length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function audioBufferToWavBlob(audioBuffer) {
  const numCh = 1;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const length = samples.length;
  const bytesPerSample = 2;
  const dataSize = length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                 // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// ===================== 生成合法的 custom_speaker_id =====================
// 规则:8-256 字符;只允许 a-z A-Z 0-9 - _;首尾不能 - _;首字符必须字母;
//      不能命中官方音色保留正则;且不能以 [a-z]{2}_ 开头(zh_/en_/cn_ 等被占)
export function makeCustomSpeakerId(prefix = 'jianggeshufa') {
  // prefix 至少 3 字母,保证不被 [a-z]{2}_ 命中
  const safePrefix = prefix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let id = `${safePrefix}_${suffix}`;
  // 二次校验
  if (id.length < 8) id = id.padEnd(8, 'x');
  if (id.length > 250) id = id.slice(0, 250);
  return id;
}

// ===================== 错误码 → 人话提示 =====================
function hintForCode(code) {
  const c = String(code);
  if (c === '45001109') {
    return '\n→ WER 文本校验失败。本工具已不再上传 text,若仍报此码,说明录音里有较多杂音/口齿不清,请换安静环境、靠近麦克风重录。';
  }
  if (c === '400') {
    return '\n→ 请求被拒。多半是录音太短/太长或有杂音;每段建议读满 5-10 秒、总时长别超 100 秒,环境安静。';
  }
  if (c.startsWith('4500')) {
    return '\n→ 音频质量类问题(过短、过吵、信噪比低)。请在安静房间、离麦克风近一点重录。';
  }
  if (c === '401' || c === '403' || c.startsWith('100')) {
    return '\n→ 鉴权失败。请到「设置」核对火山 X-Api-Key(新版控制台)是否填对、声音复刻服务是否已开通。';
  }
  return '';
}

// ===================== 提交训练 =====================
// audios: [{ text, blob }, ...]  (blob 是 webm,内部逐段解码 → 拼 PCM → 转 WAV)
export async function submitClone(audios, opts = {}) {
  const cfg = loadConfig();

  // 1) 多段 webm 逐个解码 → 拼成单条 24kHz mono WAV
  const wavBlob = await clipsToWav(audios.map(a => a.blob), 24000);

  // 2) base64
  const audioB64 = await blobToBase64(wavBlob);

  // 3) custom_speaker_id(后付费,无需提前在控制台买音色 slot)
  const customId = opts.customSpeakerId || makeCustomSpeakerId();

  // 4) 关键:不传 text!
  //    官方文档明确:text 是「可选」字段,唯一作用是让服务把音频做 ASR、和这段文本比对,
  //    差异过大就返回 45001109 WERError —— 这正是之前一直 400 的根因(WER 0.717)。
  //    声音复刻(ICL)本身不需要文本,模型内部会自己做 ASR。官方两个请求示例都没有 text。
  //    所以这里彻底不传 text,从根上消除 WER 校验失败。
  const payload = {
    speaker_id: 'custom_speaker_id',  // 固定值,告知走后付费
    custom_speaker_id: customId,
    audio: {
      data: audioB64,
      format: 'wav',
    },
    language: 0,                       // 0 = 中文
    extra_params: {
      enable_audio_denoise: true,      // 家里录音环境通常不完美,开降噪
      voice_clone_denoise_model_id: '',
    },
  };

  const proxy = cfg.corsProxy || 'http://localhost:5174';
  const url = `${proxy}/?target=${encodeURIComponent(TRAIN_ENDPOINT)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // 火山训练失败时 HTTP 非 200,body 是 {code, message}。把它解出来,别再让 Abel 猜
    let code = res.status, msg = txt.slice(0, 300);
    try {
      const j = JSON.parse(txt);
      if (j.code) code = j.code;
      if (j.message) msg = j.message;
    } catch (_) {}
    throw new Error(`提交训练失败 [${code}] ${msg}${hintForCode(code)}`);
  }
  const data = await res.json();
  if (data.code && data.code !== 0 && data.code !== 200 && data.code !== 3000) {
    throw new Error(`训练失败 [${data.code}] ${data.message || ''}${hintForCode(data.code)}`);
  }

  return { speakerId: customId, response: data };
}

// ===================== 轮询状态 =====================
// 返回的 status: 0=NotFound 1=Training 2=Success 3=Failed 4=Active
export async function pollCloneStatus(customSpeakerId) {
  const cfg = loadConfig();
  const proxy = cfg.corsProxy || 'http://localhost:5174';
  const url = `${proxy}/?target=${encodeURIComponent(STATUS_ENDPOINT)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({
      speaker_id: 'custom_speaker_id',
      custom_speaker_id: customSpeakerId,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`查询训练状态失败 [${res.status}]: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

export function saveClonedVoiceId(voiceId) {
  saveConfig({ volcVoiceId: voiceId });
}
