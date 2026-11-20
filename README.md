# 墨伴 InkMate

只给自己用的 AI 陪伴聊天 App。微信式界面，接自己的 API：角色会聊天、会主动找你、会发动态、会陪你听歌。

当前进度：**M0–M6 全部完成**。聊天、主动消息、动态、一起听、PWA/Web Push/备份与 Windows 自启均已接入，并通过构建、类型检查与核心验收。

完整计划见 [PLAN.md](PLAN.md)。

## 环境

- Node.js **22.5+**（需要内置 `node:sqlite`；本项目在 Node 24 上开发）
- npm 10+
- Windows / macOS / Linux 均可；Android Termux 也可作为可选部署目标

## 启动

```bash
npm install
npm run dev
```

国内网络如果 npm 拉包慢，可以加镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

- Web：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:8787>
- 首次启动会自动创建账号 `me`，默认密码 **`inkmate`**（可用 `ADMIN_PASSWORD` 覆盖）。
  默认密码只用于本地开发，请尽快改成自己的；修改 `ADMIN_PASSWORD` 只影响首次建号，不会改已存在的密码。

生产构建：

```bash
npm run build
npm start
```

然后打开 <http://127.0.0.1:8787>（由 Fastify 托管 `apps/web/dist`）。

Windows 开机/登录自启（可选，PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

会注册一个登录时启动的计划任务，日志写到 `data/inkmate.log`。取消：

```powershell
Unregister-ScheduledTask -TaskName InkMate -Confirm:$false
```

### Android / Termux（可选，让手机常驻）

不想让电脑常开时，可以把同一套 Node 服务搬到 Android 的 Termux，代码不分叉。App 请从
[F-Droid](https://f-droid.org/packages/com.termux/) 安装（Play 版已弃用）。

首次安装：

```bash
pkg update -y && pkg install -y nodejs git
pkg install -y termux-api                 # 自动开浏览器要它 + F-Droid 的 Termux:API 应用
node -v                                   # 需 ≥ 22.5，才有内置 node:sqlite
git clone https://github.com/646486604/inkmate.git ~/inkmate
cd ~/inkmate && npm install && npm run build
bash scripts/termux-start.sh              # 后台起服务 + 等就绪 + 直接打开浏览器
```

> 想让它**自动拉起浏览器**，需要两样东西同时存在：
> 1. Termux 里的包 `pkg install termux-api`
> 2. F-Droid 上的 [Termux:API](https://f-droid.org/packages/com.termux.api/) 应用（装完打开一次并给权限）
>
> 缺任何一个，启动器会打印失败原因和修复命令，服务本身照样跑，手动打开
> `http://127.0.0.1:8787` 即可。随时可以用 `bash scripts/termux-start.sh doctor` 自检。

`scripts/termux-start.sh` 会先确保网易云边车在跑（默认 `127.0.0.1:3000`；第一次会自动安装，约 1–3 分钟），
再后台拉起 `apps/server/dist/index.js`，轮询 `/api/health` 就绪后用 `termux-open-url` 打开
`http://127.0.0.1:8787`。所以之后只要打开墨伴，就能直接搜歌/听歌，不用单独启动边车。

边车依赖装在 `tools/netease-api`（固定 `NeteaseCloudMusicApi@4.34.1`，独立 `node_modules`）。不想用网易云、
只用本地曲库时，启动前设 `INKMATE_NO_NETEASE=1`；边车日志在 `~/inkmate-netease.log`。
边车默认匿名：只能播免费/未下架曲目。在「一起听 → 网易云 → 填 Cookie」里粘贴 `MUSIC_U` 后，
VIP 曲目和每日推荐就能用；Cookie 加密保存在手机本地，不需要每次重填。

> 这里的「打开墨伴」指运行 `termux-start.sh`（或给它建的主屏快捷方式），不是只点 PWA 图标——
> PWA 只是前端壳，后台的墨伴服务和边车还是得由 Termux 拉起来。

以后每次：

| 命令 | 作用 |
|---|---|
| `bash ~/inkmate/scripts/termux-start.sh` | 启动并打开浏览器 |
| `bash ~/inkmate/scripts/termux-start.sh restart` | 重启并打开浏览器 |
| `bash ~/inkmate/scripts/termux-start.sh stop` | 停止 |
| `bash ~/inkmate/scripts/termux-start.sh status` | 看墨伴和边车是否在跑 |
| `bash ~/inkmate/scripts/termux-start.sh doctor` | 自检：构建产物、服务、termux-api、Termux:API 是否齐 |
| `bash ~/inkmate/scripts/termux-start.sh open` | 只打开浏览器（服务已在跑时用） |
| `bash ~/inkmate/scripts/termux-start.sh log` | 跟踪墨伴 `~/inkmate.log`（Ctrl+C 只退出跟踪） |
| `bash ~/inkmate/scripts/termux-start.sh ncm-log` | 跟踪边车 `~/inkmate-netease.log` |
| `bash ~/inkmate/scripts/termux-start.sh install` | 只安装/补装边车依赖，不启动 |

更新到最新提交（`data/` 在 gitignore 里，聊天记录不受影响）：

```bash
cd ~/inkmate && git pull --ff-only && npm install && npm run build && bash scripts/termux-start.sh restart
```

开机自启（装 Termux:Boot 后，只起服务不弹浏览器）：

```bash
mkdir -p ~/.termux/boot && cat > ~/.termux/boot/inkmate.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
INKMATE_NO_OPEN=1 bash $HOME/inkmate/scripts/termux-start.sh start
EOF
chmod +x ~/.termux/boot/inkmate.sh
```

- 手机自己访问 `http://127.0.0.1:8787`；服务仍只监听 `127.0.0.1`，同一 Wi-Fi 的电脑要访问需
  起服务时加 `HOST=0.0.0.0`，并先改掉默认密码。
- Node 22 上 `node:sqlite` 可能需要 `--experimental-sqlite`，脚本会自动探测补上。
- 建议 `termux-wake-lock` + 关闭 Termux 的电池优化；Android 12+ 仍可能杀后台，旧手机插电专用最稳。
- 边车和墨伴一起启停：`stop` 会两个都停，`restart` 两个都重启；`start` 时如果 3000 端口已有边车会直接复用。
  Android 杀掉 Termux 后不会自动拉起，重新执行一次 `start` 即可。边车首次安装会占手机约几十 MB。
- 手机浏览器里「添加到主屏幕」即可当 PWA 用。

## M6 能做什么

- 单用户密码登录，会话 Cookie（HttpOnly / SameSite=Lax）
- 接入多个模型服务：
  - OpenAI 兼容（DeepSeek / 硅基流动 / OpenRouter / Ollama / 第三方中转）
  - Gemini 原生
  - 自定义 Base URL / 请求头（数据层已预留）
- 保存即接入，不发试探请求（不少第三方站把「测试」当异常流量，会封号）；能不能用，直接在聊天里发一句就知道
- 模型名可「拉取列表」：OpenAI 兼容打 `GET /v1/models`，Gemini 打 `GET /v1beta/models`，下拉选也能手填；角色「覆盖模型」复用同一接口
- API Key 使用 AES-256-GCM 加密后存 SQLite，接口只返回掩码
- 角色管理：姓名、昵称、人设、开场白、主题色、绑定模型、模型覆盖、记忆轮数
- 私聊：流式回复、SSE、历史分页、未读、Markdown、图片、表情
- 多气泡：一次回复按行拆成 3–7 条气泡显示，像真的在刷聊天
- 连发：每句话可以先「＋」攒起来，最后按发送键一次性发出去（对方只回一条）
- 角色主页：头像/人设/TA 发过的动态，从聊天页标题点进去
- 表情包：上传到服务端（`data/uploads`），可以给每张写描述（如「猫猫得意」），
  角色会在聊天里自己挑着发；也能一键手动发。多设备共用
- 聊天背景：每个会话可单独上传背景图
- 天气：设置里填城市，计划生成与聊天会带入真实天气（Open-Meteo，免 key）
- 我的设定：全局名字/人设；每个会话还能单独覆盖成“另一个身份”
- 头像支持直接上传图片；模型服务可一键停用
- 消息编辑 / 删除 / 重新生成；图片上传后走鉴权媒体路由
- 世界书：多本 / 多条、前/后注入、启用/排序、按角色关联
- 记忆：滚动摘要 + 事实卡，每 20 条自动整理；聊天菜单里可查看/编辑/删除/立即整理
- 群聊：2–6 个角色、独立人设、@/点名优先、按上一发言者轮转、群聊提示词
- 主动消息：每日日程（6–10 个生活节拍 + 1–4 个联系点）、到点二次生成、免打扰/日上限/最小间隔
- 主动消息测试模式、手动「现在发一条」、日程面板查看/重生成/跳过联系点
- 日程会注入聊天提示词，让角色“在忙/刚下课”的状态自然
- 应用内 SSE 推送主动消息，消息列表和当前聊天自动更新
- 动态：朋友圈式时间线；角色按日程/心情定时发动态，文字 + 可选配图
- 动态互动：点赞、评论、角色延迟回复；我发动态，角色来点赞/评论
- 动态支持多图、作者信息、相对时间、SSE 实时更新
- 一起听：网易云边车搜索、音频代理（支持 Range）、歌词、播放器、进度/音量/上一首/下一首
- 网易云歌单导入（ID/链接）、每日推荐、我的收藏
- 网易云账号 Cookie（MUSIC_U）：加密保存在本机，用于 VIP 曲目与每日推荐；不自动登录、不回传浏览器
- 播放模式：顺序 / 列表循环 / 单曲循环 / 随机
- 全局迷你播放条：切到消息/动态/我的也能继续听；聊天页顶部有紧凑播放条
- 多标签页通过 BroadcastChannel 同步播放/暂停/切歌/进度
- 外观：跟随系统 / 浅色 / 深色；小 / 标准 / 大字号；保存在本机浏览器
- 本地曲库：上传 MP3/M4A/FLAC/WAV/OGG/WebM、LRC 歌词、与网易云歌曲混排
- 会话持久化：队列、当前曲目、进度、播放状态；刷新后恢复
- AI 短评：播放开始/副歌时生成，每首最多 4 条，可手动让 TA 说一句
- 让 TA 从本地曲库选歌
- PWA：manifest、192/512 图标、Service Worker、离线壳、可安装
- Web Push：VAPID、订阅管理、主动消息/动态推送、测试通知
- 备份：完整 zip（SQLite + 图片 + 音乐 + app-secret + VAPID）导出/导入；每日数据库快照保留 7 天
- Windows 登录自启脚本
- 消息 / 动态 / 一起听 / 我的 四个页面外壳

## 目录

```
inkmate/
├─ apps/
│  ├─ server/          Fastify + node:sqlite + 鉴权 + Provider/聊天/上传
│  └─ web/             React + Vite + Tailwind + react-markdown
├─ packages/shared/    前后端共享类型与 zod schema
├─ data/               SQLite / 上传 / 备份（gitignore）
├─ PLAN.md
└─ package.json        npm workspaces
```

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 起后端 + 前端（Vite 代理 `/api` 到 8787） |
| `npm run build` | 构建 shared → web → server |
| `npm start` | 运行生产构建 |
| `npm run typecheck` | 构建 shared 后跑三端 TS 检查 |
| `npm run check` | 同 typecheck |
| `npm test` | 构建 shared 后跑 Node 内置 schema 测试 |
| `bash scripts/termux-start.sh` | Termux（Android）上后台启动并打开浏览器，见上文 |

## 数据与配置

- 数据目录默认 `./data`，可用 `DATA_DIR` 覆盖。
- 聊天图片存 `data/uploads`，通过带登录态的 `/media/<随机名>` 访问。
- 本地音乐存 `data/music`，通过带登录态的 `/api/music/tracks/:id/stream` 播放。
- `data/.app-secret` 在首次启动时自动生成，用于加密 Provider Key；不要丢，丢了要重新保存 Key。
- 关键环境变量：

```
PORT=8787
HOST=127.0.0.1
DATA_DIR=./data
ADMIN_PASSWORD=inkmate
APP_SECRET=<32+ 字节随机串，可选>
COOKIE_SECURE=true   # 只有上 HTTPS 时才开
TZ=Asia/Shanghai
NETEASE_API_URL=http://127.0.0.1:3000
NETEASE_COOKIE=     # 可选：MUSIC_U=...; __csrf=...，也可在「一起听」界面里填
```

网易云需要本机边车（[NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)），默认地址 `127.0.0.1:3000`。没启动也能用本地曲库。

### 网易云账号（VIP / 每日推荐）

打开「一起听」→「网易云」→「填 Cookie」，把浏览器里 `music.163.com` 的整条 Cookie 粘进去，
点「保存并验证」。验证通过后：

- VIP / 付费曲目会走 `song/url/v1` 返回可播地址；
- 每日推荐会变成你自己账号的推荐；
- Cookie 存在 SQLite 的 `settings` 表里，用 `data/.app-secret` 加密，接口只返回昵称/VIP 状态，不回传 Cookie。

取 Cookie：浏览器登录 `music.163.com` → 开发者工具 → Network → 随便点一个发往 `music.163.com` 的请求
→ 请求头里的 `Cookie:` 整条复制。至少要有 `MUSIC_U=...`；只存 `MUSIC_U` 通常也能听歌，但推荐/写操作可能需要完整 Cookie。

无 UI 的部署也可以用环境变量 `NETEASE_COOKIE="MUSIC_U=...; __csrf=..."`；数据目录里保存的 Cookie 优先。
Cookie 失效时播放会提示重新粘贴；不会自动清空，也不会自动重新登录。

## 已知边界

- AI 动态目前只生成文字；配图接口是可选扩展，用户自己发的动态可以带图。
- 动态自动发帖只在服务进程运行时工作；每天条数由角色的「允许发动态 / 每天几条」控制。
- 目前没有角色之间的互相点赞/评论，只有角色对用户动态的互动。
- 一起听的多标签同步基于 BroadcastChannel，只覆盖同一浏览器；跨设备不实时同步。
- 网易云依赖本机边车；未登录时 VIP/下架曲目无法播放、每日推荐可能为空。已支持粘贴 `MUSIC_U` Cookie（加密保存），扫码登录还没做。
- AI 短评暂不写入聊天记忆；每首上限 4 条。
- 主动消息只在服务进程运行时工作；电脑关机/休眠时不会发。
- Web Push 已接入，但手机通过局域网 IP 走 HTTP 时不能订阅；需要 localhost 或 HTTPS。
- 每日自动备份只保留 SQLite 快照；完整媒体备份用「导出备份」zip。导入后需重启服务，让 app-secret / VAPID 生效。
- 主题/字号已支持；聊天背景和字体族还没有单独设置。
- 自动化测试目前覆盖 shared schema；聊天/主动/音乐仍是手工集成验收。
- 日程由模型生成，解析失败会用保守兜底日程；测试模式会忽略免打扰和冷却。
- M2 群聊是“每条用户消息由一个角色接话”，还不是多人同时抢话；群聊记忆暂未支持。
- 部分中转站没有 `/models` 接口，或返回的列表不含对话模型；「拉取列表」失败时直接手填模型名即可，不影响聊天。
- 默认只监听 `127.0.0.1`；需要局域网访问时改 `HOST=0.0.0.0` 并设置强密码。
- 调用模型（聊天/记忆整理/日程生成/动态生成/音乐短评）会真实产生 token 费用；接入时不再自动发测试请求。
- 图片存 `data/uploads`，只支持常见位图格式；单张上限 10MB。
- 修改密码尚未做 UI；后续补。
- 角色删除会连带删除其会话、消息、记忆、日程、动态与音乐评论。

## 验收状态

| 里程碑 | 状态 | 验收要点 |
|---|---|---|
| M0 登录 | 完成 | 单用户密码登录、HttpOnly Cookie、未登录拦截 |
| M1 Provider/聊天 | 完成 | 多 Provider、Key 加密、SSE 流式、历史、编辑/删除/重生成 |
| M2 人设/记忆/群聊 | 完成 | 世界书前后注入、摘要+事实、群聊轮转/点名 |
| M3 主动消息 | 完成 | 日程生成/注入、到点二次生成、免打扰/上限/测试模式 |
| M4 动态 | 完成 | 时间线、定时发帖、点赞评论、角色延迟回应、SSE |
| M5 一起听 | 完成 | 网易云搜索/代理/歌词、本地混排、会话恢复、AI 短评、全局迷你条、歌单/推荐/收藏/播放模式 |
| M6 发布 | 完成 | PWA 安装性检查通过、Web Push 实测、完整备份导入恢复、Windows 自启脚本、主题/字号 |
| 自动化测试 | 通过 | `npm test` 4 项 schema 测试 |

## 下一步

M6 收尾：移动端细节、更多聊天/主动/音乐集成测试。
