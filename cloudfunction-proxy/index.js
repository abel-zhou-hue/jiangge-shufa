// CloudBase 云函数 — 火山 CORS 代理
// 用法:前端请求 https://<云函数 HTTP 访问 URL>/?target=<火山URL>
// 部署:见仓库 README 中「CloudBase 部署」章节
//
// 安全:只放行 *.bytedance.com / *.volces.com,防止被滥用当成任意代理

const https = require('https');
const http = require('http');
const zlib = require('zlib');

exports.main = async (event, context) => {
  const method = (event.httpMethod || 'POST').toUpperCase();

  // CORS 预检
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }

  const query = event.queryStringParameters || event.queryString || {};
  const target = query.target;
  if (!target) {
    return json({ error: 'missing ?target=<火山URL>' }, 400);
  }

  let url;
  try { url = new URL(target); } catch { return json({ error: 'invalid target url' }, 400); }

  // 域名白名单(防滥用)
  if (!/(^|\.)bytedance\.com$|(^|\.)volces\.com$/.test(url.hostname)) {
    return json({ error: 'target not allowed (仅放行 *.bytedance.com / *.volces.com)' }, 403);
  }

  // 转发 header — 剥掉浏览器/网关自带的、火山不要的
  const headers = event.headers || {};
  const fwd = {};
  const strip = new Set([
    'host','content-length','cookie','origin','referer','user-agent',
    'x-forwarded-for','x-forwarded-host','x-forwarded-proto',
    'x-real-ip','x-tcb-source-ip','x-tcb-request-source',
    'sec-fetch-dest','sec-fetch-mode','sec-fetch-site',
    'sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform',
  ]);
  for (const k of Object.keys(headers)) {
    if (strip.has(k.toLowerCase())) continue;
    fwd[k] = headers[k];
  }
  // 强制上游不压缩 — 否则要在云函数里解压,徒增麻烦
  fwd['accept-encoding'] = 'identity';

  // 请求体(可能是 base64 编码)
  const isB64 = event.isBase64Encoded;
  const bodyBuf = event.body
    ? (isB64 ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf-8'))
    : null;

  const lib = url.protocol === 'https:' ? https : http;
  const respond = await new Promise((resolve) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      method,
      path: url.pathname + (url.search || ''),
      headers: fwd,
      timeout: 60000,
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        let buf = Buffer.concat(chunks);
        // 万一上游忽略 identity 还是压了 → 解一下
        const enc = String(resp.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('br'))      buf = zlib.brotliDecompressSync(buf);
          else if (enc.includes('gzip'))    buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        } catch (_) {}

        const respHeaders = { ...cors() };
        // 透传部分必要 header
        const ct = resp.headers['content-type'];
        if (ct) respHeaders['Content-Type'] = ct;
        if (resp.headers['x-tt-logid']) respHeaders['X-Tt-Logid'] = resp.headers['x-tt-logid'];

        // 错误响应打 log,方便云函数控制台排查
        if (resp.statusCode >= 400) {
          const preview = buf.toString('utf-8').slice(0, 500);
          console.error(`[proxy] ⚠️ ${resp.statusCode} ${target}\n`, preview);
        }

        // 文本响应直接当字符串返回,二进制 base64
        const isText = ct && /(json|text|xml|javascript)/i.test(ct);
        resolve({
          statusCode: resp.statusCode || 502,
          headers: respHeaders,
          body: isText ? buf.toString('utf-8') : buf.toString('base64'),
          isBase64Encoded: !isText,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', (err) => {
      console.error('[proxy] upstream error:', err.message);
      resolve(json({ error: 'upstream_failed', message: err.message }, 502));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });

  return respond;
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}
