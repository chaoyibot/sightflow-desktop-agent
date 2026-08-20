// src/core/engine.ts
// 主引擎循环 — 微信自动回复的完整感知→决策→执行闭环
//
// 流程:
// 1. 启动 — 初始化 hooks + 权限 OK
// 2. 测量 — VLM 一次性定位布局（chatEntrance / firstContact / inputArea），结果缓存
// 3. 发图 — 截图当前对话
// 4. 回复 — AI 分析截图内容 + RPA 执行回复
// 5. 检查下一条 — 纯视觉红点检测 + 点击切换
//    → 有未读: 视觉点击红点 → 细检测联系人 → 点击联系人，回到步骤 3
//    → 无未读: 轮询等待，直到新消息出现

import { AgentHooks, ReplyAction, ActionItem } from './hooks'
import { DesktopDevice } from './device'

export interface ScheduledPost {
  id: string
  /** 触发时间 HH:MM（24小时制） */
  time: string
  /** 要发布的文案 */
  content: string
  /** 启用开关 */
  enabled: boolean
}

export class Engine {
  private running = false
  private consecutiveUnreadFailures = 0
  private replyMode: 'auto' | 'manual' = 'auto'
  /** 启动失败原因（measureLayout 失败时记录，供 API 查询） */
  private startFailure: string | null = null
  /** 定时发布任务列表 */
  private scheduledPosts: ScheduledPost[] = []
  /** 已发送记录: taskId -> 日期字符串，防止同一天重复发送 */
  private sentToday = new Map<string, string>()
  private schedulerTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private hooks: AgentHooks,
    private device: DesktopDevice,
    private onLog?: (type: string, content: string) => void
  ) {}

  /** 设置回复模式：auto=AI 自动发送；manual=AI 只粘贴到输入框，用户手动点发送 */
  setReplyMode(mode: 'auto' | 'manual') {
    this.replyMode = mode
    console.log(`[Engine] 回复模式已切换: ${mode}`)
  }

  getReplyMode(): 'auto' | 'manual' {
    return this.replyMode
  }

  private emitLog(type: 'thinking' | 'reply' | 'skip' | 'error', content: string) {
    if (this.onLog) this.onLog(type, content)
    else console.log(`[Engine-${type}] ${content}`)
  }

  async start() {
    this.running = true
    await this.hooks.onEngineStart?.()

    // 启动定时发布调度器（每 30 秒检查一次）
    this.startScheduler()

    // 注册外部触发器
    this.hooks.onExternalTrigger?.((params) => {
      this.executeExternalActions(params)
    })

    try {
      // ── Step 1: 测量 ──
      this.emitLog('thinking', '开始布局测量...')
      const measureResult = await this.device.measureLayout()

      if (!measureResult.success) {
        this.startFailure = measureResult.error || '布局测量失败'
        this.emitLog('error', (measureResult.error || '布局测量失败') + '，引擎无法启动')
        this.running = false
        await this.hooks.onEngineStop?.()
        return
      }

      this.startFailure = null
      this.emitLog('thinking', '布局测量完成 ✓')

      // ── 主循环 ──
      while (this.running) {
        try {
          await this.processCurrentChat()

          if (!this.running) break

          // 处理完当前对话后，检查是否还有下一条未读
          await this.waitForNextUnread()
        } catch (e) {
          this.emitLog('error', `循环异常: ${String(e)}`)
          this.hooks.onError?.(e as Error, 'engine_loop')
          // 异常后等一段时间再重试
          await this.sleep(3000 + Math.random() * 2000)
        }
      }
    } catch (e) {
      this.emitLog('error', `引擎启动失败: ${String(e)}`)
      this.hooks.onError?.(e as Error, 'engine_start')
    }

    await this.hooks.onEngineStop?.()
  }

  stop() {
    this.running = false
    this.stopScheduler()
    this.device.clearChatBaseline()
  }

  isRunning() {
    return this.running
  }

  /** 启动失败原因（null = 成功进入主循环） */
  getStartFailure(): string | null {
    return this.startFailure
  }

  // ── 本地 HTTP API 支撑（语音遥控/外部脚本调用） ──

  /** 在当前激活的聊天窗口直接发送消息（不经过大模型） */
  async sendDirectMessage(text: string, autoSend = true): Promise<void> {
    await this.device.sendMessage(text, autoSend)
    this.emitLog('reply', `📨 API 手动发送: ${text.slice(0, 50)}...`)
  }

  /** 按姓名搜索并打开联系人聊天（语音遥控"给XX发微信"） */
  async openChatByName(name: string): Promise<{ success: boolean; error?: string }> {
    if (!this.running) {
      return { success: false, error: '引擎未运行' }
    }
    const result = await this.device.openChatByName(name)
    if (result.success) {
      this.emitLog('reply', `👤 API 打开联系人: ${name}`)
    } else {
      this.emitLog('error', `打开联系人失败: ${result.error}`)
    }
    return result
  }

  /** 未读检测（供 API 查询） */
  async checkUnreadForApi(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: unknown; coordinates: [number, number] }
  }> {
    const r = await this.device.hasUnreadMessage()
    return { hasUnread: r.hasUnread, chatEntranceArea: r.chatEntranceArea }
  }

  /** 手动触发某条定时发布任务（立即发送，不等待到点） */
  async triggerScheduledPost(id: string): Promise<{ success: boolean; error?: string }> {
    const post = this.scheduledPosts.find((p) => p.id === id)
    if (!post) {
      return { success: false, error: `未找到计划: ${id}` }
    }
    if (!this.running) {
      return { success: false, error: '引擎未运行' }
    }
    try {
      // 定时发布是主动营销，始终直接发送
      await this.device.sendMessage(post.content, true)
      this.sentToday.set(post.id, new Date().toDateString())
      this.emitLog('reply', `⏰ API 手动触发定时发布: ${post.content.slice(0, 50)}...`)
      return { success: true }
    } catch (e: any) {
      this.emitLog('error', `定时发布触发失败: ${String(e?.message || e)}`)
      return { success: false, error: String(e?.message || e) }
    }
  }

  // ── 定时发布 ──

  /** 设置定时发布任务列表（由主进程透传 settings.scheduledPosts） */
  setScheduledPosts(posts: ScheduledPost[]) {
    this.scheduledPosts = Array.isArray(posts) ? posts : []
    console.log(`[Engine] 定时发布任务已更新: ${this.scheduledPosts.length} 条`)
  }

  private startScheduler() {
    if (this.schedulerTimer) return
    // 每 30 秒检查一次到点任务
    this.schedulerTimer = setInterval(() => {
      this.checkScheduledPosts().catch((e) => {
        this.emitLog('error', `定时发布异常: ${String(e)}`)
      })
    }, 30_000)
    console.log('[Engine] 定时发布调度器已启动（每 30 秒检查）')
    // 启动后立即检查一次（防止启动瞬间错过到点任务）
    this.checkScheduledPosts().catch(() => {})
  }

  private stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }
  }

  /**
   * 检查是否有到点的定时发布任务，有则直接发送（不经过大模型）
   */
  private async checkScheduledPosts() {
    if (!this.running) return
    if (this.scheduledPosts.length === 0) return

    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const today = now.toDateString()

    for (const post of this.scheduledPosts) {
      if (!post.enabled) continue
      if (!post.time || post.time.length !== 5) continue
      if (post.time !== hhmm) continue

      // 同一天已发送过则跳过
      if (this.sentToday.get(post.id) === today) continue

      this.sentToday.set(post.id, today)
      this.emitLog('thinking', `⏰ 定时发布到点: ${post.time}`)
      try {
        // 定时发布是主动营销，始终直接发送（不跟随手动/自动模式）
        await this.device.sendMessage(post.content, true)
        this.emitLog('reply', `⏰ 定时发布已发送 (${post.time}): ${post.content.slice(0, 50)}...`)
      } catch (e) {
        this.emitLog('error', `定时发布发送失败: ${String(e)}`)
      }
    }
  }

  // ── Step 3+4: 发图 → 回复 ──

  /**
   * 处理当前对话：截图 → AI 分析 → RPA 执行回复 → 设置 diff baseline
   */
  private async processCurrentChat() {
    // 发图
    // 手动模式：只用聊天区截图（排除输入框残留干扰，避免 AI 误判已回复而 SKIP）
    // 自动模式：全窗口截图
    const screenshot = this.replyMode === 'manual'
      ? await this.device.screenshotChatArea()
      : await this.device.screenshot()
    this.emitLog('thinking', '截图完成，请求 AI 分析...')

    // 回复
    for await (const action of this.hooks.getReply({ screenshot })) {
      if (!this.running) break
      await this.executeAction(action)
    }

    // 回复完成后，保存 chatMainArea 截图作为 diff baseline
    // 这样后续轮询时可以检测当前对话窗口是否有新消息
    if (this.running) {
      await this.device.setChatBaseline()
    }
  }

  // ── Step 5: 双通道检测（红点 + chatMainArea diff） ──

  /**
   * 等待下一条消息（红点检测 + chatMainArea diff 双通道并行）
   *
   * 通道 1 — 红点检测：检测左侧列表的未读角标（其他联系人发消息）
   * 通道 2 — chatMainArea diff：检测当前对话窗口是否有变化（当前联系人发消息）
   *
   * 为什么需要双通道：
   * - 红点检测只能发现 **其他联系人** 的新消息（左侧列表出现红点）
   * - 但 **当前打开的对话** 收到新消息时，左侧不会出现红点
   * - chatMainArea diff 弥补了这个盲点
   *
   * 流程：
   * 1. 每轮轮询先检查 chatMainArea diff
   * 2. diff 有变化 → 直接 return（当前对话有新消息，回到 processCurrentChat）
   * 3. diff 无变化 → 检查红点
   * 4. 红点有未读 → 视觉点击切换联系人 → return
   */
  private async waitForNextUnread() {
    while (this.running) {
      // 轮询间隔 3-5 秒
      await this.sleep(3000 + Math.random() * 2000)

      if (!this.running) break

      // ── 通道 2: chatMainArea diff 检测 ──
      const diffResult = await this.device.hasChatAreaChanged()

      if (diffResult.hasDiff) {
        this.emitLog('thinking', '检测到当前对话有新消息（chatMainArea diff）')
        // 当前对话有变化 → 直接回到 processCurrentChat
        return
      }

      // ── 通道 1: 粗检测红点 ──
      const unreadResult = await this.device.hasUnreadMessage()

      if (!unreadResult.hasUnread) {
        // 两个通道都没有新消息，继续轮询
        continue
      }

      // ── Step 2: 点击红点区域激活未读列表 ──
      const redDotCoordinates = unreadResult.chatEntranceArea?.coordinates
      if (!redDotCoordinates) {
        this.emitLog('error', '检测到未读但未获取到 chatEntranceArea 坐标，继续轮询')
        continue
      }

      this.emitLog('thinking', `检测到未读消息，点击红点区域 (${redDotCoordinates[0]}, ${redDotCoordinates[1]})`)
      await this.device.activeUnreadByClick(redDotCoordinates)
      await this.sleep(150 + Math.random() * 100)

      // ── Step 3: 细检测联系人红点 ──
      let contactResult = await this.device.isChatContactUnread()

      // ── Step 3.1: 首次细检测失败 → 重新粗检测 + 再次点击 ──
      if (!contactResult.isUnread) {
        this.emitLog('thinking', '当前联系人无未读消息，重新检测...')
        await this.sleep(1000)

        const recheckResult = await this.device.hasUnreadMessage()

        if (recheckResult.hasUnread) {
          this.emitLog('thinking', '仍有未读消息，再次点击红点')

          const recheckCoords = recheckResult.chatEntranceArea?.coordinates
          if (recheckCoords) {
            await this.device.activeUnreadByClick(recheckCoords)
            await this.sleep(500)

            // 再次细检测
            contactResult = await this.device.isChatContactUnread()
          }
        } else {
          this.emitLog('skip', '重新检测后无未读消息，继续轮询')
          continue
        }
      }

      // ── Step 3.2: 连续两次细检测失败 → 增加失败计数，达到阈值再清除缓存强制重检 ──
      if (!contactResult.isUnread) {
        this.consecutiveUnreadFailures++

        if (this.consecutiveUnreadFailures >= 3) {
          this.emitLog('thinking', `连续 ${this.consecutiveUnreadFailures} 次检测失败，VLM 坐标缓存可能不准确，清除缓存强制重检`)
          this.device.clearUnreadCache()
          this.consecutiveUnreadFailures = 0 // 重置
          await this.sleep(500)

          // 重新调 isChatContactUnread（触发 VLM 重新定位 firstContact）
          contactResult = await this.device.isChatContactUnread()

          if (!contactResult.isUnread) {
            // 缓存重建后仍失败 → 再点击一次 + 最终检测
            this.emitLog('thinking', '缓存重建后检测失败，再点击一次')

            const retryUnread = await this.device.hasUnreadMessage()
            const retryCoords = retryUnread.chatEntranceArea?.coordinates

            if (retryCoords) {
              await this.device.activeUnreadByClick(retryCoords)
              await this.sleep(500)

              contactResult = await this.device.isChatContactUnread()

              if (!contactResult.isUnread) {
                this.emitLog('skip', '最终检测仍失败，放弃，继续轮询')
                continue
              }
            } else {
              this.emitLog('skip', '缓存重建后未获取到坐标，继续轮询')
              continue
            }
          }
        } else {
          this.emitLog('skip', `细检测失败 (第 ${this.consecutiveUnreadFailures} 次)，暂不清除缓存，继续轮询`)
          continue
        }
      }

      // 重置失败计数
      this.consecutiveUnreadFailures = 0

      // ── Step 4: 点击未读联系人 ──
      const firstContactCoords = contactResult.firstContactCoords
      if (!firstContactCoords) {
        this.emitLog('skip', '未获取到 firstContact 坐标，继续轮询')
        continue
      }

      // 2026-08-16 修复：点击前记录聊天区 baseline，点击后验证是否真的切换成功
      // 症状：VLM 定位 firstContact 不稳定（y 漂移 63px+），点击点空 → 聊天区空白
      // → AI 截图 10KB 只能 [SKIP] → 红点不消失 → 无限死循环
      // 验证方式：点击后聊天区内容变化 = 切换成功；无变化 = 点空，清缓存强制重定位再试
      await this.device.setChatBaseline()

      this.emitLog('thinking', `点击联系人 (${firstContactCoords[0]}, ${firstContactCoords[1]})`)
      await this.device.clickUnreadContact(firstContactCoords)
      await this.sleep(500 + Math.random() * 300)

      // 验证切换是否成功：聊天区是否变化
      const switchCheck = await this.device.hasChatAreaChanged()
      if (!switchCheck.hasDiff) {
        this.emitLog('skip', '点击后聊天区无变化（可能点空），清除缓存强制重新定位')
        this.device.clearUnreadCache()
        this.device.clearChatBaseline()

        // 重新 VLM 定位 firstContact 并再点一次（只重试一次，避免死循环）
        const retryContact = await this.device.isChatContactUnread()
        if (retryContact.isUnread && retryContact.firstContactCoords) {
          await this.sleep(500)
          this.emitLog('thinking', `重定位后再次点击联系人 (${retryContact.firstContactCoords[0]}, ${retryContact.firstContactCoords[1]})`)
          await this.device.clickUnreadContact(retryContact.firstContactCoords)
          await this.sleep(500 + Math.random() * 300)

          const retrySwitch = await this.device.hasChatAreaChanged()
          if (!retrySwitch.hasDiff) {
            this.emitLog('skip', '重定位后点击仍无变化，放弃本轮，继续轮询')
            this.device.clearChatBaseline()
            continue
          }
          this.device.clearChatBaseline()
        } else {
          this.emitLog('skip', '重定位后未获取到有效联系人，继续轮询')
          this.device.clearChatBaseline()
          continue
        }
      }

      // 切换了联系人 → 清除旧 baseline（新对话需要新的 baseline）
      this.device.clearChatBaseline()

      // 成功切换 → 回到主循环 processCurrentChat
      return
    }
  }

  // ── 执行动作 ──

  private async executeAction(action: ReplyAction) {
    try {
      switch (action.type) {
        case 'text':
          this.emitLog('reply', `[回复] ${action.content}`)
          // 手动模式：只粘贴不发送，用户手动点发送按钮；自动模式：粘贴+回车发送
          await this.device.sendMessage(action.content, this.replyMode === 'auto')
          this.hooks.onActionComplete?.(
            { type: 'text', content: action.content } as ActionItem,
            { success: true }
          )
          break
        case 'image':
          // TODO: 图片发送
          break
        case 'thinking':
          this.emitLog('thinking', action.content)
          break
        case 'skip':
          this.emitLog('skip', '跳过回复')
          break
      }
    } catch (e) {
      this.emitLog('error', `执行动作失败: ${String(e)}`)
      this.hooks.onError?.(e as Error, 'execute_action')
    }
  }

  private async executeExternalActions(params: {
    actions: ActionItem[]
    targets?: string[]
  }) {
    if (this.hooks.executeActions) {
      for await (const result of this.hooks.executeActions(params)) {
        console.log('[Engine] External action result:', result)
      }
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
