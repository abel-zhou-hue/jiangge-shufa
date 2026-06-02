// Cloudflare Workers 版火山 CORS 代理
// 部署:登录 workers.cloudflare.com → Create Worker → 粘贴本文件 → Save and Deploy
// 部署后 URL 类似 https://jiangge-proxy.<your>.workers.dev
// 然后在工作台「设置 → CORS 代理」填这个 URL(不带末尾斜杠)
//
// 工作原理:浏览器 → 这个 Worker → 火山 openspeech.bytedance.com → 回浏览器
// 全程 HTTPS,GitHub Pages 部署的页面也能直接调

export default {
  async fetch(request) {
    // 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('target');
    if (!target) {
      return json({ error: 'missing ?target=<火山URL>' }, 400);
    }

    let targetUrl;
    try { targetUrl = new URL(target); } catch { return json({ error: 'invalid target url' }, 400); }

    // 只放行火山域名,防止被滥用当成任意代理
    if (!/(^|\.)bytedance\.com$|(^|\.)volces\.com$/.test(targetUrl.hostname)) {
      return json({ error: 'target not allowed (仅允许 *.bytedance.com / *.volces.com)' }, 403);
    }

    // 复制请求头,剥掉浏览器自动加的、火山不要的
    const fwd = new Headers();
    const stripReq = new Set(['host','origin','referer','cookie','user-agent','content-length',
      'sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform']);
    for (const [k, v] of request.headers.entries()) {
      if (stripReq.has(k.toLowerCase())) continue;
      fwd.set(k, v);
    }

    // 转发
    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: fwd,
        body: ['GET','HEAD'].includes(request.method) ? undefined : request.body,
      });
    } catch (e) {
      return json({ error: 'upstream_failed', message: String(e) }, 502);
    }

    // 把响应包一层 CORS 头返回
    const respHeaders = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(corsHeaders())) respHeaders.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
