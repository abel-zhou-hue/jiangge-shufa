// CloudBase 云函数 — 通用 CORS 代理
// 用法:前端把请求发到 https://<your-fn>.tcb.qcloud.la/?target=<被代理URL>
//      Body / Headers 透传给目标地址,响应也透传回来
//
// 部署步骤:
// 1) 登录 https://console.cloud.tencent.com/tcb
// 2) 选择你的环境 → 云函数 → 新建
// 3) 函数名:tts-proxy,运行环境:Node.js 16
// 4) 上传本目录 zip,或直接复制本文件内容
// 5) 网络配置 → HTTP 访问 → 开启,记下访问路径
// 6) 把路径填到工作台「设置 → CORS 代理」

exports.main = async (event, context) => {
  const headers = event.headers || {};
  const method = event.httpMethod || 'POST';

  // CORS 预检
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
      body: '',
    };
  }

  const query = event.queryStringParameters || event.queryString || {};
  const target = query.target;
  if (!target) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'missing target' }),
    };
  }

  // 透传 headers,但去掉 host / cookie 等
  const fwdHeaders = {};
  for (const k in headers) {
    const lk = k.toLowerCase();
    if (['host','content-length','cookie','x-forwarded-for','x-forwarded-host','x-real-ip','x-tcb-source-ip','origin','referer'].includes(lk)) continue;
    fwdHeaders[k] = headers[k];
  }

  const body = event.body;
  const isBase64 = event.isBase64Encoded;
  let bodyBuf;
  if (body) {
    bodyBuf = isBase64 ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf-8');
  }

  // 用原生 https
  const url = new URL(target);
  const lib = url.protocol === 'https:' ? require('https') : require('http');

  const respond = await new Promise((resolve) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      method,
      path: url.pathname + (url.search || ''),
      headers: fwdHeaders,
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        const respHeaders = { ...resp.headers };
        // 加 CORS
        respHeaders['Access-Control-Allow-Origin'] = '*';
        respHeaders['Access-Control-Expose-Headers'] = '*';
        // 移除可能干扰 gateway 的 hop-by-hop
        delete respHeaders['connection'];
        delete respHeaders['transfer-encoding'];
        delete respHeaders['content-encoding'];

        const ct = (resp.headers['content-type'] || '').toLowerCase();
        const isText = ct.includes('json') || ct.includes('text') || ct.includes('xml');
        resolve({
          statusCode: resp.statusCode,
          headers: respHeaders,
          body: isText ? buf.toString('utf-8') : buf.toString('base64'),
          isBase64Encoded: !isText,
        });
      });
    });
    req.on('error', (err) => {
      resolve({
        statusCode: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'proxy_request_failed', message: err.message }),
      });
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });

  return respond;
};
