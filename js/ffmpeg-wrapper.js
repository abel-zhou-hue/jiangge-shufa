// ffmpeg.wasm 封装 — 视频合成核心
// 用单线程版本(无需 SharedArrayBuffer / COOP-COEP)
//
// 重要: ffmpeg 0.12.10 用 `{type:'module'}` 构造 Worker
//   - module worker 没有 importScripts(UMD worker 失败)
//   - blob URL 的 ESM worker 里的相对 import 会失败
//   - 唯一靠谱方案 = 把 ffmpeg/ffmpeg-util/ffmpeg-core 全部下到 vendor/,同源直接 import
import { FFmpeg } from '../vendor/ffmpeg/index.js';
import { fetchFile } from '../vendor/ffmpeg-util/index.js';

let ffmpeg = null;
let loading = null;

// 同源绝对 URL — 给 worker 传过去,它再 import() 这两个
const CORE_URL = new URL('../vendor/ffmpeg-core/ffmpeg-core.esm.js', import.meta.url).href;
const WASM_URL = new URL('../vendor/ffmpeg-core/ffmpeg-core.esm.wasm', import.meta.url).href;

export async function loadFFmpeg(onLog) {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  if (loading) return loading;

  loading = (async () => {
    const ff = new FFmpeg();
    if (onLog) ff.on('log', ({ message }) => onLog(message));
    // 同源 → 不需要 blob 包装,worker 内部直接 dynamic import
    await ff.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
    ffmpeg = ff;
    return ff;
  })();
  return loading;
}

export { fetchFile };

// ============= 字体管理 =============
// 用户在 assets/fonts/ 放的两个毛笔字体,通过 @font-face 注册了 JiangeBrush1/2
// 渲染 PNG 前必须先确保字体加载完,否则 canvas 会用 fallback 字体出错字
export const FONT_OPTIONS = {
  brush1:  { cssName: 'JiangeBrush1', label: '毛笔体 1' },
  brush2:  { cssName: 'JiangeBrush2', label: '毛笔体 2' },
  default: { cssName: 'STKaiti',     label: '系统楷书' },
};

function fontFamilyStack(key) {
  const main = FONT_OPTIONS[key]?.cssName || 'STKaiti';
  return `"${main}", "STKaiti", "KaiTi", "PingFang SC", serif`;
}

let fontsReady = null;
export async function ensureFontsLoaded() {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    try {
      // 至少把这两个尺寸预热一下 — 触发 @font-face 真正下载
      await Promise.allSettled([
        document.fonts.load('48px "JiangeBrush1"'),
        document.fonts.load('48px "JiangeBrush2"'),
      ]);
      await document.fonts.ready;
      console.log('[字体] 毛笔字体已加载');
    } catch (e) { console.warn('[字体] 加载失败,会用 fallback', e); }
  })();
  return fontsReady;
}

// ============= 板书 — 宣纸卷轴印章风 =============
// 米黄宣纸底 + 朱红双线边框 + 毛笔字标题 + 要点 + 右下角红印章
// 默认 360 宽,高度按内容自适应
export async function renderBlackboardPNG(points, opts = {}) {
  await ensureFontsLoaded();
  const fontFamily = fontFamilyStack(opts.fontKey || 'brush1');
  const style = opts.style || 'scroll';   // scroll | minimal | seal | bamboo
  const sealText = opts.sealText || '江哥';

  switch (style) {
    case 'minimal': return renderMinimalInk(points, fontFamily);
    case 'seal':    return renderSealBlock(points, fontFamily);
    case 'bamboo':  return renderBambooSlip(points, fontFamily, sealText);
    default:        return renderScrollPaper(points, fontFamily, sealText);
  }
}

// 🪧 宣纸卷轴风(默认)
function renderScrollPaper(points, fontFamily, sealText) {
  const pts = (points || []).slice(0, 5);
  const W = 360;
  const pad = 16;
  const titleH = 80;
  const lineH = 56;
  const sealH = 60;
  const H = pad*2 + titleH + pts.length * lineH + sealH;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // 米黄宣纸底
  ctx.fillStyle = '#fdf6e0';
  ctx.fillRect(0, 0, W, H);
  // 纸纹噪点
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(139,90,43,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }
  // 朱红双线边框
  ctx.strokeStyle = '#8b1d1d';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.lineWidth = 1;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  // 标题"字诀"
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `bold 48px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('字诀', W / 2, pad + 14);

  // 标题下小横线装饰
  ctx.strokeStyle = '#8b1d1d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 40, pad + 70);
  ctx.lineTo(W / 2 + 40, pad + 70);
  ctx.stroke();

  // 要点
  ctx.fillStyle = '#222';
  ctx.font = `40px ${fontFamily}`;
  ctx.textAlign = 'left';
  let y = pad + titleH;
  for (const p of pts) {
    ctx.fillText(`· ${p}`, pad + 24, y);
    y += lineH;
  }

  // 朱印章(右下角)
  const seal = 50;
  const sx = W - seal - pad - 6;
  const sy = H - seal - pad;
  ctx.fillStyle = '#a31818';
  ctx.fillRect(sx, sy, seal, seal);
  // 内边白线
  ctx.strokeStyle = '#fdf6e0';
  ctx.lineWidth = 1;
  ctx.strokeRect(sx + 4, sy + 4, seal - 8, seal - 8);
  ctx.fillStyle = '#fdf6e0';
  ctx.font = `bold ${Math.min(24, seal/sealText.length*1.4)}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sealText.slice(0, 2), sx + seal/2, sy + seal/2);

  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/png'));
}

// 💧 极简水墨风
function renderMinimalInk(points, fontFamily) {
  const pts = (points || []).slice(0, 5);
  const W = 320, pad = 14;
  const lineH = 52;
  const H = pad*2 + 50 + pts.length * lineH;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 半透明白底
  ctx.fillStyle = 'rgba(255,255,253,0.88)';
  ctx.fillRect(0, 0, W, H);
  // 左侧淡墨竖条装饰
  const grd = ctx.createLinearGradient(0, 0, 8, 0);
  grd.addColorStop(0, '#1a1a1a');
  grd.addColorStop(1, 'rgba(26,26,26,0.1)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 8, H);
  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = `bold 32px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('要点', pad + 18, pad);
  // 要点
  ctx.font = `34px ${fontFamily}`;
  let y = pad + 50;
  for (const p of pts) {
    ctx.fillText(`— ${p}`, pad + 18, y);
    y += lineH;
  }
  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/png'));
}

// 🔴 朱印方框风(单句强调)
function renderSealBlock(points, fontFamily) {
  const text = (points || [])[0] || '重点';
  const W = 360, H = 360, pad = 18;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 朱红整块
  ctx.fillStyle = '#a31818';
  ctx.fillRect(0, 0, W, H);
  // 白边
  ctx.strokeStyle = '#fdf6e0';
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, pad, W - pad*2, H - pad*2);
  // 大字
  ctx.fillStyle = '#fdf6e0';
  const lines = text.split(/[、,，\s]/).filter(Boolean).slice(0, 4);
  const fontSize = Math.min(80, Math.floor(W / Math.max(2, Math.max(...lines.map(l => l.length)))));
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineH = fontSize * 1.2;
  const startY = H/2 - (lines.length - 1) * lineH / 2;
  lines.forEach((l, i) => ctx.fillText(l, W/2, startY + i * lineH));
  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/png'));
}

// 🎋 木简竹简风(竖排)
function renderBambooSlip(points, fontFamily, sealText) {
  const pts = (points || []).slice(0, 4);
  const slipW = 70, gap = 8, pad = 14;
  const W = pad*2 + pts.length * slipW + (pts.length - 1) * gap;
  const H = 420;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 整体米黄底
  ctx.fillStyle = '#f4e7c8';
  ctx.fillRect(0, 0, W, H);
  // 每根竹简
  pts.forEach((p, i) => {
    const sx = pad + i * (slipW + gap);
    // 竹简底色
    const grd = ctx.createLinearGradient(sx, 0, sx + slipW, 0);
    grd.addColorStop(0, '#d9b97f');
    grd.addColorStop(0.5, '#e6cb95');
    grd.addColorStop(1, '#c7a16a');
    ctx.fillStyle = grd;
    ctx.fillRect(sx, pad, slipW, H - pad*2);
    // 顶/底深色绑绳横条
    ctx.fillStyle = 'rgba(80,40,20,0.4)';
    ctx.fillRect(sx, pad + 20, slipW, 4);
    ctx.fillRect(sx, H - pad - 24, slipW, 4);
    // 竖排字(每竹一句,最多 6 字,超出截断)
    const txt = p.slice(0, 6);
    ctx.fillStyle = '#2a1a08';
    ctx.font = `38px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    txt.split('').forEach((ch, j) => {
      ctx.fillText(ch, sx + slipW/2, pad + 36 + j * 50);
    });
  });
  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/png'));
}

// ============= 字幕 — PNG 叠加方案 =============
// 走 ffmpeg drawtext 路:ffmpeg.wasm 默认字体不带中文 → 字渲染不出
// 改用「浏览器 canvas 用系统中文字体画 PNG」→ 每条字幕一张透明背景的 PNG → ffmpeg overlay
//   - 中文渲染 100% 可靠(浏览器有 PingFang / 黑体 / 雅黑)
//   - 描边 + 阴影都能在 canvas 里精确做
//   - 字幕时间通过 overlay 的 enable='between(t,start,end)' 表达式控制
export async function renderSubtitlePNG(text, { canvasWidth = 1080, fontSize = 56, fontKey = 'brush1' } = {}) {
  await ensureFontsLoaded();
  const fontFamily = fontKey === 'default'
    ? '"PingFang SC","Source Han Sans SC","Microsoft YaHei","STHeiti",sans-serif'
    : fontFamilyStack(fontKey);
  const c = document.createElement('canvas');
  c.width = canvasWidth;
  c.height = Math.round(fontSize * 1.9);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  ctx.font = `900 ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = c.width / 2;
  const cy = c.height / 2;

  // 1) 黑色描边(浓厚) — 任何背景都能看清,黄字更需要厚黑边压住
  ctx.strokeStyle = 'rgba(0,0,0,0.98)';
  ctx.lineWidth = Math.round(fontSize / 6);   // 比白字版略粗,让黄字"挑"得起来
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeText(text, cx, cy);

  // 2) 抖音爆款黄字(暖黄,不刺眼)
  ctx.fillStyle = '#FFE600';
  ctx.fillText(text, cx, cy);

  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/png'));
}

// 主合成 — 输入 videoBlob + audioBlob + 选项,输出 mp4 Blob
export async function compose({
  videoBlob,
  audioBlob,
  blackboardPoints,
  subtitles,
  enableBlackboard = true,
  enableSubtitle = true,
  mizigeBlob = null,
  mizigePos = { x: 4, y: 4, size: 30 },
  // 板书新增:风格 + 拖拽位置 + 出现时机
  blackboardStyle = 'scroll',                // scroll | minimal | seal | bamboo
  blackboardPos = { x: 62, y: 4, size: 32 }, // 默认右上角
  blackboardTiming = { start: 0, end: null },// { start: 秒, end: 秒或 null=到末尾 }
  // 字体(字幕 + 板书共用)
  fontKey = 'brush1',
  sealText = '江哥',
  outputWidth = 1080,
  outputHeight = 1920,
  onProgress,
  onLog,
}) {
  const ff = await loadFFmpeg(onLog);
  if (onProgress) ff.on('progress', ({ progress }) => onProgress(progress));

  // 写入素材
  const videoName = 'in.' + (videoBlob.type.includes('webm') ? 'webm' : 'mp4');
  await ff.writeFile(videoName, await fetchFile(videoBlob));
  await ff.writeFile('voice.mp3', await fetchFile(audioBlob));

  if (enableBlackboard) {
    const bbBlob = await renderBlackboardPNG(blackboardPoints || [], { style: blackboardStyle, fontKey, sealText });
    await ff.writeFile('bb.png', await fetchFile(bbBlob));
  }
  if (mizigeBlob) {
    await ff.writeFile('mz.png', await fetchFile(mizigeBlob));
  }

  // 构造 filter_complex
  const W = outputWidth, H = outputHeight;
  const filters = [];

  // 主视频:scale + crop 到 9:16
  filters.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v0]`);

  // 输入索引: [0]=主视频 [1]=音频 [2]=黑板(如启用) [3 or 2]=米字格(如启用)
  let nextIdx = 2;
  let chainIn = 'v0';

  if (enableBlackboard) {
    const bbIdx = nextIdx++;
    const bbW = Math.round(W * (blackboardPos.size / 100));
    const bbX = Math.round(W * (blackboardPos.x / 100));
    const bbY = Math.round(H * (blackboardPos.y / 100));
    // 出现时机:start/end 决定 enable 表达式
    const t0 = Number(blackboardTiming?.start || 0);
    const t1 = blackboardTiming?.end != null ? Number(blackboardTiming.end) : null;
    const enableExpr = t1 != null
      ? `:enable='between(t,${t0.toFixed(2)},${t1.toFixed(2)})'`
      : (t0 > 0.01 ? `:enable='gte(t,${t0.toFixed(2)})'` : '');
    filters.push(`[${bbIdx}:v]scale=${bbW}:-1[bb]`);
    filters.push(`[${chainIn}][bb]overlay=${bbX}:${bbY}${enableExpr}[v_bb]`);
    chainIn = 'v_bb';
  }

  if (mizigeBlob) {
    const mzIdx = nextIdx++;
    const mzW = Math.round(W * (mizigePos.size / 100));
    const mzX = Math.round(W * (mizigePos.x / 100));
    const mzY = Math.round(H * (mizigePos.y / 100));
    // -1 高度按原图比例,保持单字米字格正方形 / 多字网格的长方形
    filters.push(`[${mzIdx}:v]scale=${mzW}:-1[mz]`);
    filters.push(`[${chainIn}][mz]overlay=${mzX}:${mzY}[v_mz]`);
    chainIn = 'v_mz';
  }

  // 字幕(可选) — 浏览器 canvas 渲染 PNG → ffmpeg overlay,中文 100% 可用
  // 每条字幕一张 PNG,通过 overlay 的 enable='between' 控制显示时段
  let subCount = 0;
  if (enableSubtitle && subtitles && subtitles.length > 0) {
    // 安全上限:防止极端长视频生成几十个 PNG 拖垮 ffmpeg
    const maxSubs = 40;
    const safeSubs = subtitles.slice(0, maxSubs);

    for (let i = 0; i < safeSubs.length; i++) {
      const raw = (safeSubs[i].text || '').trim();
      if (!raw) continue;
      // 一行最多 18 个字,太长换行(画 2 行 PNG)
      const txt = raw.length > 18 ? raw.slice(0, 18) + '…' : raw;
      const subBlob = await renderSubtitlePNG(txt, { canvasWidth: W, fontSize: 56, fontKey });
      const filename = `sub${subCount}.png`;
      await ff.writeFile(filename, await fetchFile(subBlob));
      safeSubs[i]._fname = filename;
      safeSubs[i]._idx = subCount;
      subCount++;
    }

    for (const s of safeSubs) {
      if (!s._fname) continue;
      const subIdx = nextIdx++;
      // 底部上方一些,避开抖音底部 UI(关注/评论/分享条),约画面高 15%
      const subY = Math.round(H * 0.78);
      filters.push(
        `[${subIdx}:v]scale=${Math.round(W*0.92)}:-1[sub${s._idx}]`
      );
      filters.push(
        `[${chainIn}][sub${s._idx}]overlay=(W-w)/2:${subY}:enable='between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})'[v_s${s._idx}]`
      );
      chainIn = `v_s${s._idx}`;
    }
  }

  const filterStr = filters.join(';');

  // 构造命令 — 输入顺序必须和上面 nextIdx 对应
  const args = ['-i', videoName, '-i', 'voice.mp3'];
  if (enableBlackboard) args.push('-i', 'bb.png');
  if (mizigeBlob)       args.push('-i', 'mz.png');
  for (let i = 0; i < subCount; i++) args.push('-i', `sub${i}.png`);
  args.push(
    '-filter_complex', filterStr,
    '-map', `[${chainIn}]`,
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-shortest',
    '-movflags', '+faststart',
    'out.mp4',
  );

  await ff.exec(args);

  const data = await ff.readFile('out.mp4');
  // 清理
  try {
    await ff.deleteFile(videoName);
    await ff.deleteFile('voice.mp3');
    if (enableBlackboard) await ff.deleteFile('bb.png');
    if (mizigeBlob)       await ff.deleteFile('mz.png');
    for (let i = 0; i < subCount; i++) await ff.deleteFile(`sub${i}.png`);
    await ff.deleteFile('out.mp4');
  } catch (e) {}

  return new Blob([data.buffer], { type: 'video/mp4' });
}
