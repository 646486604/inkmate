// 墨伴「一起听」网易云边车的启动入口（Termux / 桌面通用）。
// 与 NeteaseCloudMusicApi 自带的 app.js 相比，这里刻意少做三件事：
//   1. 不跑 `npm info` 版本检查（app.js 会 spawn npm，手机上启动更慢）；
//   2. 匿名 token 只在缺失或超过 7 天时刷新，避免每次启动都注册一次；
//   3. 只监听 127.0.0.1，不因为外部 HOST 环境变量暴露到局域网。
// 其余行为仍由 NeteaseCloudMusicApi 的 server.js 提供。
const fs = require('fs')
const os = require('os')
const path = require('path')

const tokenPath = path.join(os.tmpdir(), 'anonymous_token')
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const port = Number(process.env.INKMATE_NETEASE_PORT || 3000)
const host = process.env.INKMATE_NETEASE_HOST || '127.0.0.1'

function readTokenState() {
  try {
    const stat = fs.statSync(tokenPath)
    const token = fs.readFileSync(tokenPath, 'utf8').trim()
    return { token, ageMs: Date.now() - stat.mtimeMs }
  } catch {
    return { token: '', ageMs: Number.POSITIVE_INFINITY }
  }
}

async function main() {
  // request.js 在 require 时会同步读取这个文件，必须先确保它存在。
  if (!fs.existsSync(tokenPath)) {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
    fs.writeFileSync(tokenPath, '', 'utf-8')
  }

  const { token, ageMs } = readTokenState()
  if (!token || ageMs > TOKEN_MAX_AGE_MS) {
    console.log('[inkmate] 刷新网易云匿名 token（最多 7 天一次）…')
    const generateConfig = require('NeteaseCloudMusicApi/generateConfig')
    await Promise.race([
      generateConfig(),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ])
  }

  const { serveNcmApi } = require('NeteaseCloudMusicApi/server')
  await serveNcmApi({ port, host, checkVersion: false })
  console.log(`[inkmate] 网易云边车已监听 http://${host}:${port}`)
}

main().catch((error) => {
  console.error('[inkmate] 网易云边车启动失败：', error)
  process.exit(1)
})
