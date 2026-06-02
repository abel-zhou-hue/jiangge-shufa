// 豆包视觉模型 — 识别图片中的汉字 + 判断书体
// 走火山 ark 兼容 OpenAI 接口
import { loadConfig } from './config.js';

const ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 【快速识别】只认字 + 书体,框选时秒返回(1-2 秒)
const SYSTEM_QUICK = `你是一位资深书法识字专家。看到一张图片(通常是从字帖里截取的某个字),需要:
1) 识别出图里的汉字是什么(如果有多个字,告诉我最显眼/最完整的那个)
2) 判断这个字的书体(楷书/行书/草书/隶书/篆书/其他)
3) 评估它的清晰度和是否适合作为教学示范

严格用如下 JSON 格式回答,不要任何额外解释:
{"char":"永","style":"楷书","confidence":0.95,"suitable_for_teaching":true,"note":"清晰,结构完整"}

如果识别不出来,返回 {"char":"","style":"","confidence":0,"suitable_for_teaching":false,"note":"图片模糊"}`;

// 【深度分析】教学级:笔顺/结构/笔法/难点,生成讲稿前才调用
const SYSTEM_DEEP = `你是资深书法识字 + 教学分析专家。看一张从字帖截取的字图,**针对这张字帖里这个字的具体写法**做教学级分析(笔画顺序、结构、笔法、难点),让后续 AI 写讲解稿时不会瞎编、能完全贴合字帖。

严格按如下 JSON 返回,不要任何额外文字、不要 markdown 代码块:

{
  "char": "永",
  "style": "楷书",
  "confidence": 0.95,
  "stroke_count": 8,
  "structure": "独体字",
  "structural_features": [
    "中宫紧凑、八面舒展",
    "上下高度比例约 1:1.1",
    "左右部均衡,重心偏下"
  ],
  "brush_features": {
    "起笔": "藏锋逆入,顿挫明显",
    "行笔": "中锋为主,提按分明",
    "收笔": "回锋收尾,部分笔画带垂露"
  },
  "stroke_order": [
    {"i":1,"name":"点","feature":"高峰坠石,重起轻收"},
    {"i":2,"name":"横折钩","feature":"折角方整,出钩短促"},
    {"i":3,"name":"撇","feature":"出锋利落,带弧度"}
  ],
  "difficult_strokes": [
    "第2笔横折钩 — 折角方整不能塌",
    "第6笔捺画 — 一波三折,出锋舒展"
  ],
  "master_style": "近欧阳询《九成宫》风格",
  "teaching_focus": [
    "起笔需藏锋顿挫",
    "中宫务必紧凑",
    "捺画需舒展有力"
  ],
  "note": "字帖清晰,适合教学示范"
}

【硬性要求】
- 笔画顺序(stroke_order)必须真的看图认出来,**不能套通用模板**。每一笔都给出在这张图里的实际特征。
- 难点笔画(difficult_strokes)必须指向具体笔顺号(第N笔)+ 具体特征,不能泛泛说"起笔要重"。
- 教学重点(teaching_focus)必须 3-5 条,每条对应一个具体的可观察特征。
- 如果识别不出来或字模糊,所有字段保留为空字符串/0/空数组,note 写明原因。`;

// 通用调用 — 内部
async function callDoubao(imageBlob, systemPrompt, userPrompt, maxTokens) {
  const cfg = loadConfig();
  if (!cfg.doubaoKey) throw new Error('请先在「设置」配置豆包视觉 API Key');

  const base64 = await blobToBase64(imageBlob);
  const dataUrl = `data:${imageBlob.type || 'image/png'};base64,${base64}`;

  const body = {
    model: cfg.doubaoModel || 'ep-20260427205304-9kmtr',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.doubaoKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[豆包视觉] 错误响应:', txt);
    throw new Error(`豆包视觉调用失败 [${res.status}]: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';

  // 容错解析 JSON
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) {
    console.warn('豆包视觉结果解析失败', content);
  }
  return null;
}

// 【快速识别】框选时调,1-2 秒返回 {char, style, confidence, ...}
export async function recognizeCharFromImage(imageBlob) {
  const r = await callDoubao(imageBlob, SYSTEM_QUICK, '识别这张字帖截图里的汉字和书体。', 200);
  return r || { char: '', style: '', confidence: 0, note: '解析失败' };
}

// 【深度分析】生成讲稿前调,5-15 秒返回完整教学分析
export async function analyzeCharDeep(imageBlob) {
  const r = await callDoubao(
    imageBlob,
    SYSTEM_DEEP,
    '教学级分析这张字帖截图里的字。必须真的看图分析这个字在这张图里的具体写法,不能套通用模板。',
    1500
  );
  return r || { char: '', style: '', stroke_count: 0, note: '解析失败' };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result;
      const idx = s.indexOf(',');
      resolve(s.slice(idx + 1));
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
