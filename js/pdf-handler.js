// PDF 字帖渲染 + 框选裁剪
// 依赖 pdf.js,通过 ESM CDN 加载
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

export async function renderPDFToContainer(file, container) {
  container.innerHTML = '';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    container.appendChild(canvas);
    pages.push(canvas);
  }
  return pages;
}

// 在 canvas 上启用「正方形」框选 — 1:1 锁定
// 状态机:
//   IDLE → 在 canvas 上 mousedown → DRAWING(画方框)
//   DRAWING → mouseup → ARMED(方框留着,出现 ✓/✕,允许拖移/缩放)
//   ARMED → 拖框身 → MOVING(移动整框)
//   ARMED → 拖右下角红点 → RESIZING(整体缩放)
//   ARMED → 点 ✓ → 切图 + 回调 → IDLE
//   ARMED → 点 ✕ → IDLE
//   ARMED → 在框外 canvas 上 mousedown → DRAWING(画新框)
export function enableBoxSelect(canvas, onSelected) {
  let mode = 'idle';     // idle | drawing | armed | moving | resizing
  let box = null;        // { x, y, size } — canvas CSS 坐标
  let dragStart = null;

  // === DOM ===
  const parent = canvas.parentElement;
  if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;border:2px solid #b42d29;background:rgba(180,45,41,0.08);box-sizing:border-box;display:none;pointer-events:none;cursor:move;';

  const sizeTag = document.createElement('div');
  sizeTag.style.cssText = 'position:absolute;background:#b42d29;color:#fff;font-size:11px;padding:1px 6px;border-radius:3px;top:-22px;right:0;font-family:ui-monospace,monospace;pointer-events:none;';
  overlay.appendChild(sizeTag);

  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = 'position:absolute;right:-9px;bottom:-9px;width:18px;height:18px;background:#b42d29;border:2px solid #fff;border-radius:50%;cursor:nwse-resize;pointer-events:auto;';
  overlay.appendChild(resizeHandle);

  const confirmBar = document.createElement('div');
  confirmBar.style.cssText = 'position:absolute;display:none;gap:8px;pointer-events:auto;z-index:10;';
  const btnConfirm = document.createElement('button');
  btnConfirm.textContent = '✓ 识别这个字';
  btnConfirm.style.cssText = 'padding:6px 14px;background:#b42d29;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  const btnCancel = document.createElement('button');
  btnCancel.textContent = '✕ 取消';
  btnCancel.style.cssText = 'padding:6px 12px;background:#fff;color:#888;border:1px solid #ccc;border-radius:6px;cursor:pointer;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
  confirmBar.appendChild(btnConfirm);
  confirmBar.appendChild(btnCancel);

  parent && parent.appendChild(overlay);
  parent && parent.appendChild(confirmBar);

  // === 工具 ===
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function clampToCanvas(x, y, size) {
    if (x < 0) { size += x; x = 0; }
    if (y < 0) { size += y; y = 0; }
    if (x + size > canvas.offsetWidth)  size = Math.min(size, canvas.offsetWidth - x);
    if (y + size > canvas.offsetHeight) size = Math.min(size, canvas.offsetHeight - y);
    return { x, y, size: Math.max(0, size) };
  }
  function isPointInBox(px, py) {
    if (!box) return false;
    return px >= box.x && px <= box.x + box.size && py >= box.y && py <= box.y + box.size;
  }
  function renderBox() {
    if (!box) { overlay.style.display = 'none'; confirmBar.style.display = 'none'; return; }
    overlay.style.display = 'block';
    overlay.style.left   = (canvas.offsetLeft + box.x) + 'px';
    overlay.style.top    = (canvas.offsetTop  + box.y) + 'px';
    overlay.style.width  = box.size + 'px';
    overlay.style.height = box.size + 'px';
    sizeTag.textContent  = `${Math.round(box.size)}px □`;
    // 确认条放在框下方居中(若太靠下贴边就放上方)
    if (mode === 'armed') {
      confirmBar.style.display = 'flex';
      const barTop = box.y + box.size + 8;
      const safeBarTop = barTop + 40 > canvas.offsetHeight ? box.y - 38 : barTop;
      confirmBar.style.left = (canvas.offsetLeft + box.x) + 'px';
      confirmBar.style.top  = (canvas.offsetTop  + safeBarTop) + 'px';
    } else {
      confirmBar.style.display = 'none';
    }
  }
  function setMode(next) {
    mode = next;
    // overlay 在 drawing 阶段不能挡住 canvas 的鼠标事件
    overlay.style.pointerEvents = (next === 'drawing') ? 'none' : 'auto';
    renderBox();
  }
  function reset() { box = null; setMode('idle'); }

  // === Canvas mousedown:外部 → 开始画新框;内部 → 让 overlay 接管 ===
  // 用 document 级 mousemove/mouseup 跟踪,避免鼠标移出 canvas 后丢失事件
  function onDrawingMove(e) {
    if (mode !== 'drawing') return;
    const p = pt(e);
    const dx = p.x - dragStart.x, dy = p.y - dragStart.y;
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    const x = dx >= 0 ? dragStart.x : dragStart.x - size;
    const y = dy >= 0 ? dragStart.y : dragStart.y - size;
    box = clampToCanvas(x, y, size);
    renderBox();
  }
  function onDrawingUp() {
    document.removeEventListener('mousemove', onDrawingMove);
    document.removeEventListener('mouseup', onDrawingUp);
    if (mode !== 'drawing') return;
    if (!box || box.size < 20) { reset(); return; }
    setMode('armed');
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = pt(e);
    // 如果当前 armed 且点击在框内 → 不开始新画,让 overlay 接管
    if (mode === 'armed' && isPointInBox(p.x, p.y)) return;
    e.preventDefault();
    dragStart = p;
    box = { x: p.x, y: p.y, size: 0 };
    setMode('drawing');
    // 文档级跟踪,确保鼠标移出 canvas 仍能更新
    document.addEventListener('mousemove', onDrawingMove);
    document.addEventListener('mouseup', onDrawingUp);
  });

  // === 移动整框(在 overlay 上按住空白处) ===
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === resizeHandle) return;       // 缩放手柄走别的
    if (e.target.tagName === 'BUTTON')   return; // 按钮走别的
    if (mode !== 'armed') return;
    e.preventDefault();
    setMode('moving');
    const start = { mx: e.clientX, my: e.clientY, bx: box.x, by: box.y };
    function onMove(ev) {
      const dx = ev.clientX - start.mx, dy = ev.clientY - start.my;
      box = clampToCanvas(start.bx + dx, start.by + dy, box.size);
      renderBox();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      setMode('armed');
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  });

  // === 缩放(拉右下角红点) ===
  resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMode('resizing');
    const start = { mx: e.clientX, bs: box.size, bx: box.x, by: box.y };
    function onMove(ev) {
      const dx = ev.clientX - start.mx;
      const newSize = Math.max(20, start.bs + dx);
      box = clampToCanvas(start.bx, start.by, newSize);
      renderBox();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      setMode('armed');
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  });

  // === ✓ 确认:此时才切图 + 触发识别 ===
  btnConfirm.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!box || box.size < 20) return;
    const ratioX = canvas.width / canvas.offsetWidth;
    const ratioY = canvas.height / canvas.offsetHeight;
    const ratio  = Math.min(ratioX, ratioY);
    const cx = box.x * ratioX;
    const cy = box.y * ratioY;
    const cSize = box.size * ratio;
    const off = document.createElement('canvas');
    off.width = cSize; off.height = cSize;
    off.getContext('2d').drawImage(canvas, cx, cy, cSize, cSize, 0, 0, cSize, cSize);
    off.toBlob((blob) => { onSelected && onSelected(blob); }, 'image/png');
    reset();
  });
  btnCancel.addEventListener('click', (e) => { e.stopPropagation(); reset(); });
}
