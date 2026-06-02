// 主控:页面切换、事件绑定、状态串联
import { loadConfig, saveConfig, getConfiguredCount, listVoices, addVoice, removeVoice, setDefaultVoice, renameVoice } from './config.js';
import { saveProject, listProjects, putBlob, getBlob, pickAndSaveDir, loadDirHandle, writeFileToDir, saveCopybook, listCopybooks, getCopybook, deleteCopybook, touchCopybook, renameCopybook } from './storage.js';
import { generateScript, checkMultiCharCompliance } from './deepseek.js';
import { generateTTS, toSRT, testTTS } from './volcengine-tts.js';
import { CLONE_TEXTS, submitClone, pollCloneStatus, saveClonedVoiceId } from './volcengine-clone.js';
import { recognizeCharFromImage, analyzeCharDeep } from './doubao-vision.js';
import { listCameras, startPreview, stopPreview, startRecord, stopRecord, startMicRecord, stopMicRecord } from './camera.js';
import { loadFFmpeg, compose, renderBlackboardPNG } from './ffmpeg-wrapper.js';
import { renderPDFToContainer, enableBoxSelect } from './pdf-handler.js';
import { renderMiZiGe, renderMiZiGeGrid } from './mizige.js';

// ================= 全局状态 =================
const state = {
  char: '永',
  style: '楷书',
  duration: 60,
  tone: '干货教学',
  audience: '零基础',
  script: null,            // { blocks, blackboard, plainText }
  audioBlob: null,
  subtitles: null,
  voiceType: 'custom',  // 默认用克隆音色(2.0 模型,最自然)
  speed: 1.0,
  emotion: '自然',
  useV3Engine: false,    // 🧪 V3 引擎(uranus model_type=5)
  dynamicDelivery: true, // 🎭 动态语速 + 情感(按块分别合成 + PCM 拼接)
  videoBlob: null,
  finalBlob: null,
  template: 'pure',
  enableBlackboard: true,
  enableSubtitle: true,
  // 米字格叠加(由用户在录制页拖拽编辑)
  enableMizige: false,
  mizigePos: { x: 4, y: 4, size: 30 },
  // 板书/字幕 字体 + 板书风格 + 板书位置
  fontKey: 'brush1',                            // brush1 / brush2 / default
  blackboardStyle: 'scroll',                    // scroll / minimal / seal / bamboo
  blackboardPos: { x: 62, y: 4, size: 32 },     // 默认右上角
  blackboardTiming: 'summary',                  // summary(默认,结尾才蹦出) / body / bodyOnly / all
  platform: 'douyin',
  brand: 'clean',
  // 克隆
  cloneAudios: [],         // [{ text, blob }]
  cloneCurrentIdx: 0,
  // 多字选字清单 — 每项 { char, style, cropBlob?, miziBlob? }
  // 第一个字是「主字」(用于讲稿生成、视频里的主体);多于 1 个时合成网格米字格
  selectedChars: [],
  miziCompositeBlob: null, // 当前合成出的米字格大图(单字=单格,多字=网格)
};

// ================= 工具函数 =================
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.classList.remove('show'), 2500);
}

function setProgress(pct, text) {
  const fill = $('#progress-fill');
  const txt = $('#progress-text');
  if (fill) fill.style.width = (pct * 100).toFixed(0) + '%';
  if (txt && text) txt.textContent = text;
}

function showPage(name) {
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $(`#page-${name}`);
  if (el) el.classList.add('active');
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
  // 进音色库页时刷新列表(因为别处可能已经加了新的)
  if (name === 'voice') renderVoiceList();
  if (name === 'new')   renderCopybookList();
}

// ================= 启动 =================
window.addEventListener('DOMContentLoaded', async () => {
  bindNav();
  bindHomepage();
  bindNewVideoPage();
  bindScriptPage();
  bindTTSPage();
  bindRecordPage();
  bindFinalPage();
  bindSettingsPage();
  bindVoiceClonePage();
  bindToastClose();

  refreshConfigStatus();
  refreshHistory();
  initSettingsForm();
  renderCloneList();
  renderVoiceList();
  renderCopybookList();
});

// ================= 导航 =================
function bindNav() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page));
  });
}

// ================= 首页 =================
function bindHomepage() {
  $('#btn-create-new').addEventListener('click', () => showPage('new'));
}

async function refreshHistory() {
  const list = await listProjects().catch(() => []);
  const recent = list.slice(0, 5);
  const recentEl = $('#recent-list');
  const historyEl = $('#history-list');
  const renderItem = (p) => `
    <div class="template-item" data-id="${p.id}">
      <strong>${p.char}-${p.style}-${p.duration}秒</strong>
      <span style="float:right;color:#888;font-size:12px;">${new Date(p.createdAt).toLocaleString()}</span>
    </div>`;
  if (recentEl) recentEl.innerHTML = recent.length ? recent.map(renderItem).join('') : '<div class="empty">还没有作品,新建一个吧</div>';
  if (historyEl) historyEl.innerHTML = list.length ? list.map(renderItem).join('') : '<div class="empty">还没有作品</div>';

  // 统计
  $('#stat-videos') && ($('#stat-videos').textContent = list.length);
  const today = new Date(); today.setHours(0,0,0,0);
  const todayCount = list.filter(p => p.createdAt >= today.getTime()).length;
  $('#stat-month') && ($('#stat-month').textContent = todayCount);
  $('#stat-api') && ($('#stat-api').textContent = '¥' + (list.length * 0.15).toFixed(2));
}

function refreshConfigStatus() {
  const cnt = getConfiguredCount();
  $('#stat-config') && ($('#stat-config').textContent = `${cnt}/3`);
  const apiStatus = $('#api-status');
  if (apiStatus) {
    apiStatus.textContent = cnt === 0 ? '⚪ 未配置' : cnt === 3 ? '🟢 已就绪' : `🟡 ${cnt}/3`;
  }
}

// ================= 新建视频页 =================
function bindNewVideoPage() {
  // tabs
  $$('#page-new .tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('#page-new .tab').forEach(x => x.classList.remove('active'));
      $$('#page-new .tab-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $(`#page-new .tab-panel[data-panel="${t.dataset.tab}"]`).classList.add('active');
    });
  });

  // radio groups
  $$('#page-new .radio-group').forEach(group => {
    const name = group.dataset.name;
    group.querySelectorAll('.radio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state[name] = isNaN(Number(btn.dataset.value)) ? btn.dataset.value : Number(btn.dataset.value);
        updatePreview();
      });
    });
  });

  // input char — 支持多字。文字输入是「权威源」:每次输入会覆盖纯文字部分
  // (来自字帖框选的字带 cropBlob,不被覆盖,会保留)
  $('#input-char').addEventListener('input', (e) => {
    const raw = (e.target.value || '').replace(/[\s,，、]/g, '');
    // 保留有 cropBlob 的字(来自字帖识图);其余按文本输入重排
    const keepers = state.selectedChars.filter(c => c.cropBlob);
    const keeperChars = keepers.map(c => c.char);
    const newOnes = [];
    for (const ch of raw) {
      if (!keeperChars.includes(ch) && !newOnes.find(x => x.char === ch)) {
        newOnes.push({ char: ch, style: state.style });
      }
    }
    state.selectedChars = [...keepers, ...newOnes].slice(0, 9);
    syncPrimaryChar();
    renderSelectedChars();
    updateMiziPreview();
    updatePreview();
  });

  // 字库 → 点一个加一个(去重)
  $$('.char-pill').forEach(p => {
    p.addEventListener('click', () => {
      addSelectedChar({ char: p.textContent.trim(), style: state.style });
    });
  });

  // 清空选字
  $('#btn-clear-chars').addEventListener('click', () => {
    state.selectedChars = [];
    state.miziCompositeBlob = null;
    $('#input-char').value = '';
    syncPrimaryChar();
    renderSelectedChars();
    updateMiziPreview();
    updatePreview();
  });

  // 下载米字格图
  $('#btn-download-mizige').addEventListener('click', () => {
    if (!state.miziCompositeBlob) return;
    const url = URL.createObjectURL(state.miziCompositeBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mizige_${state.selectedChars.map(c=>c.char).join('')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // PDF upload
  const pdfArea = $('#pdf-upload-area');
  const pdfInput = $('#pdf-file-input');
  pdfArea.addEventListener('click', () => pdfInput.click());
  pdfArea.addEventListener('dragover', e => { e.preventDefault(); pdfArea.classList.add('dragover'); });
  pdfArea.addEventListener('dragleave', () => pdfArea.classList.remove('dragover'));
  pdfArea.addEventListener('drop', e => {
    e.preventDefault();
    pdfArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handlePDF(e.dataTransfer.files[0]);
  });
  pdfInput.addEventListener('change', e => { if (e.target.files[0]) handlePDF(e.target.files[0]); });

  // 生成讲稿
  $('#btn-generate-script').addEventListener('click', onGenerateScript);
}

function updatePreview() {
  $('#char-preview').textContent = state.char;
  $('#meta-char').textContent = state.char;
  $('#meta-style').textContent = state.style;
  $('#meta-duration').textContent = state.duration + (state.duration >= 60 ? '秒' : '秒');
}

// 当前选中的字帖 id(从字帖库点开的;新上传的等保存后也会赋值)
let activeCopybookId = null;

async function handlePDF(file, opts = {}) {
  const container = $('#pdf-preview');
  container.innerHTML = '<div class="hint">正在加载 PDF...</div>';
  try {
    const pages = await renderPDFToContainer(file, container);

    // 渲染完成 → 第一页做缩略图(只在首次保存时用得到)
    let thumb = '';
    if (pages[0]) {
      try {
        const tmp = document.createElement('canvas');
        const ratio = pages[0].height / pages[0].width;
        tmp.width = 200;
        tmp.height = Math.round(200 * ratio);
        tmp.getContext('2d').drawImage(pages[0], 0, 0, tmp.width, tmp.height);
        thumb = tmp.toDataURL('image/jpeg', 0.75);
      } catch (_) {}
    }

    pages.forEach(canvas => {
      enableBoxSelect(canvas, async (cropBlob) => {
        toast('正在识别...', '');
        try {
          const result = await recognizeCharFromImage(cropBlob);
          if (result.char) {
            if (result.style) {
              state.style = result.style;
              $$('#page-new .radio-group[data-name="style"] .radio-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.value === result.style);
              });
            }
            // 框选只做快速识别,深度分析延后到「生成讲稿」一步
            // 主字的 cropBlob 留在 selectedChars 里,讲稿步会用它做深度分析
            await addSelectedChar({
              char: result.char,
              style: result.style || state.style,
              cropBlob,
              analysis: null,   // 占位 — 生成讲稿时再填
            });
            toast(`已加入: ${result.char} (${result.style || '未知书体'})`, 'success');
          } else {
            toast('识别失败,试试更清晰、更紧凑的框选', 'error');
          }
        } catch (e) {
          toast(e.message || String(e), 'error');
        }
      });
    });

    // 新上传的 → 保存到字帖库;从字帖库点开的 → 仅更新最近使用时间
    if (opts.copybookId) {
      activeCopybookId = opts.copybookId;
      await touchCopybook(opts.copybookId);
    } else {
      const name = (file.name || '未命名字帖').replace(/\.pdf$/i, '');
      try {
        const id = await saveCopybook({ name, fileBlob: file, thumbnailDataUrl: thumb });
        activeCopybookId = id;
        toast(`已保存到字帖库:${name}`, 'success');
      } catch (e) {
        console.warn('保存字帖失败', e);
      }
    }
    renderCopybookList();
  } catch (e) {
    container.innerHTML = `<div class="hint">PDF 加载失败:${e.message}</div>`;
  }
}

// ================= 多字选字清单 + 米字格预览 =================
async function addSelectedChar(item) {
  // item: { char, style?, cropBlob? }
  if (!item?.char) return;
  // 去重:相同 char 已存在就替换(用新的 cropBlob 覆盖,可能是更好的截图)
  const idx = state.selectedChars.findIndex(c => c.char === item.char);
  if (idx >= 0) {
    state.selectedChars[idx] = { ...state.selectedChars[idx], ...item };
  } else {
    if (state.selectedChars.length >= 9) {
      toast('一次最多 9 个字', 'error');
      return;
    }
    state.selectedChars.push(item);
  }
  syncPrimaryChar();
  renderSelectedChars();
  await updateMiziPreview();
  updatePreview();
}

function syncPrimaryChar() {
  // 主字 = 列表第一个,用于讲稿生成、视频主体显示
  const primary = state.selectedChars[0];
  if (primary) {
    state.char = primary.char;
    if (primary.style) state.style = primary.style;
    // 把列表同步回输入框,方便用户继续编辑
    $('#input-char').value = state.selectedChars.map(c => c.char).join('');
  } else {
    state.char = '';
    $('#input-char').value = '';
  }
}

function renderSelectedChars() {
  const root = $('#selected-chars');
  if (!root) return;
  if (!state.selectedChars.length) {
    root.innerHTML = `<div class="empty">从字帖框选 / 上面输入 / 字库点选 来添加字</div>`;
    $('#selected-count').textContent = '';
    return;
  }
  $('#selected-count').textContent = `(${state.selectedChars.length} 个 / 上限 9)`;
  root.innerHTML = state.selectedChars.map((c, i) => {
    const thumb = c.cropBlob
      ? `<img src="${URL.createObjectURL(c.cropBlob)}" alt="${c.char}" />`
      : `<span style="user-select:none">${escapeHtml(c.char)}</span>`;
    return `
      <div class="selected-char ${i === 0 ? 'primary' : ''}" data-idx="${i}" title="${escapeHtml(c.char + (c.style ? ' · '+c.style : '') + (i === 0 ? ' · 主字' : ''))}">
        ${thumb}
        <button class="sc-del" data-act="del" title="移除">✕</button>
      </div>`;
  }).join('');

  root.querySelectorAll('.selected-char').forEach(node => {
    const i = Number(node.dataset.idx);
    node.querySelector('[data-act="del"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      state.selectedChars.splice(i, 1);
      syncPrimaryChar();
      renderSelectedChars();
      await updateMiziPreview();
      updatePreview();
    });
  });
}

async function updateMiziPreview() {
  const img = $('#mizige-img');
  const empty = $('#mizige-empty');
  const dlBtn = $('#btn-download-mizige');
  if (!img || !empty) return;
  if (!state.selectedChars.length) {
    img.style.display = 'none';
    empty.style.display = 'block';
    dlBtn.style.display = 'none';
    state.miziCompositeBlob = null;
    return;
  }
  empty.style.display = 'none';
  try {
    const blob = state.selectedChars.length === 1
      ? await renderMiZiGe(state.selectedChars[0])
      : await renderMiZiGeGrid(state.selectedChars, { cellSize: 420, gap: 14 });
    state.miziCompositeBlob = blob;
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
    img.style.display = 'block';
    dlBtn.style.display = 'inline-block';
  } catch (e) {
    console.warn('米字格生成失败', e);
    empty.textContent = '生成失败 — 看控制台';
    empty.style.display = 'block';
  }
}

async function renderCopybookList() {
  const root = $('#copybook-list');
  if (!root) return;
  let books;
  try { books = await listCopybooks(); } catch (e) { console.warn(e); return; }

  if (!books.length) {
    root.innerHTML = `<div class="empty">还没有保存过字帖 — 上传一个开始</div>`;
    return;
  }

  root.innerHTML = books.map(b => {
    const date = b.lastUsedAt ? new Date(b.lastUsedAt).toLocaleDateString('zh-CN') : '';
    const cover = b.thumbnailDataUrl
      ? `<div class="cover" style="background-image:url('${b.thumbnailDataUrl}')"></div>`
      : `<div class="cover empty-cover">📄</div>`;
    return `
      <div class="copybook-card ${activeCopybookId === b.id ? 'active' : ''}" data-id="${b.id}" title="点击加载这本字帖">
        <button class="cb-del" data-act="delete" title="删除">✕</button>
        ${cover}
        <div class="meta">
          <div class="cb-name">${escapeHtml(b.name || '未命名')}</div>
          <div class="cb-date">${date}</div>
        </div>
      </div>`;
  }).join('');

  root.querySelectorAll('.copybook-card').forEach(card => {
    const id = Number(card.dataset.id);
    card.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const nameTxt = card.querySelector('.cb-name').textContent;
      if (!confirm(`删除字帖「${nameTxt}」?`)) return;
      try {
        await deleteCopybook(id);
        if (activeCopybookId === id) activeCopybookId = null;
        renderCopybookList();
        toast('已删除', '');
      } catch (err) { toast('删除失败: ' + err.message, 'error'); }
    });
    card.addEventListener('click', async () => {
      try {
        const cb = await getCopybook(id);
        if (!cb) return toast('字帖不存在', 'error');
        // 双击改名(简易):右键也行
        await handlePDF(cb.fileBlob, { copybookId: id });
        // 滚到 PDF 预览区
        $('#pdf-preview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        toast('加载字帖失败: ' + err.message, 'error');
      }
    });
    // 双击改名
    card.querySelector('.cb-name').addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      const cur = e.currentTarget.textContent;
      const next = prompt('新字帖名:', cur);
      if (next && next.trim() && next !== cur) {
        try {
          await renameCopybook(id, next.trim());
          renderCopybookList();
        } catch (err) { toast('改名失败', 'error'); }
      }
    });
  });
}

async function onGenerateScript() {
  if (!state.char) return toast('请先选字', 'error');
  const cfg = loadConfig();
  if (!cfg.deepseekKey) return toast('请先在「设置」配置 DeepSeek API Key', 'error');

  showPage('script');
  $('#script-blocks').innerHTML = '<div class="empty">生成中,请稍候...</div>';

  try {
    // 用户清单里的所有字 — 多字模式讲稿覆盖全部,不能只讲第一个
    const chars = state.selectedChars.length > 0
      ? state.selectedChars
      : [{ char: state.char, style: state.style }];

    // 字帖框选的字(有 cropBlob)且还没分析过的 → 并行深度分析
    const needAnalysis = chars.filter(c => c.cropBlob && !c.analysis);
    if (needAnalysis.length > 0) {
      $('#script-blocks').innerHTML = `<div class="empty">📖 正在深度分析字帖里 ${needAnalysis.length} 个字的笔顺/结构/难点(并行,约 5-15 秒)...</div>`;
      await Promise.all(needAnalysis.map(async (c) => {
        try { c.analysis = await analyzeCharDeep(c.cropBlob); }
        catch (e) { console.warn(`深度分析失败 (${c.char})`, e); }
      }));
      const ok = chars.filter(c => c.analysis?.stroke_count).length;
      if (ok > 0) toast(`字帖分析完成 (${ok}/${chars.length} 个字)`, 'success');
    }

    $('#script-blocks').innerHTML = `<div class="empty">✍️ 正在生成讲稿... (${chars.length} 个字 · DeepSeek v4-pro 思考中)</div>`;
    const script = await generateScript({
      chars,
      duration: state.duration,
      tone: state.tone,
      audience: state.audience,
    });
    state.script = script;
    renderScript();

    // 多字合规性校验:数标记 + 数每字出现次数,DeepSeek 偷工减料就当场报警
    if (chars.length > 1) {
      const check = checkMultiCharCompliance(script, chars);
      console.log('[多字校验]', check.details);
      if (!check.ok) {
        toast(`⚠️ DeepSeek 偷工减料: ${check.details} — 点「重新生成讲稿」再试`, 'error');
      } else {
        toast(`讲解稿已生成 ✓ 覆盖全部 ${chars.length} 个字`, 'success');
      }
    } else if (chars[0].analysis?.stroke_count) {
      toast(`讲解稿已生成(基于字帖 ${chars[0].analysis.stroke_count}笔分析)`, 'success');
    } else {
      toast('讲解稿已生成', 'success');
    }
  } catch (e) {
    $('#script-blocks').innerHTML = `<div class="empty">${e.message}</div>`;
    toast(e.message, 'error');
  }
}

// ================= 讲解稿页 =================
function bindScriptPage() {
  $('#btn-regenerate').addEventListener('click', onGenerateScript);
  $('#btn-save-script').addEventListener('click', () => {
    if (!state.script) return;
    state.script.plainText = $('#script-edit').value;
    // 同时同步 blocks(单块兜底)
    state.script.blocks = [{ tag: '编辑后', text: state.script.plainText }];
    toast('讲稿已保存', 'success');
  });
  $('#btn-save-template').addEventListener('click', () => toast('已保存为模板(占位)', 'success'));
  $('#btn-go-tts').addEventListener('click', () => {
    if (!state.script) return toast('请先生成讲稿', 'error');
    showPage('tts');
    $('#tts-summary').textContent = state.script.plainText;
  });
}

function renderScript() {
  const blocksEl = $('#script-blocks');
  blocksEl.innerHTML = state.script.blocks.map(b =>
    `<div class="script-block"><span class="block-tag">${b.tag}</span>${b.text}</div>`
  ).join('');
  $('#script-edit').value = state.script.plainText;

  const bbEl = $('#blackboard-preview');
  if (state.script.blackboard && state.script.blackboard.length) {
    bbEl.innerHTML = state.script.blackboard.map(p => `<div class="bb-item">${p}</div>`).join('');
  } else {
    bbEl.innerHTML = '<div class="empty light">讲稿未包含板书重点</div>';
  }
}

// ================= TTS 页 =================
function bindTTSPage() {
  $$('#page-tts .radio-group').forEach(group => {
    const name = group.dataset.name;
    group.querySelectorAll('.radio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const v = btn.dataset.value;
        if (name === 'voice') state.voiceType = v;
        if (name === 'speed') state.speed = Number(v);
        if (name === 'emotion') state.emotion = v;
      });
    });
  });

  // V3 引擎开关
  $('#use-v3-engine')?.addEventListener('change', e => { state.useV3Engine = e.target.checked; });
  // 动态语速开关
  $('#use-dynamic-delivery')?.addEventListener('change', e => { state.dynamicDelivery = e.target.checked; });

  // 循环播放(配音 / 录制 两处都有)
  $('#tts-loop')?.addEventListener('change', e => {
    const a = $('#tts-audio'); if (a) a.loop = e.target.checked;
  });
  $('#rec-audio-loop')?.addEventListener('change', e => {
    const a = $('#rec-audio'); if (a) a.loop = e.target.checked;
  });

  // 下载 MP3 — 当前 state.audioBlob 直接落盘(TTS 页和录制页两个按钮共用一个 handler)
  const downloadAudio = () => {
    if (!state.audioBlob) return;
    downloadBlob(state.audioBlob, `配音_${state.char || 'demo'}_${Date.now()}.mp3`);
  };
  $('#btn-download-tts')?.addEventListener('click', downloadAudio);
  $('#btn-rec-download-tts')?.addEventListener('click', downloadAudio);

  $('#btn-tts-preview').addEventListener('click', onGenerateTTS);
  $('#btn-tts-regen').addEventListener('click', onGenerateTTS);
  // 用修改后的字幕重新合成
  $('#btn-regen-from-srt')?.addEventListener('click', async () => {
    syncSubtitleEdits();
    toast('字幕已更新,重新合成中...', '');
    await onGenerateTTS();
  });
  $('#btn-go-record').addEventListener('click', () => {
    // 必须已经生成 + 你听过/下过 才能往下,避免自动跳页让你错过播放器
    if (!state.audioBlob) {
      toast('请先点上方红色按钮「🎧 生成配音 & 试听」, 听满意后再过来', 'error');
      // 视觉提示:把生成按钮闪一下
      const btn = $('#btn-tts-preview');
      if (btn) {
        btn.style.transition = 'box-shadow .15s';
        btn.style.boxShadow = '0 0 0 4px rgba(180,45,41,0.4)';
        setTimeout(() => { btn.style.boxShadow = ''; }, 1200);
      }
      return;
    }
    showPage('record');
  });
}

async function onGenerateTTS() {
  if (!state.script) { toast('请先生成讲稿', 'error'); return false; }
  const btns = ['#btn-tts-preview', '#btn-tts-regen', '#btn-go-record'].map(s => $(s));
  btns.forEach(b => b && (b.disabled = true));
  toast('正在合成配音…', '');
  try {
    const text = state.script.plainText;
    const { audioBlob, subtitles, duration } = await generateTTS(text, {
      voiceType: state.voiceType,
      speed: state.speed,
      emotion: state.emotion,
      useV3: state.useV3Engine,
      dynamicDelivery: state.dynamicDelivery,
      blocks: state.script?.blocks || null,   // 动态模式按块拆分,需要原始结构
    });
    state.audioBlob = audioBlob;
    state.subtitles = subtitles;
    // 复用同一个 blob URL 给 TTS 页 + 录制页两处播放器,顺手开启下载按钮
    const url = URL.createObjectURL(audioBlob);
    const ttsA = $('#tts-audio'); if (ttsA) ttsA.src = url;
    const recA = $('#rec-audio'); if (recA) recA.src = url;
    const recBlock = $('#rec-audio-block'); if (recBlock) recBlock.style.display = 'block';
    const dlBtn = $('#btn-download-tts'); if (dlBtn) dlBtn.disabled = false;
    renderSubtitleList(subtitles);
    const regenBtn = $('#btn-regen-from-srt');
    if (regenBtn) regenBtn.style.display = 'block';
    toast(`配音完成 ${duration.toFixed(1)}秒`, 'success');
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  } finally {
    btns.forEach(b => b && (b.disabled = false));
  }
}

// 字幕列表渲染 — 每条可点击直接编辑(contenteditable)
function renderSubtitleList(subtitles) {
  const root = $('#srt-list');
  if (!root) return;
  if (!subtitles?.length) {
    root.innerHTML = `<div class="empty">生成配音后会显示字幕时间轴</div>`;
    return;
  }
  root.innerHTML = subtitles.map((s, i) => {
    const blockTag = s.blockIdx !== undefined ? `B${s.blockIdx+1}` : '';
    return `
      <div class="srt-item" data-idx="${i}">
        <span class="srt-time">${s.start.toFixed(1)}s — ${s.end.toFixed(1)}s${blockTag ? ' · '+blockTag : ''}</span>
        <div class="srt-text" contenteditable="true" spellcheck="false">${escapeHtml(s.text)}</div>
      </div>`;
  }).join('');
}

// 把字幕编辑内容写回 state.subtitles + 重组 blocks(保留 blockIdx 才能继续动态合成)
function syncSubtitleEdits() {
  const items = document.querySelectorAll('#srt-list .srt-item');
  items.forEach((el) => {
    const i = Number(el.dataset.idx);
    const txt = el.querySelector('.srt-text')?.textContent.trim();
    if (state.subtitles?.[i] && txt !== undefined) state.subtitles[i].text = txt;
  });

  // 重组 blocks:把同一个 blockIdx 的字幕拼回原 block.text
  if (state.script?.blocks && state.subtitles?.some(s => s.blockIdx !== undefined)) {
    const grouped = {};
    for (const s of state.subtitles) {
      const idx = s.blockIdx ?? 0;
      (grouped[idx] = grouped[idx] || []).push(s.text);
    }
    state.script.blocks = state.script.blocks.map((b, i) => ({
      tag: b.tag,
      text: grouped[i] ? grouped[i].join(' ') : b.text,
    }));
    state.script.plainText = state.script.blocks.map(b => b.text).join(' ');
  } else if (state.script) {
    // 没有 block 结构(单次合成模式) → 直接拼字幕作为 plainText
    state.script.plainText = state.subtitles.map(s => s.text).join(' ');
  }
}

// ================= 录制页 =================
function bindRecordPage() {
  // tab 切换
  $$('#page-record .tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('#page-record .tab').forEach(x => x.classList.remove('active'));
      $$('#page-record .rec-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $(`#page-record .rec-panel[data-rec-panel="${t.dataset.recTab}"]`).classList.add('active');
    });
  });

  // 上传
  const upArea = $('#video-upload-area');
  const upInput = $('#video-file-input');
  upArea.addEventListener('click', () => upInput.click());
  upArea.addEventListener('dragover', e => { e.preventDefault(); upArea.classList.add('dragover'); });
  upArea.addEventListener('dragleave', () => upArea.classList.remove('dragover'));
  upArea.addEventListener('drop', e => {
    e.preventDefault();
    upArea.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleVideoUpload(e.dataTransfer.files[0]);
  });
  upInput.addEventListener('change', e => { if (e.target.files[0]) handleVideoUpload(e.target.files[0]); });

  // 摄像头
  $('#btn-camera-start').addEventListener('click', onCameraStart);
  $('#btn-record-start').addEventListener('click', onRecordStart);
  $('#btn-record-stop').addEventListener('click', () => { stopRecord(); $('#btn-record-stop').disabled = true; });

  // 模板/选项
  $$('#page-record .radio-group').forEach(group => {
    const name = group.dataset.name;
    group.querySelectorAll('.radio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (name === 'template') state.template = btn.dataset.value;
      });
    });
  });
  $('#enable-blackboard').addEventListener('change', async e => {
    state.enableBlackboard = e.target.checked;
    await syncLayoutEditor();
  });
  $('#enable-intro-outro').addEventListener('change', () => {});

  // 米字格叠加
  $('#enable-mizige').addEventListener('change', async e => {
    state.enableMizige = e.target.checked;
    await syncLayoutEditor();
  });

  // 字体 + 板书风格 — 改完即重新生成板书预览图
  $('#comp-font')?.addEventListener('change', async e => {
    state.fontKey = e.target.value;
    await refreshBlackboardPreview();
  });
  $('#comp-bb-style')?.addEventListener('change', async e => {
    state.blackboardStyle = e.target.value;
    await refreshBlackboardPreview();
  });
  $('#comp-bb-timing')?.addEventListener('change', e => { state.blackboardTiming = e.target.value; });

  bindMizigeOverlayEditor();
  bindBlackboardOverlayEditor();

  $('#btn-compose').addEventListener('click', onCompose);
}

// ================= 叠加层编辑器(米字格 + 板书 一起拖动 + 缩放) =================
async function syncLayoutEditor() {
  const editor = $('#layout-editor');
  const mizi = $('#overlay-mizige');
  const miziImg = $('#overlay-mizige-img');
  const bb = $('#overlay-blackboard');
  const bbImg = $('#overlay-bb-img');
  const bgVid = $('#overlay-bg-video');

  if (state.videoBlob && bgVid && !bgVid.src) {
    bgVid.src = URL.createObjectURL(state.videoBlob);
  }

  // 编辑器:只要米字格 或 板书 任一启用就显示
  const anyEnabled = state.enableMizige || state.enableBlackboard;
  if (!anyEnabled) {
    if (editor) editor.style.display = 'none';
    if (mizi)   mizi.style.display = 'none';
    if (bb)     bb.style.display = 'none';
    return;
  }
  if (editor) editor.style.display = 'block';

  // 米字格
  if (state.enableMizige) {
    if (!state.miziCompositeBlob) {
      toast('选字阶段还没生成米字格图 — 先去「新建视频」选字', 'error');
      $('#enable-mizige').checked = false;
      state.enableMizige = false;
    } else {
      if (miziImg.src.startsWith('blob:')) URL.revokeObjectURL(miziImg.src);
      miziImg.src = URL.createObjectURL(state.miziCompositeBlob);
      mizi.style.display = 'block';
      applyMizigePos();
    }
  } else if (mizi) {
    mizi.style.display = 'none';
  }

  // 板书 — 没有缓存的预览图就生成一张
  if (state.enableBlackboard) {
    await refreshBlackboardPreview();
    bb.style.display = 'block';
    applyBlackboardPos();
  } else if (bb) {
    bb.style.display = 'none';
  }
}

// 生成/刷新板书预览 PNG(根据当前 fontKey + style + 板书重点)
async function refreshBlackboardPreview() {
  if (!state.enableBlackboard) return;
  const bbImg = $('#overlay-bb-img');
  if (!bbImg) return;
  try {
    const points = state.script?.blackboard || ['示例重点 1','示例重点 2','示例重点 3','示例重点 4'];
    const blob = await renderBlackboardPNG(points, {
      style: state.blackboardStyle,
      fontKey: state.fontKey,
      sealText: '江哥',
    });
    if (bbImg.src.startsWith('blob:')) URL.revokeObjectURL(bbImg.src);
    bbImg.src = URL.createObjectURL(blob);
  } catch (e) {
    console.warn('板书预览生成失败', e);
  }
}

function applyBlackboardPos() {
  const bb = $('#overlay-blackboard');
  const readout = $('#bb-pos-readout');
  if (!bb) return;
  const { x, y, size } = state.blackboardPos;
  bb.style.left = x + '%';
  bb.style.top  = y + '%';
  bb.style.width = size + '%';
  bb.style.height = 'auto';
  if (readout) readout.textContent = `x:${x.toFixed(1)}% y:${y.toFixed(1)}% 宽:${size.toFixed(1)}%`;
}

function bindBlackboardOverlayEditor() {
  const bb = $('#overlay-blackboard');
  const frame = $('#overlay-frame');
  if (!bb || !frame) return;
  let mode = null;
  let startX = 0, startY = 0, startPos = null, frameRect = null;
  function onDown(e) {
    if (e.target.classList.contains('resize-handle')) mode = 'resize';
    else mode = 'drag';
    bb.classList.add('dragging');
    startX = e.clientX; startY = e.clientY;
    startPos = { ...state.blackboardPos };
    frameRect = frame.getBoundingClientRect();
    e.preventDefault();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  }
  function onMove(e) {
    if (!mode || !frameRect) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (mode === 'drag') {
      state.blackboardPos.x = clamp(startPos.x + dx/frameRect.width*100, 0, 100 - state.blackboardPos.size);
      state.blackboardPos.y = clamp(startPos.y + dy/frameRect.height*100, 0, 95);
    } else {
      state.blackboardPos.size = clamp(startPos.size + dx/frameRect.width*100, 10, 60);
      state.blackboardPos.x = clamp(state.blackboardPos.x, 0, 100 - state.blackboardPos.size);
    }
    applyBlackboardPos();
  }
  function onUp() {
    mode = null;
    bb.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
  }
  bb.addEventListener('pointerdown', onDown);
}

function applyMizigePos() {
  const mizi = $('#overlay-mizige');
  const readout = $('#mizige-pos-readout');
  if (!mizi) return;
  const { x, y, size } = state.mizigePos;
  // 米字格不一定方形(多字会变长方),为简单起见用百分比按宽控制,高自动按图片比例
  mizi.style.left = x + '%';
  mizi.style.top  = y + '%';
  mizi.style.width = size + '%';
  mizi.style.height = 'auto';
  if (readout) readout.textContent = `x: ${x.toFixed(1)}%  y: ${y.toFixed(1)}%  宽: ${size.toFixed(1)}%`;
}

function bindMizigeOverlayEditor() {
  const mizi = $('#overlay-mizige');
  const frame = $('#overlay-frame');
  if (!mizi || !frame) return;

  let mode = null; // 'drag' | 'resize'
  let startX = 0, startY = 0;
  let startPos = null;
  let frameRect = null;

  function onPointerDown(e) {
    if (e.target.classList.contains('resize-handle')) {
      mode = 'resize';
    } else {
      mode = 'drag';
    }
    mizi.classList.add('dragging');
    startX = e.clientX; startY = e.clientY;
    startPos = { ...state.mizigePos };
    frameRect = frame.getBoundingClientRect();
    e.preventDefault();
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
  }
  function onPointerMove(e) {
    if (!mode || !frameRect) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (mode === 'drag') {
      const dxPct = (dx / frameRect.width) * 100;
      const dyPct = (dy / frameRect.height) * 100;
      state.mizigePos.x = clamp(startPos.x + dxPct, 0, 100 - state.mizigePos.size);
      state.mizigePos.y = clamp(startPos.y + dyPct, 0, 95);
    } else if (mode === 'resize') {
      const dPct = (dx / frameRect.width) * 100;
      state.mizigePos.size = clamp(startPos.size + dPct, 10, 80);
      // 别让放大后越界
      state.mizigePos.x = clamp(state.mizigePos.x, 0, 100 - state.mizigePos.size);
    }
    applyMizigePos();
  }
  function onPointerUp() {
    mode = null;
    mizi.classList.remove('dragging');
    document.removeEventListener('pointermove', onPointerMove);
  }
  mizi.addEventListener('pointerdown', onPointerDown);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 板书出现/消失时机 — 返回 { start, end }(秒),null = 不限
// 'summary'(默认): 结尾「总结+互动」段开始时才蹦出,一直到结束
// 'body':         干货段开始,一直到结束
// 'bodyOnly':     只在干货段显示
// 'all':          整段一直显示
function computeBlackboardTiming() {
  const mode = state.blackboardTiming || 'summary';
  if (mode === 'all') return { start: 0, end: null };

  const blocks = state.script?.blocks || [];
  const subs = state.subtitles || [];
  if (!blocks.length || !subs.length) return { start: 0, end: null };

  const detect = (tag) => {
    const t = String(tag || '');
    if (/钩子|开场|hook/i.test(t)) return 'hook';
    if (/预告|价值|preview/i.test(t)) return 'preview';
    if (/反转|惊喜|彩蛋|twist/i.test(t)) return 'twist';
    if (/结尾|收尾|总结|互动|outro|CTA/i.test(t)) return 'outro';
    return 'body';
  };
  let bodyIdx = -1, outroIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const kind = detect(blocks[i].tag);
    if (kind === 'body' && bodyIdx < 0)   bodyIdx = i;
    if (kind === 'outro' && outroIdx < 0) outroIdx = i;
  }

  if (mode === 'summary') {
    // 结尾段第一条字幕的 start = 板书蹦出时间;持续到末尾
    if (outroIdx < 0) return { start: 0, end: null };
    const firstOutroSub = subs.find(s => s.blockIdx === outroIdx);
    return { start: firstOutroSub?.start ?? 0, end: null };
  }

  if (bodyIdx < 0) return { start: 0, end: null };
  const firstBodySub = subs.find(s => s.blockIdx === bodyIdx);
  const start = firstBodySub?.start ?? 0;

  if (mode === 'bodyOnly') {
    const lastBodySub = [...subs].reverse().find(s => s.blockIdx === bodyIdx);
    return { start, end: lastBodySub?.end ?? null };
  }
  return { start, end: null };
}

// 通用:把 Blob 落到本地下载
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

function handleVideoUpload(file) {
  state.videoBlob = file;
  $('#recorded-preview').src = URL.createObjectURL(file);
  $('#video-preview-card').style.display = 'block';
  // 同步背景视频到米字格编辑器(此时背景视频还没设置过 src)
  const bg = $('#overlay-bg-video');
  if (bg) { if (bg.src) URL.revokeObjectURL(bg.src); bg.src = URL.createObjectURL(file); }
  toast('视频已上传', 'success');
}

async function onCameraStart() {
  try {
    const cams = await listCameras();
    const sel = $('#camera-select');
    sel.innerHTML = cams.map(c => `<option value="${c.deviceId}">${c.label || c.deviceId.slice(0,8)}</option>`).join('');
    const [w, h] = $('#camera-resolution').value.split('x').map(Number);
    await startPreview($('#camera-preview'), { deviceId: cams[0]?.deviceId, width: w, height: h });
    $('#btn-record-start').disabled = false;
    $('#rec-status').textContent = '摄像头已开启,准备录制';
  } catch (e) {
    toast(e.message, 'error');
  }
}

function onRecordStart() {
  try {
    if ($('#play-tts-while-rec').checked && state.audioBlob) {
      // 优先用录制页那个独立播放器(在同一个 tab 里,不需要回去开 TTS 页)
      const a = $('#rec-audio') || $('#tts-audio');
      a.currentTime = 0;
      a.play().catch(() => {});
    }
    startRecord({
      onStop: (blob) => {
        state.videoBlob = blob;
        $('#recorded-preview').src = URL.createObjectURL(blob);
        $('#video-preview-card').style.display = 'block';
        const bg = $('#overlay-bg-video');
        if (bg) { if (bg.src) URL.revokeObjectURL(bg.src); bg.src = URL.createObjectURL(blob); }
        $('#rec-status').textContent = '录制完成';
        $('#rec-status').classList.remove('recording');
        toast('录制完成', 'success');
      },
    });
    $('#btn-record-start').disabled = true;
    $('#btn-record-stop').disabled = false;
    $('#rec-status').textContent = '● 录制中...';
    $('#rec-status').classList.add('recording');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onCompose() {
  if (!state.videoBlob) return toast('请先上传或录制视频', 'error');
  if (!state.audioBlob) return toast('请先生成 AI 配音', 'error');

  showPage('final');
  setProgress(0, '加载视频引擎...');
  try {
    const blob = await compose({
      videoBlob: state.videoBlob,
      audioBlob: state.audioBlob,
      blackboardPoints: state.script?.blackboard || [],
      subtitles: state.subtitles,
      enableBlackboard: state.enableBlackboard,
      enableSubtitle: state.enableSubtitle && $('#comp-subtitle')?.value !== 'none',
      // 米字格叠加
      mizigeBlob: state.enableMizige ? state.miziCompositeBlob : null,
      mizigePos: state.mizigePos,
      // 板书风格 + 位置 + 字体 + 出现时机
      blackboardStyle: state.blackboardStyle,
      blackboardPos: state.blackboardPos,
      blackboardTiming: computeBlackboardTiming(),
      fontKey: state.fontKey,
      onProgress: (p) => setProgress(p, `合成中 ${(p*100).toFixed(0)}%`),
      onLog: (m) => console.log('[ffmpeg]', m),
    });
    state.finalBlob = blob;
    $('#final-preview').src = URL.createObjectURL(blob);
    $('#final-preview').style.display = 'block';
    setProgress(1, '✓ 合成完成');
    toast('视频合成完成', 'success');

    // 自动保存到本地文件夹(如已设置)
    const handle = await loadDirHandle().catch(() => null);
    if (handle) {
      const fn = `${state.char}-${state.style}-${state.duration}秒-${new Date().toISOString().slice(0,10).replace(/-/g,'')}.mp4`;
      try {
        await writeFileToDir(fn, blob);
        toast(`已保存到本地文件夹:${fn}`, 'success');
      } catch (e) { /* 静默,用户可手动下载 */ }
    }

    // 保存项目元数据
    const id = await saveProject({
      char: state.char,
      style: state.style,
      duration: state.duration,
      tone: state.tone,
      audience: state.audience,
      scriptText: state.script?.plainText,
      blackboard: state.script?.blackboard,
    }).catch(() => null);
    if (id) {
      await putBlob(`video_${id}`, blob);
      refreshHistory();
    }
  } catch (e) {
    setProgress(0, '✗ 合成失败');
    toast(e.message, 'error');
    console.error(e);
  }
}

// ================= 成片页 =================
const PLATFORM_RES = {
  douyin:      [{ v: '1080x1920', label: '1080×1920 抖音竖屏' }, { v: '720x1280', label: '720×1280' }],
  shipinhao:   [{ v: '1080x1920', label: '1080×1920 视频号竖屏' }, { v: '720x1280', label: '720×1280' }],
  xiaohongshu: [{ v: '1080x1440', label: '1080×1440 小红书 3:4' }, { v: '1080x1080', label: '1080×1080 方形' }],
  bilibili:    [{ v: '1920x1080', label: '1920×1080 B 站横屏' }, { v: '1280x720', label: '1280×720' }],
};

function bindFinalPage() {
  $$('#page-final .radio-group').forEach(group => {
    const name = group.dataset.name;
    group.querySelectorAll('.radio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (name === 'platform') {
          state.platform = btn.dataset.value;
          updateResolutionOptions();
        }
        if (name === 'brand') state.brand = btn.dataset.value;
      });
    });
  });
  updateResolutionOptions();

  $('#btn-download').addEventListener('click', () => {
    if (!state.finalBlob) return toast('还没有可下载的成片', 'error');
    const fn = $('#export-filename').value || `${state.char}-${state.style}-${state.duration}秒`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(state.finalBlob);
    a.download = `${fn}.mp4`;
    a.click();
  });

  $('#btn-save-project').addEventListener('click', () => toast('项目已自动保存', 'success'));

  $('#btn-make-next').addEventListener('click', () => {
    // 重置当前作品状态(保留配置)
    state.script = null;
    state.audioBlob = null;
    state.videoBlob = null;
    state.finalBlob = null;
    showPage('new');
  });
}

function updateResolutionOptions() {
  const sel = $('#export-resolution');
  if (!sel) return;
  const list = PLATFORM_RES[state.platform] || PLATFORM_RES.douyin;
  sel.innerHTML = list.map(o => `<option value="${o.v}">${o.label}</option>`).join('');
}

// ================= 设置页 =================
function initSettingsForm() {
  const c = loadConfig();
  $('#key-deepseek').value = c.deepseekKey;
  $('#key-deepseek-model').value = c.deepseekModel || 'deepseek-v4-pro';
  $('#key-volc-apikey').value = c.volcApiKey || '';
  $('#key-volc-appid').value = c.volcAppId;
  $('#key-volc-token').value = c.volcToken;
  $('#key-volc-cluster').value = c.volcCluster || 'volcano_tts';
  $('#key-volc-voice-id').value = c.volcVoiceId;
  $('#key-doubao').value = c.doubaoKey;
  $('#key-doubao-model').value = c.doubaoModel || 'ep-20260427205304-9kmtr';
  $('#key-proxy').value = c.corsProxy || 'http://localhost:5174';
  loadDirHandle().then(h => {
    if (h) $('#dir-name').textContent = h.name;
  }).catch(()=>{});
}

function bindSettingsPage() {
  $('#btn-save-settings').addEventListener('click', () => {
    saveConfig({
      deepseekKey: $('#key-deepseek').value.trim(),
      deepseekModel: $('#key-deepseek-model').value,
      volcApiKey: $('#key-volc-apikey').value.trim(),
      volcAppId: $('#key-volc-appid').value.trim(),
      volcToken: $('#key-volc-token').value.trim(),
      volcCluster: $('#key-volc-cluster').value.trim() || 'volcano_tts',
      volcVoiceId: $('#key-volc-voice-id').value.trim(),
      doubaoKey: $('#key-doubao').value.trim(),
      doubaoModel: $('#key-doubao-model').value.trim(),
      corsProxy: $('#key-proxy').value.trim(),
    });
    refreshConfigStatus();
    toast('设置已保存', 'success');
  });

  $('#btn-pick-dir').addEventListener('click', async () => {
    try {
      const h = await pickAndSaveDir();
      $('#dir-name').textContent = h.name;
      toast(`保存文件夹已设置:${h.name}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  $('#btn-test-keys').addEventListener('click', async () => {
    const fb = $('#settings-feedback');
    fb.className = 'feedback show';
    fb.textContent = '测试中...';
    const results = [];

    // DeepSeek
    try {
      await generateScript({ char: '一', style: '楷书', duration: 30, tone: '干货教学', audience: '零基础' });
      results.push('✓ DeepSeek 通');
    } catch (e) { results.push('✗ DeepSeek: ' + e.message); }
    // TTS
    try {
      await testTTS();
      results.push('✓ 火山 TTS 通');
    } catch (e) { results.push('✗ 火山 TTS: ' + e.message); }
    // 豆包 — 用合法的 1×1 PNG,这样验证的是接口连通性而非图像内容
    try {
      // 1×1 透明 PNG (base64)
      const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      await recognizeCharFromImage(blob);
      results.push('✓ 豆包视觉 通');
    } catch (e) { results.push('豆包视觉: ' + e.message.slice(0, 240)); }

    fb.innerHTML = results.join('<br/>');
    fb.classList.remove('error', 'success');
    fb.classList.add(results.every(r => r.startsWith('✓')) ? 'success' : 'error');
  });
}

// ================= 音色克隆页 =================
function renderCloneList() {
  const el = $('#clone-text-list');
  if (!el) return;
  el.innerHTML = CLONE_TEXTS.map((t, i) => {
    // 兼容老版本字符串元素 + 新版本 { hint, text } 对象
    const hint = typeof t === 'string' ? '' : (t.hint || '');
    const text = typeof t === 'string' ? t : (t.text || '');
    return `
      <div class="clone-text-item ${i === state.cloneCurrentIdx ? 'current' : ''} ${state.cloneAudios[i] ? 'done' : ''}">
        <div style="flex:1;min-width:0">
          ${hint ? `<div class="clone-hint">🎭 ${escapeHtml(hint)}</div>` : ''}
          <div class="clone-text">${i+1}. ${escapeHtml(text)}</div>
        </div>
      </div>`;
  }).join('');
}

function bindVoiceClonePage() {
  let recordingNow = false;
  $('#btn-clone-record').addEventListener('click', async () => {
    if (recordingNow) return;
    try {
      await startMicRecord();
      recordingNow = true;
      $('#clone-status').textContent = `● 录音中:第 ${state.cloneCurrentIdx + 1} 句`;
      $('#clone-status').classList.add('recording');
      $('#btn-clone-stop').disabled = false;
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  $('#btn-clone-stop').addEventListener('click', async () => {
    if (!recordingNow) return;
    const blob = await stopMicRecord();
    recordingNow = false;
    const cur = CLONE_TEXTS[state.cloneCurrentIdx];
    state.cloneAudios[state.cloneCurrentIdx] = {
      text: typeof cur === 'string' ? cur : cur.text,
      blob,
    };
    $('#clone-preview').src = URL.createObjectURL(blob);
    $('#clone-preview').style.display = 'block';
    $('#clone-status').textContent = `第 ${state.cloneCurrentIdx + 1} 句已录,点试听确认或下一句`;
    $('#clone-status').classList.remove('recording');
    $('#btn-clone-stop').disabled = true;
    $('#btn-clone-submit').disabled = state.cloneAudios.filter(Boolean).length < 5;
    renderCloneList();
  });
  $('#btn-clone-skip').addEventListener('click', () => {
    state.cloneCurrentIdx = Math.min(state.cloneCurrentIdx + 1, CLONE_TEXTS.length - 1);
    renderCloneList();
  });

  $('#btn-clone-submit').addEventListener('click', async () => {
    const recorded = state.cloneAudios.map((a, i) => a && { ...a, idx: i }).filter(Boolean);
    if (recorded.length < 5) return toast('至少录 5 句', 'error');
    $('#clone-status').textContent = '提交训练中...';
    try {
      $('#clone-status').textContent = '正在转码音频(webm → wav)并上传训练…';
      const { speakerId, response } = await submitClone(recorded.map(r => ({ blob: r.blob, text: r.text })));
      $('#clone-status').textContent = `已提交 speaker_id: ${speakerId} — V3 接口训练通常 1-5 分钟,自动轮询中`;
      // 立即登记进音色库(顺手把训练即返回的 demo 也存一份)
      const earlyDemo = response?.demo_audio || response?.speaker_status?.find(s => s.demo_audio)?.demo_audio || '';
      addVoice({ id: speakerId, demoAudio: earlyDemo, modelVersion: response?.model_version || 2 });
      $('#key-volc-voice-id').value = speakerId;
      renderVoiceList();
      toast('训练已提交,等待完成', 'success');

      // 轮询
      pollUntilReady(speakerId);
    } catch (e) {
      $('#clone-status').textContent = '✗ ' + e.message;
      toast(e.message, 'error');
    }
  });
}

// V3 status: 0=NotFound 1=Training 2=Success 3=Failed 4=Active
const STATUS_NAME = { 0: 'NotFound', 1: 'Training', 2: 'Success', 3: 'Failed', 4: 'Active' };

async function pollUntilReady(speakerId) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const data = await pollCloneStatus(speakerId);
      const st = data?.status;
      const name = STATUS_NAME[st] || '未知';
      $('#clone-status').textContent = `[${i+1}/60] 训练状态: ${name} — 剩余训练次数 ${data?.available_training_times ?? '?'}`;
      if (st === 2 || st === 4) {
        toast('🎉 音色训练完成,可用了!', 'success');
        const demos = (data?.speaker_status || []).map(s => s.demo_audio).filter(Boolean);
        const demo = data?.demo_audio || demos[0] || '';
        // 把最新的 demoAudio 刷到音色库里(轮询拿到的更新)
        addVoice({ id: speakerId, demoAudio: demo, modelVersion: data?.model_version || 2 });
        renderVoiceList();
        $('#clone-status').innerHTML =
          `✓ 训练完成 — voice_id: <b>${speakerId}</b> — 已加入「我的音色库」<br/>` +
          (demo ? `试听:<a href="${demo}" target="_blank">${demo.slice(0, 80)}…</a>(1 小时有效)` : '');
        return;
      }
      if (st === 3) {
        toast('训练失败,看下面错误信息', 'error');
        $('#clone-status').textContent = `✗ 训练失败:${data?.message || JSON.stringify(data)}`;
        return;
      }
    } catch (e) { /* 静默继续轮询 */ }
  }
  $('#clone-status').textContent = `⏰ 轮询超时(5 分钟),手动到设置点测试`;
}

// ================= 我的音色库 =================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function renderVoiceList() {
  const root = $('#voice-list');
  if (!root) return;
  const voices = listVoices();
  const cfg = loadConfig();

  if (voices.length === 0) {
    root.innerHTML = `<div class="empty">还没有训练过音色 — 用下面的录音区开始训练第一个</div>`;
    return;
  }

  root.innerHTML = voices.map(v => {
    const isDefault = cfg.volcVoiceId === v.id;
    const date = v.createdAt ? new Date(v.createdAt).toLocaleDateString('zh-CN') : '';
    return `
      <div class="voice-item ${isDefault ? 'default' : ''}" data-id="${v.id}">
        <span class="star" data-act="default" title="设为默认音色">★</span>
        <div class="voice-meta">
          <div class="voice-name">
            <span class="voice-name-text">${escapeHtml(v.name || '未命名')}</span>
            ${isDefault ? '<span style="font-size:12px;color:var(--red)">· 当前默认</span>' : ''}
            ${date ? `<span style="font-size:12px;color:var(--ink-lighter);font-weight:normal">· ${date} 训练</span>` : ''}
          </div>
          <div class="voice-id">${v.id}</div>
        </div>
        ${v.demoAudio
          ? `<audio controls preload="none" src="${v.demoAudio}"></audio>`
          : '<span class="hint" style="font-size:12px">无试听 — 点🔄获取</span>'}
        <div class="voice-actions">
          <button data-act="rename" title="改名">✎</button>
          <button data-act="refresh" title="刷新试听 URL(1 小时过期)">🔄</button>
          <button data-act="delete" class="danger" title="从本地列表删除">🗑</button>
        </div>
      </div>`;
  }).join('');

  root.querySelectorAll('.voice-item').forEach(item => {
    const id = item.dataset.id;
    item.querySelector('[data-act="default"]').addEventListener('click', () => {
      setDefaultVoice(id);
      const inp = $('#key-volc-voice-id'); if (inp) inp.value = id;
      renderVoiceList();
      toast('已设为默认音色', 'success');
    });
    item.querySelector('[data-act="rename"]').addEventListener('click', () => {
      const cur = item.querySelector('.voice-name-text').textContent;
      const next = prompt('新名字:', cur);
      if (next && next.trim() && next !== cur) {
        renameVoice(id, next.trim());
        renderVoiceList();
      }
    });
    item.querySelector('[data-act="delete"]').addEventListener('click', () => {
      const nameTxt = item.querySelector('.voice-name-text').textContent;
      if (!confirm(`删除「${nameTxt}」?\n仅从本地列表移除,火山服务端的音色 7 天没合成才会自动回收。`)) return;
      removeVoice(id);
      renderVoiceList();
      toast('已删除', '');
    });
    item.querySelector('[data-act="refresh"]').addEventListener('click', async () => {
      const btn = item.querySelector('[data-act="refresh"]');
      btn.disabled = true;
      const old = btn.textContent; btn.textContent = '...';
      try {
        const data = await pollCloneStatus(id);
        const demo = data?.demo_audio
          || data?.speaker_status?.find(s => s.demo_audio)?.demo_audio
          || '';
        if (demo) {
          addVoice({ id, demoAudio: demo, modelVersion: data?.model_version || 2 });
          renderVoiceList();
          toast('试听 URL 已刷新', 'success');
        } else {
          toast('暂时拿不到试听 URL(可能音色还没训练好,或服务端已回收)', 'error');
        }
      } catch (e) {
        toast('刷新失败: ' + e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = old;
      }
    });
  });
}

// ================= toast =================
function bindToastClose() {}
