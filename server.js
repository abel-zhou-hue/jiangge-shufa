// CloudBase Run / 云托管入口 — 一个容器搞定前端 + 代理
// 路由:
//   /proxy[/]?target=<火山URL>  → 透传到火山(带 CORS)
//   其余路径                     → 静态文件(index.html / js / css / assets / vendor)
//
// 前端通过相对路径 /proxy 调,同源,无需 CORS

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 80);
const ROOT = __dirname;

// ----- MIME -----
const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.mjs':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon',
  '.wasm':'application/wasm', '.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2',
  '.pdf':'application/pdf', '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg', '.wav':'audio/wav',
  '.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8',
};
function mimeFor(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

// ----- 代理 handler -----
async function handleProxy(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const target = u.searchParams.get('target');
  if (!target) return sendJson(res, 400, { error: 'missing ?target=<火山URL>' });

  let dest;
  try { dest = new URL(target); } catch { return sendJson(res, 400, { error: 'invalid target url' }); }
  if (!/(^|\.)bytedance\.com$|(^|\.)volces\.com$/.test(dest.hostname)) {
    return sendJson(res, 403, { error: 'target not allowed (仅放行 *.bytedance.com / *.volces.com)' });
  }

  // 转发 header(剥掉浏览器自带、容器网关自带的)
  const fwd = {};
  const strip = new Set([
    'host','content-length','cookie','origin','referer','user-agent','connection',
    'x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-real-ip',
    'x-tcb-source-ip','x-tcb-request-source',
    'sec-fetch-dest','sec-fetch-mode','sec-fetch-site',
    'sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform',
  ]);
  for (const [k, v] of Object.entries(req.headers)) {
    if (strip.has(k.toLowerCase())) continue;
    fwd[k] = v;
  }
  fwd['accept-encoding'] = 'identity';

  const lib = dest.protocol === 'https:' ? https : http;
  const upstream = lib.request({
    protocol: dest.protocol,
    hostname: dest.hostname,
    port: dest.port || (dest.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: dest.pathname + (dest.search || ''),
    headers: fwd,
    timeout: 60000,
  }, (upRes) => {
    const chunks = [];
    upRes.on('data', c => chunks.push(c));
    upRes.on('end', () => {
      let body = Buffer.concat(chunks);
      const enc = String(upRes.headers['content-encoding'] || '').toLowerCase();
      try {
        if (enc.includes('br'))      body = zlib.brotliDecompressSync(body);
        else if (enc.includes('gzip'))    body = zlib.gunzipSync(body);
        else if (enc.includes('deflate')) body = zlib.inflateSync(body);
      } catch (_) {}

      // 透传响应头(去掉 hop-by-hop 和长度,自己重算)
      const stripResp = new Set(['connection','transfer-encoding','content-encoding','content-length']);
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (stripResp.has(k.toLowerCase())) continue;
        try { res.setHeader(k, v); } catch (_) {}
      }
      setCors(res);
      if (upRes.statusCode >= 400) {
        console.error(`[proxy] ⚠️ ${upRes.statusCode} ${target}`, body.toString('utf-8').slice(0, 400));
      }
      res.writeHead(upRes.statusCode || 502);
      res.end(body);
    });
  });
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', (err) => {
    console.error('[proxy] upstream error:', err.message);
    if (!res.headersSent) sendJson(res, 502, { error: 'upstream_failed', message: err.message });
  });
  req.pipe(upstream);
}

// ----- 静态 handler -----
function handleStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 防穿越
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.setHeader('Content-Type', mimeFor(filePath));
    res.setHeader('Cache-Control', urlPath === '/index.html' ? 'no-cache' : 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  });
}

// ----- server -----
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/proxy' || p === '/proxy/' || p.startsWith('/proxy/')) return handleProxy(req, res);
  return handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[江哥书法工作台] listening on :${PORT}`);
  console.log(`[路由] / → 静态文件 | /proxy → 火山代理`);
});

// ----- 工具 -----
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function sendJson(res, status, obj) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
