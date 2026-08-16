import { app, shell, BrowserWindow, ipcMain, desktopCapturer } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { checkAndRequestPermissions } from './permission'
import Store from 'electron-store'
import { Engine } from '../core/engine'
import { LocalHooks } from '../core/local-hooks'
import { AIClient } from '../core/ai-client'
import { RPADevice } from '../core/rpa-device'
const StoreClass = typeof Store === 'function' ? Store : ((Store as any).default as typeof Store)
const settingsStore = new StoreClass({
  name: 'settings',
  defaults: { apiKey: '', model: '', baseURL: '', visionModel: '', aiEngine: 'volcano', systemPrompt: '', locale: 'zh', promptTemplates: [], replyMode: 'auto', scheduledPosts: [] }
})

let engine: Engine | null = null
let localHooks: LocalHooks | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 360,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#0a0b10',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // 检查和请求 macOS 需要的权限
  await checkAndRequestPermissions()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // ── Settings 持久化 ──
  ipcMain.handle('settings:getAll', async () => {
    return settingsStore.store
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    return settingsStore.get(key)
  })

  ipcMain.handle('settings:set', async (_event, data: Record<string, any>) => {
    for (const [key, value] of Object.entries(data)) {
      settingsStore.set(key, value)
    }
    return { success: true }
  })

  // ── Engine 操控 ──
  ipcMain.handle('engine:start', async (_event, config) => {
    if (engine?.isRunning()) return { success: false, error: '引擎已在运行中' }
    try {
      const effectiveVisionModel = config.visionModel || config.model || 'doubao-seed-2.0-lite'
      localHooks = new LocalHooks({
        ai: {
          apiKey: config.apiKey,
          model: config.model,
          baseURL: config.baseURL,
          systemPrompt: config.systemPrompt,
          // 主回复也是截图视觉任务，必须用支持图片输入的模型
          visionModel: effectiveVisionModel
        }
      })
      const device = new RPADevice()
      device.setAppType(config.appType || 'weixin')
      // 传完整配置：主模型用于文本回复，visionModel 固定为视觉模型（VLM 布局检测必须支持图片输入）
      device.setAiConfig({
        apiKey: config.apiKey,
        model: config.model,
        baseURL: config.baseURL,
        visionModel: effectiveVisionModel
      })
      const mainWindow = BrowserWindow.getAllWindows()[0]
      engine = new Engine(localHooks, device, (type, content) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine:log', { type, content })
        }
      })
      // 回复模式：auto=AI 自动发送；manual=AI 只粘贴，用户手动点发送
      engine.setReplyMode(config.replyMode === 'manual' ? 'manual' : 'auto')
      // 定时发布任务列表
      engine.setScheduledPosts(config.scheduledPosts || [])
      
      engine.start().catch((err: any) => {
        console.error('[Main] Engine loop error:', err)
      })
      
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('engine:stop', async () => {
    if (!engine?.isRunning()) return { success: false, error: '引擎未运行' }
    engine.stop()
    return { success: true }
  })

  ipcMain.handle('engine:status', async () => {
    return { running: engine?.isRunning() ?? false }
  })

  ipcMain.handle('engine:updateConfig', async (_event, config) => {
    if (localHooks) {
      // 整个 config 透传（含 visionModel / apiKey / baseURL / model）
      localHooks.updateAIConfig(config)
      if (engine && config.appType) {
        (engine as any).device?.setAppType(config.appType)
      }
      // 运行中更新 RPA 设备的 AI 配置（visionModel 变更即时生效）
      if (engine && (config.visionModel || config.model)) {
        ;(engine as any).device?.setAiConfig?.({
          apiKey: config.apiKey,
          model: config.model,
          baseURL: config.baseURL,
          visionModel: config.visionModel || config.model || undefined
        })
      }
      // 运行中切换回复模式（auto/manual 即时生效）
      if (engine && config.replyMode) {
        engine.setReplyMode(config.replyMode === 'manual' ? 'manual' : 'auto')
      }
      // 运行中更新定时发布任务（即时生效）
      if (engine && Array.isArray(config.scheduledPosts)) {
        engine.setScheduledPosts(config.scheduledPosts)
      }
      return { success: true }
    }
    return { success: false, error: '引擎未初始化' }
  })

  ipcMain.handle('engine:testConnection', async (_event, config) => {
    const client = new AIClient(config)
    return client.testConnection()
  })

  // ── 定时发布计划：AI 生成 ──
  ipcMain.handle('scheduled:generate', async (_event, params: { description?: string }) => {
    try {
      const apiKey = (settingsStore.get('apiKey') as string) || ''
      if (!apiKey) return { success: false, error: '请先在设置中填写 API Key' }
      const model = (settingsStore.get('model') as string) || 'doubao-seed-2.0-lite'
      const baseURL = (settingsStore.get('baseURL') as string) || 'https://ark.cn-beijing.volces.com/api/coding/v3'
      const systemPrompt = (settingsStore.get('systemPrompt') as string) || ''

      const description = params?.description?.trim()
      if (!description) return { success: false, error: '请先描述你想要的发布计划' }

      const client = new AIClient({ apiKey, model, baseURL, systemPrompt })
      const prompt = `你是营销排期规划专家。请根据用户需求，规划一份"每天定时发布"的计划表。

用户需求：
${description}

要求：
1. 只输出一个 JSON 数组，格式：[{"time": "09:00", "content": "文案内容"}, {"time": "12:00", "content": "文案内容"}]
2. 3~8 条任务，时间分布合理（避开深夜，间隔自然）
3. 每条 content 是完整、可直接发送的推广文案（贴合用户需求，参考系统人设话术风格）
4. 文案合规：不夸大宣传、不承诺疗效、不出现具体价格底价
5. 不要输出任何解释、markdown 代码块标记，只输出 JSON 数组本身`

      const result = await client.callText(prompt)
      if (!result) return { success: false, error: 'AI 返回为空' }

      // 提取 JSON 数组（容错：去除 ```json 包裹或前后杂文本）
      const match = result.match(/\[[\s\S]*\]/)
      if (!match) {
        return { success: false, error: `AI 返回格式无法解析: ${result.slice(0, 200)}` }
      }
      const parsed = JSON.parse(match[0])
      if (!Array.isArray(parsed)) return { success: false, error: 'AI 返回不是数组' }

      // 规范化：只保留 time/content/enabled，校验时间格式
      const posts = parsed
        .filter((p: any) => p && typeof p.time === 'string' && typeof p.content === 'string')
        .map((p: any) => ({
          id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          time: p.time.trim(),
          content: p.content.trim(),
          enabled: true
        }))
        .filter((p: any) => /^\d{2}:\d{2}$/.test(p.time) && p.content)

      if (posts.length === 0) return { success: false, error: 'AI 生成的计划为空或格式不正确' }

      return { success: true, posts }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('capture-screen', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      if (sources && sources.length > 0) {
        return sources[0].thumbnail.toDataURL()
      }
      return null
    } catch (error) {
      console.error('Screen capture failed:', error)
      return null
    }
  })

  // ── 测试入口：VLM 并行 vs 串行 ──
  ipcMain.handle('test:vlm-parallel', async () => {
    const apiKey = settingsStore.get('apiKey') as string
    if (!apiKey) return { error: '请先在设置中填写 API Key' }
    const { runVlmParallelTest } = await import('../core/rpa/tests/test-vlm-parallel')
    return await runVlmParallelTest(apiKey, 'weixin')
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
