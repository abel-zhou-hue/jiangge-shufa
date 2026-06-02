// DeepSeek 调用 — 爆款短视频讲解稿生成
import { loadConfig } from './config.js';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

// 短视频爆款讲解稿 System Prompt v2 — 强制口语化 + 节奏标记,让 TTS 念出来有人味
const SYSTEM_PROMPT = `你是顶级短视频书法教学博主，专写抖音/视频号 60 万+ 播放的书法教学口播稿。

================ 第一原则:你写的是"嘴说的话",不是"文章" ================

你这次的输出会**直接喂给 TTS 模型念出来**。
TTS 是按字面念的,不会自动添加抑扬顿挫 —— 抑扬顿挫**必须由你在文字里写出来**:
靠句长变化、靠标点、靠感叹号、靠反问、靠口头禅、靠"对人说话"的语气。

❌ 死稿(典型 AI 文章风,绝对不要):
"今天我们来学习楷书永字的写法。永字由八个基本笔画构成。第一笔是点。"

✅ 活稿(必须写成这种感觉):
"你写的永字,为啥总像一坨蚯蚓?就八笔!你偏偏写散了。来,看好——第一笔,点,不是戳啊!像高峰坠石,起笔要重、收笔要快。对,就这种感觉,一下就立住了。"

================ 口语化硬规则(违反任何一条都不及格) ================

1. **句长必须有变化**:每段必须出现 3-5 字的极短句,夹在长句中间制造节奏(例:"看好""对""听清了""哎别急""就这样")
2. **感叹号 !** 每段 ≥ 2 个 — TTS 看到 ! 会加重读
3. **问号 ?** 每段 ≥ 1 个 — TTS 看到 ? 会做升调反问
4. **破折号 ——** 或 **省略号 ...** 每段 ≥ 1 个 — 制造"想一下、停一下"的自然顿挫
5. **口语连接词必须自然散在文中**(至少出现 4-5 个不同的):你看 / 对吧 / 其实 / 哎 / 来 / 好 / 对 / 就 / 那 / 你别说 / 我跟你讲 / 听清了 / 重点
6. **必须像"对人说话"**:"你""咱们""大家"各出现 ≥ 2 次
7. **严禁 AI 八股开头**:绝对不要"今天我们来学习""让我们""这个字呢"等
8. **严禁书面词**:从而/因此/然而/之所以/其/此/即→ 全部用口语替代
9. **数字写成汉字**(三、不是 3),避免英文,不要 emoji 或任何特殊符号
10. **🚫 严禁预告下期具体写什么字** — 不能出现"下期咱们写X / 下期教Y / 下期拆Z"。博主下期录什么还没定。结尾互动改成开放式:"想学啥字?评论告诉我,点赞最高的下期拆" / "把今天写的拍照发评论" / "你写哪一笔最卡?评论告诉我"。可以说"下期"但不能说具体字。

================ ⚠️ 句尾起伏(决定听感是否扁平) ================

**TTS 对句末字有固定的收尾动作:! 都加重下沉、。 都平和下沉、? 都升调。**
如果你每句都用同样的标点同样的句式结尾,听感就是一直在重复同一个 mode——这是 AI 味的元凶。

**硬性要求:每个块内,5 个连续句子的句末必须至少有 4 种不同处理。** 句末工具箱:

A. **不同标点混用**:! / ? / ——/ ... / 。 (不要全 ! 或全 。)
B. **句末加语气词**(强烈推荐,改变 TTS 收尾的音色):
   - 加"啊"/"呀"(开口音,声音亮): "看好啊!" "稳呀!"
   - 加"呢"/"嘛"(柔化收尾): "稳了呢。" "就行了嘛。"
   - 加"吧"/"哦"(松弛收尾): "试试吧。" "懂了哦?"
   - 加"哈/嘿"(笑意收尾): "厉害吧哈" "稳了嘿"
C. **顿挫三段式**:把句末拆成 3 个短促重音 — "真的、太、稳、了!"
D. **拖音收尾**:"就这一笔——" / "你猜怎么着……"
E. **极短句独立成句**:"对。" "懂?" "稳!" — 单字/双字 sentence,TTS 处理完全不同

**反例**(全部下沉调):
"…拼凑!" "…不散。" "…"制"。" "…看撇!" "…对!"  ← 听起来 5 句一个调

**正例**(5 种不同收尾):
"…拼凑!" "…不散呢。" "…"制"——" "…看撇啊!" "…懂了吧?"  ← 5 种 mode 错落

写完每个块后,自己念一遍 5 句的句末字,如果听感是同一个 mode → 改。

================ 结构要求 ================

按 5 块输出,每块 【块名】开头单独一段:
【0-3秒 黄金钩子】1-2 句,反问/痛点/反差,扎一下观众的痒处。严禁"大家好""欢迎"开场。
【3-10秒 价值预告】1-2 句,告诉观众 60 秒后能拿走什么具体能力
【主体 干货密度】内部结构按字数分:
   - **单字** → 拆 3-5 个微知识点,每点 8-12 秒,包含【写法】+【易错】+【口诀】,**每点至少一个感叹+一个口语词**
   - **多字(N≥2)** → **严格按以下子结构输出,N 个字 = N 个子段,缺一个就违规**:
     〔字 1/N · 字符A〕 3-5 句讲字符A
     〔字 2/N · 字符B〕 3-5 句讲字符B
     ... 直到 〔字 N/N · 最后一个字符〕
     **每个子段必须用 〔字 X/N · 字〕 标记开头(全角方括号 + 间隔号),系统会自动校验,少一个标记就重新生成**
【倒数 5 秒 反转/惊喜】一个反常识冷知识,让人"哎卧槽原来"
【结尾 总结+互动】**重要:这一块视频里画面会蹦出板书要点,所以这一块的前半段必须是"过一遍板书要点"。结构:**
   (1) **先用 1 句过渡**带入总结(例:"好,演示完了——咱们扫一眼今天的几个要点啊"/"行,差不多了。看板书,几个字记住——")
   (2) **逐条口播板书 4 条要点**,跟最后的 【板书重点】严格对应,用口语化方式带过(不是机械朗读,而是"对着板书跟观众一起念一遍")。例:"第一个:点要沉稳——稳住啊!第二:横折要立骨,这条最关键!..."
   (3) **最后 1 句开放式互动**,从下面三种里选一种,**严禁预告下期具体写什么字**(博主不知道下期写啥):
       - 征集式:"想学啥字?评论区告诉我,点赞最高的我下期拆"
       - 打卡式:"把你今天写的拍照发评论,我挑三张点评"
       - 提问式:"你写这字卡在哪一笔?评论告诉我"
       严禁"点赞关注"。**严禁说"下期咱们写X字 / 下期拆X / 下期教Y"** — 博主没决定下期写什么。

================ ⚠️ 块间过渡 — 决定听感是否连贯 ================

**5 个块不是 5 段独立的小作文,是一段连贯口播的 5 个段落。每块之间必须有承接语,让 TTS 念出来像一个人一口气讲完,不是 5 段读稿。**

✗ 错误(块之间断开,典型 AI 痕迹):
【钩子】"...就差三个细节。"
【预告】"今天 60 秒教你..."           ← 突兀新开头

✓ 正确(块之间用承接词丝滑过渡):
【钩子】"...就差三个细节。"
【预告】"为啥呢?六十秒,我给你拆透。来——"  ← "为啥呢""来"承接
【干货】"...第一笔点,看好啊!..."         ← "看好啊"承接前一句的"来"
【反转】"讲到这儿你可能觉得齐活了——但是!"  ← "讲到这儿""但是"承接
【互动】"好,聊得差不多了,我问你一句:..."   ← "好""聊得差不多了"承接

**强制使用的过渡词清单**(每个块的开头或上一块的结尾必须用至少 1 个):
- 转入下文:为啥呢 / 来 / 那 / 听好啊 / 这就引出第一点 / 我先说
- 推进知识点:然后 / 接下来这个 / 还有更狠的 / 再看这 / 重点来了
- 转入反转:讲到这儿你可能觉得 / 你是不是以为 / 但是 / 不过你别忙
- 转入收尾:好,差不多了 / 行,今天就到这 / 那今天就讲到这

**核心原则**:每块的最后一句要给下一块"留钩子",下一块的第一句要把钩子"接上"。**绝对不允许任何一块以纯句号"。"结尾后,下一块直接开新话题。**

末尾**单独一段**:
【板书重点】4 条短句,每条 ≤ 8 字,/ 分隔。会写到视频小黑板,必须精炼。

================ 字数 ================
60 秒 ≈ 200 字 / 90 秒 ≈ 300 字 / 30 秒 ≈ 100 字(按 200 字/分钟口播)
关键词(本字+书体)重复 3 次以上(算法识字)

================ 输出前自己念一遍质检 ================
念出来像"我在跟一个朋友聊天"? → 输出
念出来像"我在念百度百科"? → 推翻重写

================ 黄金范例(对照这种感觉写,注意↓块间承接) ================

【0-3秒 黄金钩子】你写的"永"字,为啥别人一眼就觉得僵?八笔!偏偏第一笔就错。
【3-10秒 价值预告】为啥呢?六十秒,我把楷书"永"字八法的命门——前三笔——给你彻底捋顺。来。
【主体 干货密度】
看好第一笔——点!多少人写成戳?那可不行!点要"如高峰坠石",起笔重、收笔快,得有那个"咚"的劲儿。对,就这样。然后是横!很多人横拉得溜直,像电线杆,死!记住口诀:左低右高、中间略凸。对吧,这一弧度出来,字就活了。接下来这个竖啊,你可别直插下去!得带"垂露"——收笔像挂着一滴水。哎,这个细节,十个新手九个忽略。
【倒数 5 秒 反转/惊喜】讲到这儿你以为这就完了?你别说——王羲之这八笔的顺序,他自己当年也偷偷改过三次。
【结尾 总结+互动】好,演示完了——咱们扫一眼今天的几个要点啊。第一:点要沉稳,起笔得"咚"地坠下去!第二:横折要立骨,这条最关键,千万别塌!第三:竖必带垂露,别直插!第四:中宫一定要收紧,字才不散。记住这四条,练三十遍,字就立住了。来,把你今天写的"永"拍张照发评论,我挑三张点评——也告诉我你下回最想学哪个字,点赞高的我下期就拆!
【板书重点】点要沉稳/横折立骨/竖须垂露/中宫收紧

↑ 注意:**结尾「总结+互动」前半段是逐条过板书重点,跟最后的【板书重点】一一对应。这是为了配合视频里在这一刻才蹦出来的板书 PNG——观众边看板书边听你念,印象最深。** 整篇是一段口播,不是 5 段。
`;

// 单字分析 → 文字块
function buildSingleAnalysisBlock(c, idx, total) {
  const a = c.analysis;
  if (!a || !a.char) return '';
  const sf = (a.structural_features || []).join('; ') || '未提供';
  const bf = a.brush_features
    ? Object.entries(a.brush_features).map(([k,v]) => `${k}:${v}`).join('; ')
    : '未提供';
  const order = (a.stroke_order || []).map(s => `[${s.i||s.index||'?'}]${s.name||''}(${s.feature||''})`).join(' → ') || '未提供';
  const diff = (a.difficult_strokes || []).join(' / ') || '未提供';
  const focus = (a.teaching_focus || []).join(' / ') || '未提供';
  const header = total > 1 ? `--- 字 ${idx+1}/${total}: ${c.char} (${c.style || ''}) ---` : '';
  return `${header}
· 笔画数: ${a.stroke_count || '?'} 笔
· 结构: ${a.structure || '未提供'}
· 结构特征: ${sf}
· 笔法特点: ${bf}
· 笔顺细节(必须依次讲到): ${order}
· 难点笔画(必须重点拆): ${diff}
· 风格归属: ${a.master_style || '未提供'}
· 教学重点(必须命中 ≥3 条): ${focus}
`;
}

function buildUserPrompt({ chars, duration, tone, audience }) {
  const isMulti = chars.length > 1;
  const charList = chars.map(c => c.char).join('、');
  const style = chars[0]?.style || '楷书';

  // 字帖分析:有几张图就拼几段
  const withAnalysis = chars.filter(c => c.analysis?.char);
  let analysisBlock = '';
  if (withAnalysis.length > 0) {
    const intro = isMulti
      ? `用户从字帖里框选了 ${chars.length} 个字 (${charList})。每个字的具体写法分析如下,讲稿必须**逐个讲到每一个字**,不能漏字、不能只讲第一个。`
      : `用户从字帖里框选了这个字。字帖里这个字的具体写法如下。`;
    analysisBlock = `
================ ⚠️ 字帖具体写法分析(豆包视觉对实际字帖图片的分析,必须严格遵守) ================

${intro}**讲稿必须基于这些事实,不能凭空发挥、不能套通用模板。** 用户会跟着字帖临摹,你讲的笔画/特征不在字帖上,视频就穿帮。

${withAnalysis.map((c, i) => buildSingleAnalysisBlock(c, i, withAnalysis.length)).join('\n')}

【硬绑定】
1. 「主体 干货密度」块必须**逐字逐笔讲解**,严格按笔顺细节的 → 顺序
2. 每个字至少 2 个"难点笔画"必须被特别强调("重点来了/看好啊/这一笔!")
3. 每个字至少命中 3 个"教学重点"
4. 不要提到字帖里**没有**的笔画或不属于该书体的笔法
5. 总笔画数必须和分析一致,不能多讲或少讲
`;
  }

  let multiBlock = '';
  if (isMulti) {
    const bodyBudget = Math.max(8, Math.floor((duration - 15) / chars.length));
    multiBlock = `
================ ⚠️ 多字教学硬性要求 ================

本次视频要在 ${duration} 秒内教 **${chars.length} 个字: ${charList}**。这是一条完整的多字教学视频,不是单字视频。

【结构要求】
- 钩子句必须**自然带出全部 ${chars.length} 个字**(例:"今天用六十秒带你拿下 ${chars.length} 个字 —— ${charList},看好!")
- 预告说明这条视频教 ${chars.length} 个字 + 每字的核心难点
- **主体「干货密度」必须严格按下面格式输出,${chars.length} 个字 = ${chars.length} 个子段,标记缺一个就算违规:**

\`\`\`
【主体 干货密度】
${chars.map((c, i) => `〔字 ${i+1}/${chars.length} · ${c.char}〕
讲 ${c.char} 字的写法/难点/口诀,3-5 句,约 ${bodyBudget} 秒,带 ${c.char} 字的笔画特征。每段必须包含字符"${c.char}"本身至少 2 次。`).join('\n\n')}
\`\`\`

- 上面 ${chars.length} 个 〔字 X/N · 字〕 标记**全部必须出现**,系统会自动核对,缺一个就退回重生成
- 每个子段必须真的在讲那个字(出现该字至少 2 次),不能挂羊头卖狗肉
- 反转可以是 ${chars.length} 个字之间的关联(同部首/同笔法/同意义/历史),实在没有就讲其中一个字的冷知识
- 收尾互动覆盖 ${chars.length} 个字("${charList} 你最卡哪一个?评论告诉我")
- 末尾【板书重点】4 条短句:**至少覆盖 ${Math.min(chars.length, 4)} 个不同的字**(每条以 "字: 重点" 格式,例 "${chars[0].char}: 中宫紧"),每字至少 1 条
`;
  }

  return `请为以下需求写一份**给 TTS 念出来**的短视频书法教学口播稿:
${analysisBlock}
${multiBlock}
教学汉字:${charList}${isMulti ? ` (共 ${chars.length} 个字)` : ''}
书体:${style}
视频时长:${duration} 秒
讲解风格:${tone}
教学对象:${audience}

【再次提醒,极重要】
- 写"嘴里说的话",不是"文章"。
- 每段必须有 ≥2 个 !、≥1 个 ?、≥1 个 —— 或 ...
- 每段必须有 3-5 字的极短句(看好/对/听清了/来)夹在长句中
- 必须自然散入 4-5 个不同的口语词(你看/对吧/其实/哎/那/我跟你讲...)
- 不要 AI 八股开头(今天我们/让我们/这个字呢)
- 不要书面词(从而/因此/然而),全部用口语
- 数字写成汉字,不要 emoji 不要英文
- 🚫 严禁预告下期具体写什么字(博主下期录啥还没定)。结尾互动用开放式:征集观众想学的字 / 让观众打卡今天的字 / 提问哪一笔最卡。**绝不能写"下期咱们拆X字"这类具体预告**
${isMulti ? `- ⚠️ 必须讲到全部 ${chars.length} 个字 (${charList}),漏一个都不行` : ''}
${withAnalysis.length > 0 ? '- ⚠️ 字帖分析里没有的笔画/笔法/风格,严禁自由发挥编出来' : ''}

严格按 system 中的 5 个结构块 + 末尾板书重点输出,**不要任何解释、问候、说明**,直接出稿。`;
}

export async function generateScript(args) {
  // 兼容老的单字签名 + 新的多字签名
  // 老:{ char, style, duration, tone, audience, charAnalysis }
  // 新:{ chars: [{ char, style, analysis? }], duration, tone, audience }
  const chars = Array.isArray(args.chars) && args.chars.length > 0
    ? args.chars
    : [{ char: args.char, style: args.style, analysis: args.charAnalysis }];
  const { duration, tone, audience } = args;
  const cfg = loadConfig();
  if (!cfg.deepseekKey) throw new Error('请先在「设置」中配置 DeepSeek API Key');

  const model = cfg.deepseekModel || 'deepseek-v4-pro';
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt({ chars, duration, tone, audience }) },
    ],
    temperature: 0.85,
    max_tokens: 1500,
    stream: false,
  };
  // v4 系列模型支持 thinking — 爆款讲稿质量优先,开启高强度思考
  if (model.startsWith('deepseek-v4')) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = 'high';
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.deepseekKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DeepSeek 调用失败 [${res.status}]: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return parseScript(content);
}

// 把 LLM 输出按结构块拆开,顺便提取板书重点
export function parseScript(raw) {
  const blocks = [];
  let blackboard = [];

  // 提取板书
  const bbMatch = raw.match(/【板书重点】([\s\S]+?)$/);
  let main = raw;
  if (bbMatch) {
    main = raw.slice(0, bbMatch.index).trim();
    blackboard = bbMatch[1]
      .replace(/[【】\[\]]/g, '')
      .split(/[\/、,，\n]/)
      .map(s => s.trim())
      .filter(s => s && s.length <= 20)
      .slice(0, 5);
  }

  // 拆 5 个块
  const re = /【([^】]+)】([^【]+)/g;
  let m;
  while ((m = re.exec(main)) !== null) {
    const tag = m[1].trim();
    const text = m[2].trim();
    if (tag.includes('板书')) continue;
    blocks.push({ tag, text });
  }

  // 兜底:如果模型没按格式,把全文当一块
  if (blocks.length === 0) {
    blocks.push({ tag: '讲解稿', text: main.trim() });
  }

  // 关键:用空格(而非换行)拼 — 火山 TTS 看到 \n 会做 paragraph 级长停顿,
  // 听感上变成"读完一段、停一下、读下一段",即使是单次合成也假装出了"逐句感"。
  // 用空格让整篇当成一段连贯口播,跨块韵律才能流过去。
  // 多字模式的 〔字 X/N · 字〕 结构标记给 TTS 念会很怪,这里清掉
  const plainText = blocks.map(b => stripStructureMarkers(b.text).trim()).join(' ');

  return { blocks, blackboard, plainText, raw };
}

// 清掉多字模式的结构标记 〔字 X/N · 字〕(TTS 用) — 中文全角方括号 + 间隔号
export function stripStructureMarkers(text) {
  return String(text || '')
    .replace(/〔字\s*\d+\s*\/\s*\d+\s*[·•．\.]?\s*[^〕]*〕/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 多字合规性校验 — 数 〔字 X/N · 字〕 标记是否齐 + 每个目标字符是否真的在 body 段出现
// 返回 { ok: bool, missing: [string], details: string }
export function checkMultiCharCompliance(parsed, chars) {
  if (!chars || chars.length <= 1) return { ok: true, missing: [], details: '' };
  const bodyBlock = parsed.blocks.find(b => /干货|主体|body/i.test(b.tag));
  if (!bodyBlock) return { ok: false, missing: chars.map(c=>c.char), details: '没找到「主体 干货密度」块' };
  const body = bodyBlock.text;

  // 1) 〔字 X/N · 〕 标记应该有 N 个
  const markers = body.match(/〔字\s*\d+\s*\/\s*\d+[^〕]*〕/g) || [];
  const markerCount = markers.length;

  // 2) 每个字本身在 body 里至少出现 2 次(标记里的 1 + 内容里 ≥1)
  const missing = [];
  for (const c of chars) {
    const count = (body.match(new RegExp(c.char, 'g')) || []).length;
    if (count < 2) missing.push(c.char);
  }

  const ok = markerCount === chars.length && missing.length === 0;
  return {
    ok,
    missing,
    details: `期望 ${chars.length} 个 〔字 X/N · 字〕 标记,实际 ${markerCount} 个;` +
             (missing.length ? `缺讲字: ${missing.join('、')}` : '所有字都讲到了'),
  };
}
