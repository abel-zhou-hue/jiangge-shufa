// 米字格 PNG 生成 — 单字 + 多字组合网格
// 输入:字图 Blob(已被框选成正方形裁剪)
// 输出:把字放进米字格里的 PNG Blob,可以直接贴到视频画面上

// ============= 内部:画一个米字格单元 =============
//   x, y, size 是 cell 在大画布上的左上角 + 边长
//   charImg 是已经 load 完的 Image(框选出来的字);没有就用 charText(纯文字)
function drawSingleCell(ctx, charImg, x, y, size, opts = {}) {
  const {
    bg = '#faf7f0',        // 米色宣纸底
    grid = '#b42d29',      // 米字格红线
    lineW = 2,             // 外框线宽
    innerLineW = 1,        // 内部辅助线宽
    padding = 0.08,        // 字距离外框的内边距(占 size 比例)
    charText = '',         // 备用:没有图就直接画字
  } = opts;

  // 1) 米色底
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, size, size);

  // 2) 字本身(留内边距) — 优先用图,没图就用文字
  const pad = size * padding;
  const inner = size - 2 * pad;
  if (charImg) {
    ctx.drawImage(charImg, x + pad, y + pad, inner, inner);
  } else if (charText) {
    ctx.fillStyle = '#2c2520';
    ctx.font = `bold ${Math.round(inner * 0.82)}px "STKaiti","KaiTi",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(charText, x + size / 2, y + size / 2 + inner * 0.04);
  }

  // 3) 米字格红线 — 后画,压在字上面
  ctx.strokeStyle = grid;
  ctx.setLineDash([]);
  ctx.lineWidth = lineW;
  // 外框
  ctx.strokeRect(x + lineW/2, y + lineW/2, size - lineW, size - lineW);

  // 内部辅助线虚线
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = innerLineW;
  ctx.globalAlpha = 0.7;
  // 横中线
  ctx.beginPath();
  ctx.moveTo(x, y + size / 2);
  ctx.lineTo(x + size, y + size / 2);
  ctx.stroke();
  // 竖中线
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size / 2, y + size);
  ctx.stroke();
  // 对角线 ╲
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + size, y + size);
  ctx.stroke();
  // 对角线 ╱
  ctx.beginPath();
  ctx.moveTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.stroke();

  // 复原
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// 把 Blob → Image
function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// 接受 Blob(原 API) 或 { cropBlob?, char? } 对象(新)
function normalizeItem(x) {
  if (!x) return {};
  if (x instanceof Blob) return { cropBlob: x };
  return x;
}

// ============= 单字米字格 =============
// input: Blob 或 { cropBlob?, char? }
// 返回:PNG Blob,默认 600x600
export async function renderMiZiGe(input, { size = 600 } = {}) {
  const item = normalizeItem(input);
  const img = item.cropBlob ? await blobToImage(item.cropBlob) : null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  drawSingleCell(ctx, img, 0, 0, size, { charText: item.char || '' });
  return canvasToBlob(c);
}

// ============= 多字米字格组合 =============
// charBlobs: [Blob, Blob, ...]
// 自动判断网格:1→1×1, 2→1×2, 3→1×3, 4→2×2, 5/6→2×3, 7/8/9→3×3
// gap: 单元之间的间距(像素)
// charLabels: 可选,每个格子下方可附文字(字 + 书体)
export async function renderMiZiGeGrid(inputs, { cellSize = 480, gap = 16, bg = '#fffbf0', showLabels = false } = {}) {
  const items = inputs.map(normalizeItem);
  const n = items.length;
  const { cols, rows } = pickGrid(n);
  const width  = cols * cellSize + (cols + 1) * gap;
  const labelH = showLabels ? 40 : 0;
  const height = rows * (cellSize + labelH) + (rows + 1) * gap;

  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 预加载所有图(没有 cropBlob 的留 null,后面 cell 里用 charText 兜底)
  const imgs = await Promise.all(items.map(it => it.cropBlob ? blobToImage(it.cropBlob) : null));

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellSize + gap);
    const y = gap + row * (cellSize + labelH + gap);
    drawSingleCell(ctx, imgs[i], x, y, cellSize, { charText: items[i].char || '' });
    if (showLabels && items[i].char) {
      ctx.fillStyle = '#2c2520';
      ctx.font = `bold 20px "STKaiti","KaiTi",serif`;
      ctx.textAlign = 'center';
      ctx.fillText(items[i].char + (items[i].style ? `(${items[i].style})` : ''), x + cellSize / 2, y + cellSize + 28);
    }
  }
  return canvasToBlob(c);
}

function pickGrid(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 3) return { cols: 3, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  if (n <= 9) return { cols: 3, rows: 3 };
  // >9 字:按 ceil(√n) 拼
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

function canvasToBlob(c, type = 'image/png', quality = 0.92) {
  return new Promise(resolve => c.toBlob(b => resolve(b), type, quality));
}
