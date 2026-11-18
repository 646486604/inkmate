# 墨伴 InkMate · 自用 AI 陪伴聊天 App 实施计划

> 状态：草案 v0.2（已确认部署 / 音乐 / 模型 / 通知方向）  
> 进度：**M0–M6 全部完成**（登录、Provider、聊天、世界书/记忆、群聊、主动消息、动态、一起听、PWA、Web Push、备份恢复、自启、主题/字号、schema 测试）。  
> 日期：2026-11-18  
> 参考产品：[章鱼喷墨机 Octopus](https://chengyeliiii.github.io/Octopus/)（[源码](https://github.com/chengyeliiii/Octopus)）  
> 工作名：墨伴 / InkMate（可随时改名）

---

## 1. 一句话目标

做一个**只给自己用**、可接入 DeepSeek / Gemini / 第三方自定义 API 的 AI 陪伴聊天 App：像微信一样和多个角色聊天，角色会**主动找你**、**主动发动态**，还能和你**一起听歌**。数据存在自己的电脑上，Key 不进浏览器。

---

## 2. 参考产品拆解

### 2.1 它是什么

Octopus 是一个纯前端单文件应用（仓库只有一个约 288 KB 的 `index.html`），微信风格的 AI 角色聊天工具。数据落在浏览器本地，直接 `fetch` 大模型接口。

已具备的能力（从界面与源码梳理）：

| 模块 | 具体功能 |
|---|---|
| 聊天 | 私聊、群聊、流式回复、消息编辑/删除/多选、时间分隔、未读 |
| 角色 | 角色卡（姓名、备注、人设、头像）、我的姓名/人设、群成员独立人设 |
| 世界书 | 多条条目，按「前/后」位置注入系统提示词 |
| 记忆 | 可配置「最大记忆轮数」，按轮数截断历史 |
| 消息类型 | 文字、表情包、语音（文字模拟）、图片/视频、转账、礼物、时间跳跃、事件记录 |
| 个性化 | 主题色、气泡样式、聊天背景、字体、壁纸、首页模式 |
| 数据 | 本地备份/导入、清空记录 |
| 模型 | OpenAI 兼容 `/v1/chat/completions` + Gemini 原生接口，多 Key 随机 |

### 2.2 值得借鉴

- **微信式信息架构**：消息列表 → 聊天页 → 设置，学习成本几乎为零。
- **角色卡 + 世界书前后注入 + 记忆轮数**：轻量但有效的人设控制。
- **群聊里每个成员独立人设**，而不是一个“群机器人”。
- **角色化动作**（转账、礼物、时间跳跃、事件记录）能显著增强沉浸感。
- **气泡/主题/背景自定义**，满足“这是我和 TA 的地方”的归属感。
- **纯本地、无账号**，隐私感强。

### 2.3 不满足本需求的部分

| 问题 | 影响 | 我们的做法 |
|---|---|---|
| 纯前端、无服务端 | 关掉页面就没有“主动”；无法定时任务 | 加 Node 后端 + SQLite + 持久化任务队列 |
| API Key 存浏览器 | 泄露风险、换设备要重配 | Key 只存服务端，AES-GCM 加密 |
| 数据在 localStorage | 容量小、易丢、不能多端 | SQLite + 媒体文件目录 + 导出备份 |
| 只有“被动回复” | 角色不会先开口 | 独立主动消息引擎（策略 + 定时 + 防骚扰） |
| 没有动态/朋友圈 | 缺少“角色有自己的生活” | 动态流 + 定时发帖 + 点赞评论 + 角色回应 |
| 没有音乐 | 缺少共同场景 | 本地曲库 + 一起听房间 + AI DJ 实时吐槽 |
| 记忆只靠轮数截断 | 长对话丢设定 | 滚动摘要 + 关键事实卡 + 预算裁剪 |

---

## 3. 产品范围

### 3.1 目标

- 单用户、自部署，多 Provider：OpenAI 兼容（DeepSeek / 硅基流动 / OpenRouter / Ollama / 第三方中转）、Gemini 原生，可自定义 Base URL 与请求头。
- 四大核心场景：**AI 聊天、AI 主动发消息、AI 主动发动态、一起听歌**。
- 手机优先的 PWA，桌面可用；数据完全自持。
- 电脑常开（或 Android Termux 常驻）时，角色能按自己的节奏“生活”和“联系你”。

### 3.2 非目标（v1 不做）

- 多用户注册、公开社交、分享给朋友。
- 原生 iOS/Android 客户端（先 PWA）。
- 把音乐文件重新分发/公开分享（网易云仅作个人自用播放，本地文件作兜底）。
- 复杂向量数据库/RAG（先用摘要 + 事实卡，接口预留）。
- 实时语音通话（TTS 语音条可作为可选增强）。

---

## 4. 核心体验

### 4.1 首次启动

1. 设置访问密码（单用户）。
2. 添加模型服务：Base URL、Key、模型名 →「测试连接」。
3. 创建角色：选模板 / 填人设 / 传头像；或导入角色卡 JSON。
4. 进入聊天，角色发来第一条招呼。

### 4.2 日常循环

```
早上：电脑/手机收到「早，今天降温了」→ 点开回复
白天：工作间隙看到动态红点 → TA 发了张咖啡照片
晚上：打开「一起听」→ 选一张歌单 → TA 在副歌时冒出一句吐槽
深夜：TA 按人设判断不该打扰 → 安静（可配置）
```

### 4.3 四个核心场景的用户故事

| 场景 | 用户故事 | 关键体验 |
|---|---|---|
| AI 聊天 | 我和角色像微信一样聊天，TA 记得我的设定和最近发生的事 | 流式、逐条气泡、引用回复、重说、编辑 |
| 主动消息 | 我没找 TA，TA 也会在合适的时间发来一条自然的消息 | 不机械、不重复、可调频率、可静音 |
| 主动动态 | TA 有自己的生活，会发动态，我点赞评论后 TA 会回 | 动态流、图片、延迟回复、角色间互动 |
| 一起听歌 | 我和 TA 同时听一首歌，TA 会聊这首歌 | 同步歌词、AI 短评、点歌、会话存档 |

---

## 5. 功能规格

### 5.1 AI 聊天

- 私聊 + 群聊（2–6 个角色）。
- 流式输出，逐条气泡；支持一次回复拆成 1–3 条短消息（更有微信感）。
- 消息操作：复制、编辑、删除、重新生成、多选删除、引用回复。
- 消息类型：文字、Markdown（安全渲染）、表情包、图片、语音条（TTS 可选）、系统事件（转账/礼物/时间跳跃，v1.5）。
- 输入区：多行、Enter 发送/Shift+Enter 换行（可切换）、表情面板、图片上传、@角色（群聊）。
- 会话状态：未读、置顶、免打扰、草稿、滚动位置。
- 失败处理：超时重试、断流保留已生成内容、错误可读提示。

### 5.2 角色、世界书与记忆

**角色卡字段**：姓名、备注/昵称、头像、人设、生活设定（职业/作息/常去地点）、开场白、口癖/说话风格、主题色、气泡样式、绑定世界书、记忆上限、主动策略、状态（心情/当前活动）。

**世界书**：多本、多条；每条可设「前/后」注入位置、启用开关、排序、关键词触发（v1.5）。

**记忆三层**：

1. **短期**：最近 N 条消息（按 token 预算裁剪）。
2. **中期**：滚动摘要（每 ~20 条或 ~3k token 更新一次，便宜模型）。
3. **长期**：关键事实卡（称呼、喜好、重要事件、关系进展），带重要度与来源消息。

设置页提供「记忆查看/编辑/删除」，避免黑箱。

### 5.3 AI 主动发消息

这是本项目最需要“克制”的功能，核心不是能不能发，而是**像人一样在合适的时候发**。

**每个角色独立策略**：

```json
{
  "enabled": true,
  "level": "normal",            // low | normal | high
  "minGapMinutes": 180,         // 两条主动消息最小间隔
  "maxGapMinutes": 480,         // 超过则重新排期
  "dailyCap": 3,
  "quietHours": ["23:30", "08:00"],
  "followUpAfterHours": 6,      // 用户沉默多久后允许“跟进”
  "allowMoments": true,
  "momentsPerDay": 2,
  "replyToMyMoment": true
}
```

**调度流程**（DB 任务队列，进程内 worker，重启可恢复）：

```
每分钟 tick：
  1. 取得到期的“日程联系点”（没有日程时走兜底主动点）
  2. 硬规则过滤：免打扰 / 静音 / 日上限 / 距上条太近 / 用户正在输入
  3. 计算通过概率：日程意图强度 + 空闲时长 + 时段 + 最近动态/音乐 + 随机抖动
  4. 不通过 → 标记跳过或重排，不调模型（省钱）
  5. 通过 → 用“日程意图 + 最新摘要 + 角色状态”生成 1 条
  6. 校验：空/<skip>/与最近 5 条主动消息过于相似 → 丢弃，不重试
  7. 落库、未读数 +1、推送；模拟“正在输入”1–3 秒后出现
```

**主动性类型轮换**（避免每天都是“在吗”）：

- 时段问候（早/午/晚，结合天气可选）
- 接着上次话题的跟进（“你昨天说的面试怎么样了”）
- 分享此刻（“刚路过一家店，想起你说喜欢…”）
- 对动态/音乐的回应
- 角色自己的小情绪/小事件（由当日日程驱动）
- 久未联系的试探（低频、看人设）

**防骚扰机制**：

- 全局与单角色两级开关；夜间免打扰。
- 收到用户回复后进入冷却；用户说“别烦我/安静点”自动暂停 2 小时。
- 每条主动消息可“减少这类” → 降频；连续误报自动降级。
- 测试模式：把间隔调到 1 分钟验收，正式使用恢复默认。

#### 5.3.1 日程驱动的主动引擎（比纯随机更自然）

纯随机定时会机械，固定模板又会重复。更好的做法是：**每天生成一份“生活日程”，主动消息从日程里的“联系点”自然发生**。

**一天的结构**：

- 不是精确到分钟的任务清单，而是 6–10 个“生活节拍”（beats）：起床、通勤、上午、午休、下午、下班、晚上、睡前。
- 每个节拍包含：时间段、活动、地点、心情/精力、是否方便联系、可聊的话题种子。
- 只有标记 `contact_worthy` 的节拍才可能发消息；每天 1–4 个，且受日上限、最小间隔、免打扰约束。

**生成时机**：

- 每天 22:00 左右生成“明天”的日程（多角色错峰），首日启动时补生成当天。
- 输入：人设/生活设定、昨天日程与实际聊天、长期生活线、星期/天气（可选）。
- 输出 JSON，服务端校验：时间单调、活动在清醒时段、联系点数量/间隔、与最近内容重复度。
- 生成失败重试一次；仍失败使用保守模板（如“上班/吃饭/休息”+ 1 个联系点），不阻塞当天。

**到点之后**：

- 不直接发送预写台词，而是用“日程意图 + 最新聊天摘要 + 当前状态”再生成一次；模型可以输出 `<skip>`。
- 发送前再过一遍硬规则（免打扰、日上限、最小间隔、用户刚回复/正在输入、重复度），并加 0–15 分钟抖动。
- 同一个节拍最多发 1 条；用户已经主动聊过，则降低后续联系点概率。
- 消息要像“顺手发的”，不要汇报日程；除非人设就是爱汇报。

**聊天时也注入日程**：

- 系统提示中加入“现在正在做什么、接下来什么安排、今天心情”，让“在开会，晚点说”这类回复自然。
- 但明确禁止主动念日程或解释“我刚从日程里看到”，避免出戏。

**连续性**：

- `life_arcs` 记录跨天事件（考试周、项目上线、感冒、和朋友闹别扭），每天日程要引用并推进。
- 参考昨天实际发生了什么，避免每天重复“去咖啡店”。
- 80% 普通日 + 20% 小变化；不允许日程自行制造重大变故（除非用户参与）。

**可控与可观测**：

- 默认隐藏原始日程以保持沉浸；设置里可选“TA 的今天”查看（更像手账摘要，不暴露 prompt）。
- 支持“跳过今天 / 重新生成 / 今天别发消息”。
- 每次生成、跳过、发送失败都有日志，便于调参。

示例（内部存储，不直接展示给用户）：

```json
{
  "date": "2026-11-19",
  "day_type": "workday",
  "mood": "有点累但还算顺",
  "beats": [
    {
      "start": "09:30", "end": "11:30",
      "activity": "改方案", "location": "公司",
      "energy": "low",
      "contact": {
        "worthy": true,
        "intent": "甲方又改需求，想吐槽",
        "tone": "无奈但嘴硬"
      }
    }
  ]
}
```

### 5.4 AI 主动发动态（朋友圈）

- 动态流：封面头图、角色头像、文字、1–4 张图、时间、点赞/评论。
- 角色按策略每天发 0–2 条；时间随机分布在角色活跃时段。
- 内容来源：当日日程/生活线 + 最近聊天 + 人设；可生成配图（接图像 API，可选），否则用角色相册/预设图。
- 互动：
  - 我点赞 → 角色可能回赞/回复（概率）。
  - 我评论 → 角色 1–5 分钟后以人设口吻回复（带“正在输入”）。
  - 我发动态 → 1–2 个角色点赞/评论（概率+关系权重）。
  - 角色之间互相点赞/评论（v1.5，增强“他们有自己生活”的感觉）。
- 动态与聊天打通：动态下的对话可一键“转到聊天继续”。

### 5.5 一起听歌（网易云优先）

**定位**：不是真的和远端的人同步，而是“TA 陪在旁边听”，重点在**共处感 + 对话**。

**音乐来源（按优先级）**：

1. **网易云音乐（主）**：本机跑一个 `NeteaseCloudMusicApi` 边车，提供搜索、歌曲 URL、歌词、歌单、每日推荐；支持扫码登录 / 粘贴 `MUSIC_U` Cookie 解锁 VIP 曲目。
2. **本地文件（兜底）**：上传 mp3/flac/m4a/wav，自动读元数据/封面/歌词；网易云不可用或歌曲下架时仍能听。
3. 两者在同一曲库/队列中混排，来源以角标标识。

**网易云接入要点**：

- 服务端代理音频流（带 Range、Referer、UA），避免 CORS、混合内容与 Cookie 泄露；音频不长期落盘。
- 歌词走 LRC 接口；搜索/歌单/推荐结果缓存 10–30 分钟，减少请求。
- 登录：二维码登录（推荐）或手动 Cookie；Cookie 加密存储，只存本机。
- 不可播放（VIP/下架/版权）时明确提示，并提供“换一首 / 用本地文件”。
- 边车不可用时，音乐页降级为本地曲库，不阻塞聊天与其他功能。
- 仅个人自用；不提供下载/再分发。网易云账号建议用小号，注意风控/封禁风险。

**播放器**：

- 迷你播放条（全局常驻，切页不断）。
- 全屏「一起听」房间：模糊专辑封面背景、旋转唱片、同步歌词、队列、播放模式。
- 搜索、歌单导入（粘贴链接/ID）、每日推荐、我的收藏。
- 进度/音量/上一首/下一首/随机/循环；刷新后恢复会话与进度。
- 多标签页通过 WebSocket 同步状态（同一浏览器多开）。
- 网络卡顿时预加载下一首 URL，减少等待。

**AI 陪伴**：

- 歌曲开始：根据歌名/歌手/歌词片段/当前心情，生成 1 句短评（≤40 字，像微信消息）。
- 副歌/关键歌词时间点：概率触发第二句。
- 切歌时：可以评价上一首、期待下一首。
- 频率上限：每首 ≤4 条、每 90 秒 ≤1 条，可一键关闭“AI 解说”。
- 「让 TA 选歌」：从曲库/网易云推荐里按标签、情绪、历史偏好挑下一首，并说明理由。
- 听歌对话进入独立会话（或与主聊天合并，可配置），并写入记忆（“那晚一起听了…”）。
- 不在播放时 AI 不会凭空评论音乐，避免“假装在听”。

### 5.6 设置与数据

- 模型服务：多套配置、启停、测试、模型列表拉取、按任务路由（聊天/后台/摘要/图像/TTS）。
- 外观：浅色/深色/跟随系统、主题色、聊天气泡、背景、字体大小。
- 通知：应用内红点、浏览器 Web Push、Telegram / ntfy（可选）。
- 数据：JSON + 媒体打包导出、导入、每日自动备份、一键清空（二次确认）。
- 关于：版本、用量统计（token/估算费用）、日志查看。

---

## 6. 技术架构

### 6.1 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS v4 | 生态成熟、开发快、移动端友好 |
| 状态 | Zustand + TanStack Query | 轻量，避免 Redux 样板 |
| 路由 | React Router | 简单直接 |
| 动效 | Motion（framer-motion） | 气泡/页面过渡 |
| 后端 | Node.js 24 + Fastify + TypeScript | 单进程、低内存、SSE/WS 方便 |
| 数据库 | SQLite（`node:sqlite`，封装可替换） | 零原生依赖、单文件、易备份 |
| 任务 | 自建 DB 队列 + 进程内 worker | 重启不丢、无需 Redis |
| 实时 | SSE（聊天/全局事件）+ WebSocket（音乐同步） | 简单可靠 |
| 校验 | Zod（前后端共享 schema） | 类型与运行时一致 |
| 测试 | Vitest + 少量 Playwright | 重逻辑单测，关键路径 E2E |
| 音乐边车 | `NeteaseCloudMusicApi`（本机 127.0.0.1:3000，固定版本） | 网易云搜索/播放/歌词；可开关，失败降级本地曲库 |
| 部署 | 本机 Windows 服务（任务计划/NSSM），可选 Docker | 单机自用，无需公网；开机自启 |

> 说明：当前机器无 pnpm、无 ffmpeg；`node:sqlite` 已验证可用。音频时长/封面用 `music-metadata` 读取，不依赖 ffmpeg；后续如要转码再引入。网易云边车以独立 Node 进程运行，由启动脚本拉起，不把它的依赖混进主服务。

### 6.2 架构图

```
┌──────────────────────────────┐
│  PWA (React)                 │
│  消息 / 动态 / 一起听 / 设置  │
└──────────┬───────────────────┘
           │ HTTP(S) · SSE · WebSocket
┌──────────▼───────────────────┐
│  Fastify API (单进程)         │
│  ├─ Auth / Settings          │
│  ├─ Chat Service             │
│  ├─ Character / Memory       │
│  ├─ Proactive Engine         │
│  ├─ Moments Engine           │
│  ├─ Music Service ───────────┼──> NeteaseCloudMusicApi（本机边车）
│  │                           └──> 本地曲库 ./data/uploads
│  ├─ LLM Adapter ─────────────┼──> OpenAI 兼容 / Gemini / 自定义
│  ├─ Job Worker (定时/重试)    │
│  └─ Push (Web Push)          │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  SQLite + ./data/uploads     │
│  （每日备份 → ./data/backups）│
└──────────────────────────────┘
```

### 6.3 进程与实时

- 主服务是一个 Node 进程，同时提供 API、静态前端、SSE、WS；音乐边车（网易云）是唯一的额外进程。
- 开发时 Vite 代理 `/api` 到 8787，保持 Cookie 同源，避免 CORS。
- 任务 worker 单实例运行；启动时获取进程锁，避免多开导致重复主动消息。
- 聊天：`POST /api/chats/:id/messages` 返回 `text/event-stream`，服务端边转发模型边落库；客户端断开 → `AbortController` 取消上游。
- 全局事件：`GET /api/events` SSE，推送新主动消息、新动态、任务状态、用量。
- 音乐：`/api/ws` 广播播放状态（play/pause/seek/track），同一账号多端同步。

### 6.4 目录结构

```
inkmate/
├─ apps/
│  ├─ web/                 # React PWA
│  │  ├─ src/pages/        # Chats, ChatRoom, Moments, Music, Settings
│  │  ├─ src/components/   # Bubble, Composer, Player, Avatar...
│  │  ├─ src/stores/       # zustand
│  │  └─ src/lib/          # api, sse, ws, markdown
│  └─ server/
│     ├─ src/routes/       # auth, chats, characters, providers...
│     ├─ src/services/     # chat, proactive, moments, music
│     ├─ src/llm/          # provider adapters, prompt builder
│     ├─ src/jobs/         # queue + worker
│     ├─ src/db/           # schema, migrations, repositories
│     └─ src/push/
├─ packages/shared/        # types, zod schemas, prompt templates, lrc parser
├─ data/                   # sqlite / uploads / backups（gitignore）
├─ docker-compose.yml
├─ PLAN.md
└─ README.md
```

---

## 7. 数据模型（核心表）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | id, password_hash, display_name, avatar, persona | 单用户也保留表 |
| `providers` | id, name, kind(openai/gemini/custom), base_url, api_key_enc, extra_json | Key 加密存储；kind 决定适配器 |
| `model_routes` | task, provider_id, model, params_json, fallback_json | chat/background/summary/image/tts |
| `characters` | id, name, nickname, avatar, persona, greeting, color, bubble_style, memory_limit, initiative_json, state_json | 角色卡 + 主动策略 + 生活状态 |
| `chats` | id, kind(private/group), title, avatar, settings_json, last_message_at, unread_count, pinned | 会话 |
| `chat_members` | chat_id, character_id, nickname, persona_override | 群成员独立人设 |
| `messages` | id, chat_id, role, sender_id, kind, content, meta_json, created_at, edited_at, deleted_at, client_id | 消息 |
| `summaries` | id, chat_id, upto_message_id, content, token_count | 滚动摘要 |
| `facts` | id, character_id, chat_id, content, importance, source_message_id | 长期事实 |
| `world_books` / `world_book_entries` | id, name, title, content, position, enabled, sort | 世界书 |
| `moments` | id, character_id, content, images_json, mood, scheduled_at, created_at, status | 动态 |
| `moment_interactions` | id, moment_id, actor_type, actor_id, kind, content, created_at | 赞/评论 |
| `tracks` | id, title, artist, album, duration_ms, path, cover_path, lyrics, source, source_id, meta_json | 曲库（local / netease） |
| `day_plans` | id, character_id, date, day_type, mood, summary, status, raw_json, created_at | 每日日程 |
| `day_beats` | id, plan_id, start_at, end_at, activity, location, energy, contact_worthy, contact_intent, tone, status, message_id | 生活节拍 / 联系点 |
| `life_arcs` | id, character_id, title, status, started_at, notes | 跨天生活线 |
| `play_sessions` | id, title, started_at, ended_at, state_json | 一起听会话 |
| `play_events` | id, session_id, track_id, position_ms, character_id, kind, content | AI 评论/事件 |
| `jobs` | id, kind, run_at, status, payload_json, attempts, last_error | 持久化队列 |
| `usage_logs` | id, task, provider_id, model, prompt_tokens, completion_tokens, cost, created_at | 用量 |
| `settings` | key, value_json | 全局设置 |

索引：`messages(chat_id, created_at)`、`jobs(status, run_at)`、`moments(created_at)`、`facts(character_id)`、`day_plans(character_id, date)`、`day_beats(plan_id, start_at)`。

---

## 8. AI 编排

### 8.1 提示词结构（私聊）

```
[系统规则] 角色扮演、纯线上、输出格式（1–3 条短消息，不写旁白除非用括号）
[世界书·前]
[角色人设] 姓名/性格/说话风格/关系/口癖
[我的人设]
[长期记忆] 摘要 + 事实卡（按重要度/相关度）
[世界书·后]
[当前上下文] 时间、星期、今天日程（当前节拍/下一节拍/心情）、最近动态/音乐
[对话历史] 最近 N 条（按 token 预算裁剪，带相对时间）
[本轮要求] 回复长度、是否允许动作/表情、禁止事项
```

### 8.2 上下文预算

以 8k 上下文为例（可配置）：

| 部分 | 预算 |
|---|---|
| 系统规则 + 人设 | ~1.5k |
| 世界书 | 0–2k |
| 记忆摘要/事实 | ~0.8k |
| 历史消息 | ~3k |
| 输出预留 | ~0.8k |

超预算时：先裁最旧历史 → 合并连续消息 → 降低世界书条数；摘要异步更新。

### 8.3 结构化任务

主动消息、动态、记忆抽取、群聊选人使用 JSON 输出（`response_format` 或提示词约束），并做容错解析：

```json
// 主动消息
{ "should_send": true, "reason": "晚上且三天没聊", "messages": ["今天路过那家店了"], "delay_seconds": 2 }
// 动态
{ "content": "…", "mood": "平静", "image_prompt": null }
// 记忆抽取
{ "summary": "…", "facts": [{ "content": "用户下周三面试", "importance": 4 }] }
```

解析失败 → 重试一次（温度更低）→ 仍失败则跳过该次任务，不阻塞队列。

### 8.4 模型路由

| 任务 | 默认 | 要求 |
|---|---|---|
| 聊天 | 用户指定主模型 | 流式、长上下文 |
| 主动消息/动态/记忆 | 便宜快模型 | JSON、低成本 |
| 标题/摘要 | 便宜快模型 | 短输出 |
| 图片 | 可选图像模型 | 失败则用预设图 |
| TTS | 可选 | 失败则纯文字 |

支持 fallback 链（主模型失败 → 备用模型），记录耗时与 token。

### 8.5 Provider 适配

统一接口，按 `kind` 选择适配器：

| kind | 适用 | 说明 |
|---|---|---|
| `openai` | DeepSeek、硅基流动、OpenRouter、Ollama、第三方中转 | `POST {base}/chat/completions`，SSE；支持自定义 headers、路径、额外参数 |
| `gemini` | Google Gemini 原生 | `streamGenerateContent`；system 转 `systemInstruction`；usage 字段映射 |
| `anthropic`（可选） | Claude | 需要时再加，不阻塞 v1 |

- 每个 Provider 可配多个模型；`model_routes` 按任务选 `provider + model`。
- 测试连接：优先 `GET /models`，不支持则发一条极短的测试消息。
- 统一错误码：鉴权失败 / 余额不足 / 限流 / 超时 / 内容拦截，前端分别提示。
- 流式解析兼容 `data: [DONE]`、空行、JSON 跨 chunk；Gemini 单独解析。
- 自定义 Provider：允许完整 Base URL、额外请求头、`response_format` 是否支持等开关。

### 8.6 成本控制

- 主动消息先本地规则过滤，命中才调模型。
- 摘要/动态批量生成，限制频率。
- 每日 token/费用上限，超限只保留聊天，暂停后台任务。
- 设置页展示今日/本月用量。

---

## 9. API 与安全

### 9.1 主要接口

```
POST   /api/auth/login | logout | GET /api/me
GET    /api/providers            POST /api/providers
POST   /api/providers/:id/test   GET  /api/providers/:id/models
GET    /api/chats                POST /api/chats
GET    /api/chats/:id/messages   POST /api/chats/:id/messages (SSE)
POST   /api/chats/:id/regenerate
GET    /api/characters           POST/PATCH/DELETE /api/characters/:id
GET    /api/world-books          POST/PATCH/DELETE
GET    /api/moments              POST /api/moments
POST   /api/moments/:id/like     POST /api/moments/:id/comments
GET    /api/tracks               POST /api/tracks (multipart)
GET    /api/tracks/:id/stream    GET  /api/tracks/:id/lyrics
GET    /api/music/search?q=      GET  /api/music/playlist/:id
GET    /api/music/stream/:id     (服务端代理，支持 Range)
GET    /api/sessions/:id         PATCH /api/sessions/:id
GET    /api/events (SSE)         /api/ws (WebSocket)
GET    /api/settings             PATCH /api/settings
POST   /api/backup/export        POST /api/backup/import
```

### 9.2 安全基线

- 单用户密码登录（Argon2id），HttpOnly + SameSite=Lax Cookie，服务端会话。
- 所有写操作校验 Origin；登录失败限速；可选 TOTP（v1.5）。
- API Key 用 `APP_SECRET` 派生密钥 AES-256-GCM 加密；接口只返回掩码。
- 上传限制类型/大小；文件名随机化；防路径穿越。
- Markdown 渲染走 DOMPurify；模型输出不当 HTML 直接插入。
- 世界书/用户输入视为**数据**，在提示词中明确边界，降低注入风险。
- 日志脱敏，不记录 Key 与完整私密对话（可配置）。
- 备份文件可加密（可选）。

---

## 10. UI / UX

### 10.1 信息架构

底部四个 Tab：**消息 · 动态 · 一起听 · 我的**

- 消息：会话列表（置顶/未读/最后一条/时间）→ 聊天页。
- 动态：朋友圈式时间线，顶部“我的封面”，角色发帖卡片。
- 一起听：当前会话 + 曲库 + 队列；有播放时底部全局迷你条。
- 我的：角色管理、世界书、模型服务、通知、外观、数据、用量。

### 10.2 视觉方向

- 微信的**熟悉感** + 更干净的留白与圆角；不是像素级复刻。
- 每个角色一个主题色，用于头像环、发送按钮、选中态。
- 深色模式优先适配（夜间聊天/听歌场景）。
- 气泡：圆角 18px，连续消息合并头像；时间分隔轻量。
- 移动端 100dvh、安全区适配；桌面端居中手机框或双栏（列表 + 聊天）。
- 关键动效：发送上浮、正在输入三点、动态点赞心跳、唱片旋转（低性能设备可关）。

### 10.3 关键状态

- 空状态：引导创建第一个角色（预置 3 个模板：温柔 / 毒舌 / 元气）。
- 加载：骨架屏，不要整页 spinner。
- 错误：网络/额度/Key 失效分别给可操作提示。
- 离线：显示“当前离线，消息将在恢复后发送”（v1 先禁用发送）。

---

## 11. 里程碑

> 按“可独立验收的批次”划分，不绑定日历；每批结束都能实际使用。

| 批次 | 内容 | 交付物 | 验收标准 |
|---|---|---|---|
| **M0 基建** | 仓库、npm workspaces、Fastify + Vite、SQLite schema/migration、登录、Provider CRUD（openai/gemini/自定义）+ 测试连接、应用外壳 | 能登录、能配模型、四 Tab 空壳 | `npm run dev` 一条命令起；重启数据不丢；Key 不出现在前端；两种 kind 都能测通 |
| **M1 聊天 MVP** | 角色 CRUD、私聊、流式回复、历史分页、未读、编辑/删除/重说、Markdown、表情/图片 | 可日常使用的聊天 | 流式不卡；刷新/重启记录在；中断可取消；100 条历史正常 |
| **M2 人设与记忆** | 世界书、摘要 + 事实卡、记忆查看、群聊（2–6 人，独立人设） | 有“记性”的角色 | 人设/世界书明显影响回复；20 条后触发摘要；群聊不串人设 |
| **M3 主动消息** | 每日日程生成/校验、日程注入、联系点调度、发送时二次生成、未读/推送、免打扰、测试模式 | 角色会先开口 | 测试模式 1 分钟内收到；日程时间合理且不重复；遵守上限/静默；重启后最多补 1 条、不刷屏；可一键静音 |
| **M4 动态** | 动态流、定时发帖、配图（可选）、点赞评论、角色回复、我发动态角色互动 | 朋友圈可用 | 每天按策略发帖；评论 5 分钟内回；刷新/重启数据在；频率可调 |
| **M5 一起听** | 网易云边车、搜索/歌单/歌词、音频代理、播放器、LRC、会话持久化、AI 短评、让 TA 选歌、本地兜底、迷你条 | 一起听房间 | 网易云搜索能播能看词；VIP/下架有提示；本地上传可混排；每首 ≤4 条评论；刷新恢复进度 |
| **M6 打磨发布** | PWA、Web Push、备份导入导出、主题、移动端细节、开机自启、README、测试 | 可长期自用 | 本机可安装 PWA；localhost 收到推送；备份可完整恢复；重启电脑后服务自动起 |

**建议开工顺序**：M0 + M1 一起做（先有能聊的），然后 M2（记忆/世界书）→ M3（主动）→ M4（动态）→ M5（音乐）→ M6。  
理由：记忆/世界书是主动消息和动态的质量地基，先搭好再让角色“主动”；音乐依赖外部边车，放在后面降低早期风险。

---

## 12. 测试与质量

- **单元**：提示词拼装快照、token 裁剪、主动策略门控（固定随机种子）、JSON 容错解析、LRC 解析、消息合并。
- **集成**：临时 SQLite + Mock LLM（SSE 流）跑聊天/主动/动态；任务队列重启恢复。
- **E2E（可选）**：登录 → 建角色 → 发消息 → 收到回复 → 开主动 → 收到主动消息。
- **手工清单**：每批验收前过一遍移动端（iPhone Safari / Android Chrome）和桌面。
- **质量门槛**：TypeScript strict、ESLint、`npm run check` 一键跑类型 + 单测；关键路径无 `any`。

---

## 13. 部署与运维

### 13.1 本机运行（主形态）

```powershell
npm install
npm run dev        # web 5173 + server 8787 + netease 3000
npm run build
npm start          # 单进程，浏览器打开 http://127.0.0.1:8787
```

- 开机自启：任务计划程序（登录时触发）或 NSSM 注册 Windows 服务；可静默运行。
- 默认只监听 `127.0.0.1`；需要手机/平板局域网访问时再改 `HOST=0.0.0.0`，务必设密码。
- 电脑休眠/关机期间不产生主动消息；下次启动只补 1 条，不刷屏。
- 音乐边车随主服务启动；未启动时自动降级本地曲库。
- 可选 Docker（迁移/备份场景），不是必需。

### 13.2 Web Push 与 HTTPS

- 桌面 Chrome/Edge 访问 `http://localhost` 属于安全上下文，可直接订阅 Web Push、安装 PWA。
- 手机通过局域网 IP 访问是 HTTP，不能推送，也不能安装 PWA；两条路：
  1. 本机 Caddy / mkcert 生成局域网 HTTPS 证书，手机安装根证书后访问 `https://ink.local`；
  2. 后续加 ntfy / Telegram 作为手机通知兜底（v1.5，可随时加）。
- 电脑关机/睡眠时不会有推送；应用内未读仍是主渠道。

### 13.3 数据与备份

- 数据目录：`./data`（SQLite、上传、封面、备份），可用 `DATA_DIR` 改到其他盘。
- 每日自动备份：SQLite `.backup` + 媒体清单，保留 7 天；支持导出 zip。
- 建议把 `data/backups` 同步到网盘或移动硬盘。
- 网易云 Cookie 加密后存库；退出登录即清除。

### 13.4 环境变量

```
PORT=8787
HOST=127.0.0.1
DATA_DIR=./data
APP_SECRET=<32+ bytes random>
ADMIN_PASSWORD=<initial>
TZ=Asia/Shanghai
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
NETEASE_API_URL=http://127.0.0.1:3000
NETEASE_COOKIE=<encrypted at rest>
```

### 13.5 Termux 常驻（可选，Android）

不想让电脑常开时，可以把同一套 Node 服务搬到 Android 的 Termux，代码不分叉：

- F-Droid 安装 Termux + Termux:Boot；`pkg install nodejs git`。
- 用 `node:sqlite` 避免原生编译；网易云边车也可在本机跑。
- `termux-wake-lock` + 关闭电池优化 + Termux:Boot 自启；建议旧手机插电专用。
- 同一 Wi-Fi 访问 `http://手机IP:8787`；外网用 Tailscale / Cloudflare Tunnel 提供 HTTPS。
- 通知优先 ntfy（无 GMS 机型更稳），Web Push 作备选。
- 限制：Android 可能杀进程、重启需自启、耗电发热、没有 iOS；不是 100% SLA。
- 这与“纯手机 PWA + 本地通知 + 预生成消息”不是一回事：Termux 是真正常驻的 Node，能到点现场调 AI；纯 PWA 只能提前写好消息再定时弹。

---

## 14. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 主动消息像骚扰 | 用户反感、关掉功能 | 严格上限 + 静默时段 + 冷却 + 反馈降频；默认“正常”偏保守 |
| 日程失真/重复 | 角色像模板 | 服务端约束 + 昨天上下文 + 普通日偏置 + 手动重生成 |
| 预写台词过时 | 回复不贴当下 | 日程只存意图，发送时结合最新摘要再生成，允许 `<skip>` |
| 角色 OOC / 重复 | 沉浸感崩 | 人设卡 + 最近消息去重 + 温度/频率参数 + 重说 |
| API 不稳定/限流 | 聊天失败 | 超时、重试、fallback 模型、错误提示；流式断流保留内容 |
| 成本失控 | 账单 | 后台任务用便宜模型；本地门控；日限额；用量面板 |
| 音乐版权/接口失效 | 一起听不可用 | 网易云边车固定版本 + 本地曲库兜底；Cookie 失效提示重登；不阻塞聊天 |
| 本机休眠/关机 | 主动消息停摆 | 启动只补 1 条；应用内未读为主；后续可选 ntfy/Telegram |
| Termux 被系统杀 | 主动消息停摆 | 唤醒锁 + 关电池优化 + Boot 自启；旧机专用；关键场景仍建议 VPS |
| 手机推送不可靠 | 错过主动消息 | 应用内未读为主，Web Push 为辅；局域网 HTTPS 或后续 ntfy |
| 数据丢失 | 设定/回忆丢失 | SQLite WAL + 每日备份 + 导出；导入校验 |
| 单进程故障 | 全站不可用 | 自用可接受；Windows 服务自动重启；健康检查 |
| 提示词注入 | 角色被“越狱” | 用户内容隔离标记、系统规则优先级、输出过滤 |

---

## 15. 已确认的决策

| 项 | 结论 | 对方案的影响 |
|---|---|---|
| 部署 | **Windows 本机为主** | 单机 Windows 服务；不做公网暴露；Web Push 以桌面为主，手机需局域网 HTTPS 或 ntfy。**备选**：Termux（Android）常驻，可脱离电脑，但可靠性低于 VPS |
| 音乐 | **网易云优先** | 引入 `NeteaseCloudMusicApi` 边车 + 音频代理 + Cookie；本地文件兜底；版权风险隔离在音乐模块 |
| 模型 | **DeepSeek / Gemini / 第三方自定义** | 多 Provider：`openai` + `gemini` 适配器，自定义 Base URL/headers；按任务路由 |
| 通知 | **应用内 + Web Push** | VAPID + Service Worker；未读为一级入口，推送为增强 |

仍按默认执行的小项（如有异议可改）：

- UI：微信式信息架构，但视觉更干净，不逐像素复刻。
- 单用户、中文界面、手机优先 PWA。
- v1 不做多用户、不做原生 App、不做实时语音通话。
- 角色卡先自定义，v1.5 再做 SillyTavern 角色卡导入。

---

## 16. 确认后第一步（M0）

1. 初始化 `inkmate/` monorepo 与共享类型。
2. 建 SQLite schema（users/providers/characters/chats/messages）。
3. Fastify：登录、Provider CRUD（openai/gemini/custom）、测试连接、静态托管。
4. React：登录页 + 四 Tab 外壳 + 设置页 Provider 表单。
5. 一条命令启动，写入 README。

验收：能登录、能保存并测试真实 API（至少 OpenAI 兼容 + Gemini 各一条）、刷新后配置仍在、Key 只存在服务端。

---

## 附：参考链接

- 参考应用：<https://chengyeliiii.github.io/Octopus/>
- 参考源码：<https://github.com/chengyeliiii/Octopus>
- OpenAI Chat Completions：<https://platform.openai.com/docs/api-reference/chat>
- Web Push / VAPID：<https://web.dev/articles/push-notifications-overview>
