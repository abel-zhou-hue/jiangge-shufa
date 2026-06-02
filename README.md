# 江哥书法工作台

纯浏览器跑的毛笔字短视频生成工具：选字 → AI 讲稿 → AI 配音 → 拍摄/上传 → ffmpeg.wasm 合成成片。

## 在线访问

🔗 部署到 GitHub Pages 后：`https://<你的用户名>.github.io/<仓库名>/`

## 三个 API 自带 / 需配

| 服务 | 用途 | CORS | 部署需求 |
|---|---|---|---|
| DeepSeek v4-pro | 生成口播讲稿 | ✅ 开放 | 直接用 |
| 豆包视觉 (ark) | 字帖识字 + 深度分析 | ✅ 开放 | 直接用 |
| 火山引擎 TTS V3 + 声音复刻 V3 | AI 配音 / 克隆音色 | ❌ 不开放 | **必须代理** |

## 火山代理两种方式

### 🟢 推荐：Cloudflare Workers（免费 HTTPS）
1. 复制本仓库 `cf-worker-proxy.js` 的内容
2. 登录 https://workers.cloudflare.com → 创建 Worker → 粘贴代码 → Save and Deploy
3. 得到 URL 类似 `https://jiangge-proxy.<你>.workers.dev`
4. 在工作台「设置 → CORS 代理」填这个 URL

### 🟡 备选：本地代理（仅本地可用）
```bash
node proxy.js
```
然后「设置 → CORS 代理」填 `http://localhost:5174`

⚠️ 本地代理只能在 **本地访问网页** 时用 — GitHub Pages 部署版本因为 HTTPS 不允许调 localhost HTTP，TTS 会失败。

## 本地运行

```bash
# 起静态服务器
python3 -m http.server 5173

# 启动 CORS 代理(如果要用 TTS)
node proxy.js
```

浏览器打开 http://localhost:5173

## 技术栈

- **纯静态** HTML/CSS/ES Modules，零构建
- **视频合成**：ffmpeg.wasm 0.12（自托管 `vendor/`,绕过模块 Worker 跨域限制）
- **PDF 渲染**：pdf.js
- **存储**：IndexedDB（字帖库、视频项目、文件夹句柄）+ localStorage（API Key 配置、音色库）
- **音频管线**：浏览器 MediaRecorder → AudioContext PCM 解码 → 拼接 → WAV → 火山声音复刻 V3
- **TTS 动态语速**：按讲稿块(钩子/预告/干货/反转/总结)并行调 5 次 TTS，每块用不同 emotion + speech_rate，PCM 无缝拼接

## 工作流

1. **选字**：手输 / 字库 pill / 字帖 PDF 框选 + 豆包识别
2. **讲稿**：DeepSeek v4-pro thinking 高强度生成，多字模式有强制结构校验
3. **AI 配音**：火山 ICL 2.0 克隆音色 / 官方 2.0 音色，整段或按块动态合成
4. **拍摄**：USB 摄像头直录 + 同步播放配音 / 或上传已录视频
5. **合成**：ffmpeg.wasm 叠加米字格 + 字幕(PNG 渲染中文,绕开 wasm 字体问题) + 板书（4 种国风风格）
