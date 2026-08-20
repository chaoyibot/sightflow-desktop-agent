// src/core/rpa/contact-search.ts
// 按姓名搜索并打开联系人聊天（语音遥控"给XX发微信"的关键能力）
//
// 流程：点击搜索框(布局缓存/VLM定位) → 粘贴姓名 → 等待搜索结果
//       → VLM 定位第一个结果 → 点击 → 等待聊天窗口打开
//
// 注意：
// - 中文输入统一用剪贴板 Ctrl+V 粘贴（与 sendReplyAction 一致，避免输入法问题）
// - 坐标：VLM 返回归一化 0-1000 bbox → bboxToScreenCoords 转屏幕物理坐标
import { clipboard } from 'electron'
import { AppType } from './types'
import { getWindowInfo } from './window-utils'
import { captureWechatWindow } from './screenshot-utils'
import { getLayoutCache } from './vision-utils'
import {
  parseBBoxes,
  bboxToScreenCoords,
  type BBox,
  type LayoutAreaItem
} from './vision-utils'
import { humanLikeMove, humanLikeClick } from './input-utils'
import { delay, randomDelayIn, getRobot } from './util'
import type { AIClient } from '../ai-client'
const IS_MAC = process.platform === 'darwin'

/** 获取搜索框坐标（布局缓存优先，无则 VLM 检测） */
async function getSearchBox(
  aiClient: AIClient,
  appType: AppType
): Promise<{ success: boolean; coords?: [number, number]; error?: string }> {
  // 1. 布局缓存优先（measureLayout 时已检测 searchInputBox）
  const cached = getLayoutCache(appType)?.searchInputBox
  if (cached?.coordinates) {
    console.log('[ContactSearch] 使用缓存搜索框坐标:', cached.coordinates)
    return { success: true, coords: cached.coordinates }
  }

  // 2. VLM 检测
  const screenshotResult = await captureWechatWindow(appType)
  if (!screenshotResult.success || !screenshotResult.screenshotBase64) {
    return { success: false, error: screenshotResult.error || '截图失败' }
  }
  const windowInfo = await getWindowInfo(appType, false)
  if (!windowInfo?.bounds || !windowInfo?.scaleFactor) {
    return { success: false, error: '获取窗口信息失败' }
  }

  const prompt =
    appType === 'wework'
      ? '这是企业微信窗口截图。找到窗口顶部的搜索输入框（通常在标题栏下方居左，带放大镜图标或"搜索"提示文字，是圆角输入框）。只输出它的归一化(0-1000)边界框，格式严格为：<bbox>x1,y1,x2,y2</bbox>。不要输出其他内容。'
      : '这是微信窗口截图。找到窗口顶部的搜索输入框（通常在标题栏下方居左，带放大镜图标或"搜索"提示文字）。只输出它的归一化(0-1000)边界框，格式严格为：<bbox>x1,y1,x2,y2</bbox>。不要输出其他内容。'

  console.log('[ContactSearch] VLM 检测搜索框...')
  const vlmResult = await aiClient.detectVision(prompt, screenshotResult.screenshotBase64)
  const bboxes = parseBBoxes(vlmResult)
  if (bboxes.length === 0) {
    return { success: false, error: `未检测到搜索框 (VLM返回: ${vlmResult.slice(0, 100)})` }
  }

  const coords = bboxToScreenCoords(bboxes[0], windowInfo.bounds, windowInfo.scaleFactor)
  console.log('[ContactSearch] 搜索框坐标:', coords)
  return { success: true, coords }
}

/** VLM 定位搜索结果列表中第一个匹配项（联系人/群聊） */
async function getFirstSearchResult(
  aiClient: AIClient,
  appType: AppType,
  name: string
): Promise<{ success: boolean; coords?: [number, number]; error?: string }> {
  const screenshotResult = await captureWechatWindow(appType)
  if (!screenshotResult.success || !screenshotResult.screenshotBase64) {
    return { success: false, error: screenshotResult.error || '截图失败' }
  }
  const windowInfo = await getWindowInfo(appType, false)
  if (!windowInfo?.bounds || !windowInfo?.scaleFactor) {
    return { success: false, error: '获取窗口信息失败' }
  }

  const prompt = `这是${appType === 'wework' ? '企业微信' : '微信'}窗口截图。顶部搜索框中输入了「${name}」，下方出现了搜索结果列表。
请找到列表中【第一个匹配的联系人或群聊项】（通常是"头像+昵称"的一行，可能标注"联系人""群聊"等分类）。
只输出该结果项所在行的归一化(0-1000)边界框，格式严格为：<bbox>x1,y1,x2,y2</bbox>。
如果搜索框下方没有结果列表，输出：<bbox>0,0,0,0</bbox>。不要输出其他内容。`

  console.log('[ContactSearch] VLM 定位搜索结果...')
  const vlmResult = await aiClient.detectVision(prompt, screenshotResult.screenshotBase64)
  const bboxes = parseBBoxes(vlmResult)

  // 过滤空框 (0,0,0,0)
  const valid = bboxes.filter((b) => !(b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0))
  if (valid.length === 0) {
    return { success: false, error: `未找到「${name}」的搜索结果 (VLM返回: ${vlmResult.slice(0, 100)})` }
  }

  const coords = bboxToScreenCoords(valid[0], windowInfo.bounds, windowInfo.scaleFactor)
  console.log('[ContactSearch] 第一个搜索结果坐标:', coords)
  return { success: true, coords }
}

/**
 * 按姓名搜索并打开联系人聊天
 *
 * 步骤：
 * 1. 点击搜索框（布局缓存/VLM 定位）
 * 2. 剪贴板粘贴姓名（Ctrl+V）
 * 3. 等待搜索结果渲染（~2s）
 * 4. VLM 定位第一个结果并点击
 * 5. 等待聊天窗口打开（~1.5s）
 */
export async function openChatByNameAction(
  aiClient: AIClient,
  appType: AppType,
  name: string
): Promise<{ success: boolean; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { success: false, error: '联系人姓名为空' }
  if (!aiClient) {
    return { success: false, error: 'AI Client 未初始化（请先启动引擎）' }
  }

  try {
    // 1. 搜索框
    const box = await getSearchBox(aiClient, appType)
    if (!box.success || !box.coords) {
      return { success: false, error: box.error || '无法定位搜索框' }
    }

    const robot = getRobot()
    if (!robot) return { success: false, error: 'RobotJS 缺失' }

    // 2. 点击搜索框聚焦
    await humanLikeMove(box.coords[0], box.coords[1])
    await randomDelayIn(120, 200)
    robot.mouseClick('left')
    await randomDelayIn(250, 400)

    // 3. 粘贴姓名（先清空可能已有的内容）
    robot.keyTap('a', [IS_MAC ? 'command' : 'control']) // 全选
    await randomDelayIn(80, 150)
    clipboard.writeText(trimmed)
    await randomDelayIn(60, 120)
    robot.keyTap('v', [IS_MAC ? 'command' : 'control']) // 粘贴
    await randomDelayIn(200, 300)

    // 4. 等待搜索结果渲染
    console.log('[ContactSearch] 等待搜索结果渲染...')
    await delay(2200)

    // 5. VLM 定位第一个结果并点击
    const result = await getFirstSearchResult(aiClient, appType, trimmed)
    if (!result.success || !result.coords) {
      return { success: false, error: result.error || '无法定位搜索结果' }
    }

    await humanLikeMove(result.coords[0], result.coords[1])
    await randomDelayIn(150, 250)
    robot.mouseClick('left')
    await randomDelayIn(300, 450)

    // 6. 等待聊天窗口打开
    await delay(1500)

    console.log(`[ContactSearch] 已打开「${trimmed}」的聊天窗口`)
    return { success: true }
  } catch (error: any) {
    console.error('[ContactSearch] openChatByNameAction 失败:', error)
    return { success: false, error: error?.message || String(error) }
  }
}
