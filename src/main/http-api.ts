/**
 * SightFlow 本地 HTTP API 服务（语音遥控桥）
 * ==========================================
 * 让外部进程（Hermes/语音小宝/脚本）通过 localhost HTTP 遥控 SightFlow：
 *
 *   GET  /api/status                    → 引擎状态
 *   POST /api/engine/start              → 启动引擎（body: config 可选，缺省用已存设置）
 *   POST /api/engine/stop               → 停止引擎
 *   POST /api/message/send              → 在当前聊天窗口发送消息 { text, autoSend? }
 *   GET  /api/unread                    → 未读检测
 *   POST /api/scheduled/trigger         → 手动触发定时发布 { id }
 *   GET  /api/settings                  → 当前设置（含定时计划）
 *
 * 安全：仅监听 127.0.0.1。若设置了 SIGHTFLOW_API_TOKEN 环境变量，
 *       则所有请求需带 Authorization: Bearer <token>。
 * 零依赖：Node 内置 http 模块。
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { Engine } from '../core/engine'

export interface HttpApiContext {
  /** 获取当前引擎实例（可能为 null） */
  getEngine: () => Engine | null
  /** 获取设置存储 */
  getSettings: () => {
    get: (key: string) => unknown
    store: Record<string, unknown>
  }
  /** 启动引擎（复用主进程 startEngine 逻辑） */
  startEngine: (config?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  /** 截取当前屏幕（desktopCapturer，Session 1 桌面） */
  captureScreen?: () => Promise<string | null>
}

const PORT = 8766
const HOST = '127.0.0.1'

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

export function startHttpApi(ctx: HttpApiContext): void {
  const token = process.env.SIGHTFLOW_API_TOKEN || ''

  const server = createServer(async (req, res) => {
    try {
      // ── 鉴权 ──
      if (token) {
        const auth = req.headers.authorization || ''
        if (auth !== `Bearer ${token}`) {
          return sendJson(res, 401, { success: false, error: 'unauthorized' })
        }
      }

      const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
      const path = url.pathname
      const method = (req.method || 'GET').toUpperCase()

      // ── GET /api/status ──
      if (method === 'GET' && path === '/api/status') {
        const engine = ctx.getEngine()
        return sendJson(res, 200, {
          success: true,
          running: engine?.isRunning() ?? false,
          replyMode: engine?.getReplyMode() ?? null,
          engineMode: engine?.getEngineMode() ?? null
        })
      }

      // ── POST /api/engine/mode（运行中切换：auto=自动回复 / specified=指定回复） ──
      if (method === 'POST' && path === '/api/engine/mode') {
        const engine = ctx.getEngine()
        if (!engine?.isRunning()) {
          return sendJson(res, 400, { success: false, error: '引擎未运行' })
        }
        const body = await readBody(req)
        const mode = String(body.mode || '')
        if (mode !== 'auto' && mode !== 'specified') {
          return sendJson(res, 400, { success: false, error: 'mode 必须是 auto 或 specified' })
        }
        engine.setEngineMode(mode)
        return sendJson(res, 200, { success: true, engineMode: mode })
      }

      // ── POST /api/engine/start ──
      if (method === 'POST' && path === '/api/engine/start') {
        const body = await readBody(req)
        const result = await ctx.startEngine(body as Record<string, unknown>)
        return sendJson(res, result.success ? 200 : 400, result)
      }

      // ── POST /api/engine/stop ──
      if (method === 'POST' && path === '/api/engine/stop') {
        const engine = ctx.getEngine()
        if (!engine?.isRunning()) {
          return sendJson(res, 200, { success: false, error: '引擎未运行' })
        }
        engine.stop()
        return sendJson(res, 200, { success: true })
      }

      // ── POST /api/message/send ──
      if (method === 'POST' && path === '/api/message/send') {
        const engine = ctx.getEngine()
        if (!engine?.isRunning()) {
          return sendJson(res, 400, { success: false, error: '引擎未运行，请先 POST /api/engine/start' })
        }
        const body = await readBody(req)
        const text = String(body.text || '').trim()
        if (!text) {
          return sendJson(res, 400, { success: false, error: '缺少 text 字段' })
        }
        const autoSend = body.autoSend !== false
        try {
          await engine.sendDirectMessage(text, autoSend)
          return sendJson(res, 200, { success: true, text, autoSend })
        } catch (e: any) {
          return sendJson(res, 500, { success: false, error: String(e?.message || e) })
        }
      }

      // ── POST /api/chat/open ──
      if (method === 'POST' && path === '/api/chat/open') {
        const engine = ctx.getEngine()
        if (!engine?.isRunning()) {
          return sendJson(res, 400, { success: false, error: '引擎未运行' })
        }
        const body = await readBody(req)
        const name = String(body.name || '').trim()
        if (!name) {
          return sendJson(res, 400, { success: false, error: '缺少 name 字段' })
        }
        const result = await engine.openChatByName(name)
        return sendJson(res, result.success ? 200 : 400, result)
      }

      // ── GET /api/unread ──
      if (method === 'GET' && path === '/api/unread') {
        const engine = ctx.getEngine()
        if (!engine?.isRunning()) {
          return sendJson(res, 400, { success: false, error: '引擎未运行' })
        }
        try {
          const result = await engine.checkUnreadForApi()
          return sendJson(res, 200, { success: true, ...result })
        } catch (e: any) {
          return sendJson(res, 500, { success: false, error: String(e?.message || e) })
        }
      }

      // ── POST /api/scheduled/trigger ──
      if (method === 'POST' && path === '/api/scheduled/trigger') {
        const engine = ctx.getEngine()
        if (!engine?.isRunning()) {
          return sendJson(res, 400, { success: false, error: '引擎未运行' })
        }
        const body = await readBody(req)
        const id = String(body.id || '')
        if (!id) {
          return sendJson(res, 400, { success: false, error: '缺少 id 字段' })
        }
        const result = await engine.triggerScheduledPost(id)
        return sendJson(res, result.success ? 200 : 400, result)
      }

      // ── GET /api/settings ──
      if (method === 'GET' && path === '/api/settings') {
        const settings = ctx.getSettings()
        const store = settings.store || {}
        // 脱敏：不返回 apiKey
        const sanitized: Record<string, unknown> = { ...store }
        delete sanitized.apiKey
        return sendJson(res, 200, { success: true, settings: sanitized })
      }

      // ── GET /api/screenshot（调试/遥控：返回当前屏幕 base64） ──
      if (method === 'GET' && path === '/api/screenshot') {
        if (!ctx.captureScreen) {
          return sendJson(res, 400, { success: false, error: 'captureScreen 未提供' })
        }
        const dataUrl = await ctx.captureScreen()
        if (!dataUrl) {
          return sendJson(res, 500, { success: false, error: '截图失败' })
        }
        return sendJson(res, 200, { success: true, dataUrl })
      }

      return sendJson(res, 404, { success: false, error: `not found: ${method} ${path}` })
    } catch (e: any) {
      sendJson(res, 500, { success: false, error: String(e?.message || e) })
    }
  })

  server.listen(PORT, HOST, () => {
    console.log(`[HttpApi] SightFlow 本地 API: http://${HOST}:${PORT} (token: ${token ? '已启用' : '无'})`)
  })
}
