#!/usr/bin/env node
// 本地 CORS 代理 — 零依赖,绕过火山 V3 TTS / 声音复刻的浏览器 CORS 限制
// 启动: node proxy.js [port]
// 默认端口 5174。前端通过 http://localhost:5174/?target=<URL> 调用。

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.argv[2] || process.env.PORT || 5174);
// 把上游的错误响应(4xx/5xx)落盘,方便定位,不用让用户手动复制
const LOG_FILE = path.join(__dirname, 'proxy-capture.log');

// 透传时需要剥掉的 header(避免污染请求或暴露环境)
const STRIP_REQ = new Set([
  'host', 'origin', 'referer', 'cookie',
  'connection', 'content-length',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'user-agent',
]);
const STRIP_RES = new Set(['connection', 'transfer-encoding', 'content-encoding']);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const server = http.createServer((req, res) => {
  // 预检
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const target = parsed.query.target;
  if (!target) {
    cors(res);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing ?target=<url>' }));
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (e) {
    cors(res);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid target url' }));
    return;
  }

  // 构造转发 headers
  const fwd = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQ.has(k.toLowerCase())) continue;
    fwd[k] = v;
  }
  fwd['host'] = targetUrl.host;
  // 强制上游不压缩 — 代理转发压缩字节但浏览器不知情 → JSON 解析炸掉
  fwd['accept-encoding'] = 'identity';

  const lib = targetUrl.protocol === 'https:' ? https : http;
  const upstream = lib.request({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: targetUrl.pathname + targetUrl.search,
    headers: fwd,
  }, (upRes) => {
    cors(res);
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (STRIP_RES.has(k.toLowerCase())) continue;
      res.setHeader(k, v);
    }
    const status = upRes.statusCode || 502;

    // 声音复刻 / 状态查询 / 所有错误 → 缓冲下来:
    //   1) 万一上游忽略 identity 仍然压缩 → 在这里解压,保证浏览器拿到干净 JSON
    //   2) 落盘 + 打印,方便定位
    const isClone = /voice_clone|get_voice/.test(target);
    const isTts   = /\/api\/v[13]\/tts\//.test(target);
    if (status >= 400 || isClone || isTts) {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        let body = Buffer.concat(chunks);
        const enc = String(upRes.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('br'))      body = zlib.brotliDecompressSync(body);
          else if (enc.includes('gzip'))    body = zlib.gunzipSync(body);
          else if (enc.includes('deflate')) body = zlib.inflateSync(body);
        } catch (_) { /* 解压失败就发原始 */ }
        const text = body.toString('utf8');
        const line = `\n===== ${new Date().toISOString()} [${status}] ${target} =====\n${text.slice(0, 4000)}\n`;
        try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
        if (status >= 400) console.error(`[proxy] ⚠️ ${status} ${target}\n`, text.slice(0, 2000));
        else               console.log(`[proxy] ✓ ${status} ${target}\n`, text.slice(0, 500));
        // 解压后长度可能变 → 去掉旧 content-length / content-encoding,让 node 重新算
        res.removeHeader('content-encoding');
        res.removeHeader('content-length');
        res.writeHead(status);
        res.end(body);
      });
      upRes.on('error', () => { try { res.end(); } catch (_) {} });
    } else {
      res.writeHead(status);
      upRes.pipe(res);
    }
  });

  upstream.on('error', (err) => {
    console.error('[proxy] upstream error:', err.message);
    if (!res.headersSent) {
      cors(res);
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'upstream_failed', message: err.message }));
  });

  // 透传请求体
  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] CORS 代理已启动`);
  console.log(`[proxy] 监听 http://localhost:${PORT}`);
  console.log(`[proxy] 用法: http://localhost:${PORT}/?target=https://openspeech.bytedance.com/api/v3/tts/unidirectional`);
  console.log(`[proxy] 把这个 URL 前缀填到工作台「设置 → CORS 代理」字段:`);
  console.log(`[proxy]   http://localhost:${PORT}`);
});

process.on('SIGINT', () => { console.log('\n[proxy] 关闭'); server.close(() => process.exit(0)); });
