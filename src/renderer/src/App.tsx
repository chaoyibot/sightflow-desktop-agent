import { useState, useCallback, useRef, useEffect } from 'react'
import { t } from './i18n'
import logoUrl from './assets/logo.png'
import './index.css'

// ─── Types ───
interface LogEntry {
  time: string
  type: 'thinking' | 'reply' | 'skip' | 'error'
  content: string
}

type EngineStatus = 'idle' | 'running' | 'error'
type View = 'control' | 'settings'

// ─── SVG Icons ───
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.14v14l11-7-11-7z" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
)

// ─── App ───
function App() {
  const [view, setView] = useState<View>('control')
  const [status, setStatus] = useState<EngineStatus>('idle')

  return (
    <div className="app">
      <header className="app-header">
        {view === 'settings' ? (
          <button
            className="bottom-btn bottom-btn-settings"
            onClick={() => setView('control')}
            style={{ width: 32, height: 32, marginRight: 4 }}
          >
            <BackIcon />
          </button>
        ) : null}
        <img src={logoUrl} alt="SightFlow" className="app-logo" />
      </header>

      <div className="app-content">
        {view === 'control' ? (
          <ControlPanel status={status} setStatus={setStatus} />
        ) : (
          <SettingsPanel />
        )}
      </div>

      {view === 'control' && (
        <BottomBar
          status={status}
          setStatus={setStatus}
          onSettings={() => setView('settings')}
        />
      )}

      <Toast />
    </div>
  )
}

// ─── Control Panel ───
function ControlPanel({
  status,
  setStatus
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
}) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((type: LogEntry['type'], content: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev.slice(-99), { time, type, content }])
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    const cleanup = window.electron?.on('engine:log', (data: { type: string; content: string }) => {
      addLog(data.type as LogEntry['type'], data.content)

      if (data.type === 'error' && data.content.includes('引擎无法启动')) {
        setStatus('error')
      }
    })
    return cleanup
  }, [addLog, setStatus])

  const statusLabel =
    status === 'running'
      ? t('status.running')
      : status === 'error'
        ? t('status.error')
        : t('status.idle')

  return (
    <div className="fade-in">
      <div className={`status-indicator ${status}`}>
        <div className={`status-dot ${status}`} />
        <span className="status-text">{statusLabel}</span>
      </div>

      <div className="card">
        <div className="card-title">{t('control.log')}</div>
        <div className="message-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="message-log-empty">{t('control.log.empty')}</div>
          ) : (
            logs.map((entry, i) => (
              <div className="log-entry" key={i}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>
                  {t(`control.log.${entry.type}` as any)}
                </span>
                <span>{entry.content}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Bottom Bar ───
function BottomBar({
  status,
  setStatus,
  onSettings
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
  onSettings: () => void
}) {
  const handleStart = useCallback(async () => {
    const settings = await window.electron?.invoke('settings:getAll')
    const apiKey = settings?.apiKey || ''
    if (!apiKey) {
      showToast(t('control.start.nokey'), 'error')
      return
    }

    const config = {
      apiKey,
      model: settings?.model || undefined,
      baseURL: settings?.baseURL || undefined,
      systemPrompt: settings?.systemPrompt || undefined,
      appType: settings?.appType || 'weixin'
    }

    const result = await window.electron?.invoke('engine:start', config)
    if (result?.success) {
      setStatus('running')
      showToast(t('toast.engineStarted'), 'success')
    } else {
      setStatus('error')
      showToast(result?.error || t('toast.startFailed'), 'error')
    }
  }, [setStatus])

  const handleStop = useCallback(async () => {
    await window.electron?.invoke('engine:stop')
    setStatus('idle')
    showToast(t('toast.engineStopped'), 'success')
  }, [setStatus])

  const running = status === 'running'

  return (
    <div className="bottom-bar">
      {running ? (
        <button className="bottom-btn bottom-btn-stop" onClick={handleStop}>
          <StopIcon />
          {t('control.stop')}
        </button>
      ) : (
        <button className="bottom-btn bottom-btn-play" onClick={handleStart}>
          <PlayIcon />
          {t('control.start')}
        </button>
      )}
      <button className="bottom-btn bottom-btn-settings" onClick={onSettings}>
        <GearIcon />
      </button>
    </div>
  )
}

// ─── Settings Panel ───

// 预置角色模板（首次使用自动加载；用户自定义模板保存在 settings.json 的 promptTemplates）
interface PromptTemplate {
  name: string
  content: string
}

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    name: '购物群管理员（小果冻）',
    content: `你是一个购物群管理员，昵称小果冻。

## 人设
温柔贴心·专业靠谱·高效响应·宠粉暖心，不生硬发广告，侧重互动陪伴、福利推送、问题解决。

## 规则
1. 只输出回复文字，不要解释
2. 防自我循环：右侧气泡是"我"发的，若最后一条是右侧气泡输出 [SKIP]
3. 系统消息/群公告/红包/转账 → 输出 [SKIP]
4. 无法判断是否需要回复 → 输出 [SKIP]
5. 回复自然口语化，像真人
6. 超过半小时群里没人讲话，可以说几句搞笑接地气的话活跃气氛

## 常用话术
- 欢迎新人：✨ 欢迎宝子加入咱们购物福利群！我是管理员小果冻，群里不发无关广告、不刷屏，其余时间畅聊好物、蹲福利、解疑惑！
- 福利通知：🔥 紧急通知！群友专属秒杀来啦！爆款（平时99元），今日群内专属价49.9元，限量50件，手慢无！
- 售后答疑：@宝子 你好呀！别着急～优惠券用法：1.复制链接领券 2.打开商品页自动抵扣 3.拍好后@我核对订单
- 活跃气氛：😜 群里太安静啦，来互动一下！评论区扣"想要"，我看看大家最想要什么好物，下次优先给大家谈福利！
- 晚安收尾：🌙 晚安宝子们！今天的福利就到这里啦，没抢到的别灰心，明天还有更给力的活动，记得蹲群哦～`
  },
  {
    name: '医药招商助手',
    content: `你是一个医药招商群管理员。

## 人设
专业、热情、信息清晰，帮助厂家和代理商对接供需。

## 规则
1. 只输出回复文字，不要解释
2. 防自我循环：右侧气泡是"我"发的，若最后一条是右侧气泡输出 [SKIP]
3. 系统消息/群公告/红包/转账 → 输出 [SKIP]
4. 无法判断是否需要回复 → 输出 [SKIP]
5. 回复自然口语化，像真人

## 常用话术
- 产品介绍：💊 【产品名称】XX\n【规格】XX\n【功能主治】XX\n【优势】✅XX\n📞 招商热线：XX
- 供需对接：这个平台真的太实用了！给厂家和代理商都提供了免费的宣传渠道，供需对接太方便了👍
- 活跃气氛：咱们群里都是做XX线的同行，有没有已经在上面发布过信息的老师？可以出来说说体验呀~`
  },
  {
    name: '通用客服（简洁）',
    content: `你是一个微信群自动回复助手。

## 规则
1. 只输出回复文字，不要解释
2. 防自我循环：右侧气泡是"我"发的，若最后一条是右侧气泡输出 [SKIP]
3. 系统消息/群公告/红包/转账 → 输出 [SKIP]
4. 无法判断是否需要回复 → 输出 [SKIP]
5. 回复自然口语化，像真人`
  }
]

function SettingsPanel() {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('doubao-seed-2.0-lite')
  const [baseURL, setBaseURL] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [appType, setAppType] = useState<'weixin' | 'wework'>('weixin')
  const [replyMode, setReplyMode] = useState<'auto' | 'manual'>('auto')
  // 定时发布任务
  const [scheduledPosts, setScheduledPosts] = useState<{ id: string; time: string; content: string; enabled: boolean }[]>([])
  const [postTime, setPostTime] = useState('09:00')
  const [postContent, setPostContent] = useState('')
  const [testing, setTesting] = useState(false)
  const [, setLoaded] = useState(false)
  // 角色模板
  const [templates, setTemplates] = useState<PromptTemplate[]>(BUILTIN_TEMPLATES)
  const [selectedTemplate, setSelectedTemplate] = useState('')

  useEffect(() => {
    window.electron?.invoke('settings:getAll').then((settings: any) => {
      if (settings) {
        setApiKey(settings.apiKey || '')
        setModel(settings.model || 'doubao-seed-2.0-lite')
        setBaseURL(settings.baseURL || '')
        setSystemPrompt(settings.systemPrompt || '')
        setAppType(settings.appType || 'weixin')
        setReplyMode(settings.replyMode === 'manual' ? 'manual' : 'auto')
        if (Array.isArray(settings.scheduledPosts)) {
          setScheduledPosts(settings.scheduledPosts)
        }
        // 加载用户自定义模板（有则合并到预置模板之后）
        if (Array.isArray(settings.promptTemplates) && settings.promptTemplates.length > 0) {
          setTemplates([...BUILTIN_TEMPLATES, ...settings.promptTemplates])
        }
      }
      setLoaded(true)
    })
  }, [])

  // ── 角色模板操作 ──

  /** 应用选中模板到 prompt 输入框（不自动保存，用户可编辑后再保存） */
  const applyTemplate = useCallback((name: string) => {
    const tpl = templates.find((t) => t.name === name)
    if (tpl) {
      setSystemPrompt(tpl.content)
      setSelectedTemplate(name)
    }
  }, [templates])

  /** 把当前输入框内容保存为模板（同名覆盖；新名字则追加） */
  const saveAsTemplate = useCallback(async () => {
    if (!systemPrompt.trim()) return
    const name = selectedTemplate || prompt('模板名称：') || ''
    if (!name.trim()) return
    const next = templates.some((t) => t.name === name)
      ? templates.map((t) => (t.name === name ? { ...t, content: systemPrompt } : t))
      : [...templates, { name, content: systemPrompt }]
    setTemplates(next)
    setSelectedTemplate(name)
    // 持久化用户自定义模板（去掉预置的，只存用户自己的）
    const custom = next.filter((t) => !BUILTIN_TEMPLATES.some((b) => b.name === t.name))
    await window.electron?.invoke('settings:set', { promptTemplates: custom })
    showToast(`模板「${name}」已保存`, 'success')
  }, [systemPrompt, selectedTemplate, templates])

  /** 删除选中模板（预置模板不可删） */
  const deleteTemplate = useCallback(async (name: string) => {
    const isBuiltin = BUILTIN_TEMPLATES.some((b) => b.name === name)
    if (isBuiltin) {
      showToast('预置模板不可删除', 'error')
      return
    }
    const next = templates.filter((t) => t.name !== name)
    setTemplates(next)
    if (selectedTemplate === name) setSelectedTemplate('')
    const custom = next.filter((t) => !BUILTIN_TEMPLATES.some((b) => b.name === t.name))
    await window.electron?.invoke('settings:set', { promptTemplates: custom })
    showToast(`模板「${name}」已删除`, 'success')
  }, [templates, selectedTemplate])

  /** 添加定时发布任务 */
  const addScheduledPost = useCallback(() => {
    const time = postTime?.trim()
    const content = postContent?.trim()
    if (!time || !content) {
      showToast('请填写发布时间和文案内容', 'error')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      showToast('时间格式应为 HH:MM，例如 09:30', 'error')
      return
    }
    const post = {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      time,
      content,
      enabled: true
    }
    setScheduledPosts([...scheduledPosts, post])
    setPostContent('')
    showToast(`已添加定时任务 ${time}`, 'success')
  }, [postTime, postContent, scheduledPosts])

  /** 切换定时任务启用状态 */
  const toggleScheduledPost = useCallback((id: string) => {
    setScheduledPosts(scheduledPosts.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
  }, [scheduledPosts])

  /** 删除定时任务 */
  const deleteScheduledPost = useCallback((id: string) => {
    setScheduledPosts(scheduledPosts.filter((p) => p.id !== id))
  }, [scheduledPosts])

  const handleSave = useCallback(async () => {
    await window.electron?.invoke('settings:set', {
      apiKey,
      model,
      baseURL,
      systemPrompt,
      appType,
      replyMode,
      scheduledPosts
    })

    window.electron?.invoke('engine:updateConfig', {
      apiKey: apiKey || undefined,
      model: model || undefined,
      baseURL: baseURL || undefined,
      systemPrompt: systemPrompt || undefined,
      appType,
      replyMode,
      scheduledPosts
    })

    showToast(t('settings.saved'), 'success')
  }, [apiKey, model, baseURL, systemPrompt, appType, replyMode, scheduledPosts])

  const handleTestConnection = useCallback(async () => {
    if (!apiKey) return
    setTesting(true)
    try {
      const result = await window.electron?.invoke('engine:testConnection', {
        apiKey,
        model: model || undefined,
        baseURL: baseURL || undefined
      })
      if (result?.success) {
        showToast(t('settings.testConnection.success'), 'success')
      } else {
        showToast(`${t('settings.testConnection.fail')}: ${result?.error || ''}`, 'error')
      }
    } catch (e: any) {
      showToast(`${t('settings.testConnection.fail')}: ${e.message}`, 'error')
    } finally {
      setTesting(false)
    }
  }, [apiKey, model, baseURL])

  return (
    <div className="slide-up">
      <div className="card">
        <div className="card-title">{t('settings.ai')}</div>

        <div className="form-group">
          <label className="form-label">应用类型</label>
          <select
            className="form-input"
            value={appType}
            onChange={(e) => setAppType(e.target.value as any)}
          >
            <option value="weixin">微信</option>
            <option value="wework">企业微信</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">回复模式</label>
          <select
            className="form-input"
            value={replyMode}
            onChange={(e) => setReplyMode(e.target.value as any)}
          >
            <option value="auto">🤖 自动回复（AI 生成后自动发送）</option>
            <option value="manual">✋ 手动回复（AI 只填入输入框，你点发送才发）</option>
          </select>
          <div className="form-hint">
            手动模式下：AI 把回复内容粘贴到微信输入框，但不会自动发送，你确认后手动点发送按钮
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">⏰ 定时发布计划</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              type="time"
              className="form-input"
              style={{ width: 110, flex: 'none' }}
              value={postTime}
              onChange={(e) => setPostTime(e.target.value)}
            />
            <input
              className="form-input"
              style={{ flex: 1 }}
              placeholder="每天这个时间自动发这条文案（不经过大模型）"
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addScheduledPost()
              }}
            />
            <button
              className="btn btn-secondary"
              style={{ whiteSpace: 'nowrap', padding: '6px 10px' }}
              onClick={addScheduledPost}
            >
              ➕ 添加
            </button>
          </div>
          <div className="form-hint">到点后自动把文案发到当前打开的对话窗口（请保持目标群/联系人打开）</div>
          {scheduledPosts.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {scheduledPosts.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.06)',
                    border: p.enabled ? '1px solid rgba(80,160,255,0.35)' : '1px solid rgba(255,255,255,0.1)',
                    opacity: p.enabled ? 1 : 0.55
                  }}
                >
                  <span style={{ fontWeight: 600, color: p.enabled ? '#7cb5ff' : '#888', minWidth: 46 }}>
                    {p.time}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.content}
                  </span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={() => toggleScheduledPost(p.id)}
                    title={p.enabled ? '点击停用' : '点击启用'}
                  >
                    {p.enabled ? '✅ 启用' : '⏸ 停用'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: 11, color: '#ff8080' }}
                    onClick={() => deleteScheduledPost(p.id)}
                    title="删除"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.apiKey')}</label>
          <input
            className="form-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('settings.apiKey.placeholder')}
            autoComplete="off"
          />
          <div className="form-hint">{t('settings.apiKey.hint')}</div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.model')}</label>
          <input
            className="form-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t('settings.model.placeholder')}
          />
          <div className="form-hint">支持 doubao-seed-2.1-turbo / doubao-seed-2.0-lite / minimax-m3 / glm-5.2 / deepseek-v4-flash / kimi-k2.7-code（需支持图片输入）</div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.baseURL')}</label>
          <input
            className="form-input"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder={t('settings.baseURL.placeholder')}
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.systemPrompt')}</label>

          {/* 角色模板切换 */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <select
              className="form-input"
              style={{ flex: 1 }}
              value={selectedTemplate}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">— 选择角色模板 —</option>
              {templates.map((tpl) => (
                <option key={tpl.name} value={tpl.name}>{tpl.name}</option>
              ))}
            </select>
            <button
              className="btn btn-secondary"
              style={{ whiteSpace: 'nowrap', padding: '6px 10px' }}
              onClick={saveAsTemplate}
              title="把当前人设保存为模板（选中模板时覆盖，否则新建）"
            >
              💾 存为模板
            </button>
            <button
              className="btn btn-secondary"
              style={{ whiteSpace: 'nowrap', padding: '6px 10px' }}
              onClick={() => selectedTemplate && deleteTemplate(selectedTemplate)}
              disabled={!selectedTemplate}
              title="删除当前模板（预置模板不可删）"
            >
              🗑 删除
            </button>
          </div>

          <textarea
            className="form-input"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={t('settings.systemPrompt.placeholder')}
            rows={10}
          />
          <div className="form-hint">先选模板一键切换人设，再点「保存」生效；「存为模板」可自定义新角色</div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={!apiKey || testing}
          >
            {testing ? t('settings.testConnection.testing') : t('settings.testConnection')}
          </button>
          <button className="btn btn-primary" onClick={handleSave} style={{ flex: 1 }}>
            {t('settings.save')}
          </button>
        </div>
      </div>

    </div>
  )
}

// ─── Toast ───
let _showToast: ((msg: string, type: 'success' | 'error') => void) | null = null

function showToast(msg: string, type: 'success' | 'error') {
  _showToast?.(msg, type)
}

function Toast() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<number | undefined>(undefined)

  _showToast = useCallback((msg: string, t: 'success' | 'error') => {
    setMessage(msg)
    setType(t)
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(false), 2500)
  }, [])

  return (
    <div className={`toast ${type} ${visible ? 'show' : ''}`}>{message}</div>
  )
}

export default App
