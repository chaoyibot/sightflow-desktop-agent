import { intToRGBA, Jimp } from 'jimp'
import { desktopCapturer } from 'electron'
import { getWindowInfo, getWechatWindowInfo } from './window-utils'
import { AppType } from './types'

const IS_MAC = process.platform === 'darwin'

interface ScreenshotCache {
  screenshotBase64: string
  nativeImage: Electron.NativeImage
  bounds: { x: number; y: number; width: number; height: number }
  display: {
    id: number
    bounds: { x: number; y: number; width: number; height: number }
    scaleFactor: number
  }
  timestamp: number
}

const screenshotCache = new Map<string, ScreenshotCache>()
const screenshotPendingPromises = new Map<string, Promise<ScreenshotCache | null>>()
const SCREENSHOT_CACHE_DURATION = 100 // 100ms

/**
 * 压缩截图（VLM 兼容）：agnes 等视觉 API 对图片大小有上限（~160KB 全屏 PNG 会 500 加载失败）
 * 策略：最长边 ≤ 1280px + JPEG 质量 80（约 30-60KB）
 * 直接用 Electron NativeImage 的 resize + toJPEG（jimp 在 Electron 主进程 read Buffer 报 MIME 错误，弃用）
 * 红点像素检测走 nativeImage 局部 crop（不经此压缩），不受影响
 */
async function compressScreenshot(
  nativeImage: Electron.NativeImage,
  maxSize = 1280,
  quality = 80
): Promise<string> {
  try {
    const { width, height } = nativeImage.getSize()
    if (!width || !height) {
      // 窗口最小化/不可见时 crop 出的 nativeImage 为空，直接报错避免空图发给 VLM
      throw new Error('截图为空（目标窗口可能最小化或不可见）')
    }
    const scale = Math.min(1, maxSize / Math.max(width, height))
    let img = nativeImage
    if (scale < 1) {
      img = nativeImage.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale)
      })
    }
    const jpeg = img.toJPEG(quality)
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch (error) {
    console.warn('[screenshot-utils] 截图压缩失败，退回原图:', error?.message)
    return nativeImage.toDataURL()
  }
}

function getCropHash(crop?: { x: number; y: number; width: number; height: number }): string {
  if (!crop) return 'no-crop'
  return `${crop.x}-${crop.y}-${crop.width}-${crop.height}`
}

function getScreenshotCacheKey(
  displayId: number,
  crop?: { x: number; y: number; width: number; height: number }
): string {
  return `${displayId}-${getCropHash(crop)}`
}

export function getChatContactAvatarBounds(): { x: number; y: number; width: number; height: number } {
  if (IS_MAC) {
    return { x: 72, y: 64, width: 46, height: 68 }
  }
  return { x: 70, y: 64, width: 46, height: 68 }
}

export const takeWeChatScreenshot = async ({ wechatType = 'weixin' }: { wechatType: AppType }) => {
  try {
    const windowInfo = await getWindowInfo(wechatType, true)
    if (!windowInfo) return { success: false, error: '未找到应用窗口' }
    return { success: true, screenshot: windowInfo.screenshot, bounds: windowInfo.bounds, scaleFactor: windowInfo.scaleFactor }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function calculateRedDotPercentage(base64Image: string, onlyFirstQuadrant: boolean = false): Promise<number | null> {
  try {
    const image = await Jimp.read(Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
    const { width, height } = image.bitmap
    const totalPixels = width * height
    if (totalPixels === 0) return null

    const centerX = width / 2
    const centerY = height / 2
    let redPixelCount = 0

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (onlyFirstQuadrant && (x <= centerX || y >= centerY)) continue
        const rgba = intToRGBA(image.getPixelColor(x, y))
        const { r, g, b, a } = rgba
        if (a > 128 && r > 150 && r > g * 1.5 && r > b * 1.5) redPixelCount++
      }
    }
    return (redPixelCount / totalPixels) * 100
  } catch (error) {
    return null
  }
}

export async function captureWechatWindow(
  appType: AppType = 'weixin',
  crop?: { x: number; y: number; width: number; height: number }
): Promise<any> {
  try {
    const windowCoreResult = await getWechatWindowInfo(appType)
    if (!windowCoreResult) return { success: false, error: '未找到窗口' }

    const { display, bounds, display: { scaleFactor } } = windowCoreResult
    const cacheKey = getScreenshotCacheKey(display.id, crop)

    const cached = screenshotCache.get(cacheKey)
    const now = Date.now()
    if (cached && now - cached.timestamp < SCREENSHOT_CACHE_DURATION) {
      const resultBounds = crop ? { x: bounds.x + crop.x, y: bounds.y + crop.y, width: crop.width, height: crop.height } : bounds
      return { success: true, screenshotBase64: cached.screenshotBase64, bounds: resultBounds, display: cached.display, timestamp: Date.now() }
    }

    const capturePromise = (async (): Promise<ScreenshotCache | null> => {
      try {
        const physicalWidth = Math.round(display.bounds.width * scaleFactor)
        const physicalHeight = Math.round(display.bounds.height * scaleFactor)

        // Add a timeout to desktopCapturer.getSources to prevent deadlocks
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('desktopCapturer timeout')), 5000)
        })

        const screenSources = await Promise.race([
          desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: physicalWidth, height: physicalHeight }
          }),
          timeoutPromise
        ]) as Electron.DesktopCapturerSource[]

        const matchedScreenSource = screenSources.find(s => String(s.display_id) === String(display.id)) || screenSources[0]
        if (!matchedScreenSource) return null

        let cropRect = {
          x: Math.round((bounds.x - display.bounds.x) * scaleFactor),
          y: Math.round((bounds.y - display.bounds.y) * scaleFactor),
          width: Math.round(bounds.width * scaleFactor),
          height: Math.round(bounds.height * scaleFactor)
        }

        if (crop) {
          const cropPhysical = {
            x: Math.round(crop.x * scaleFactor),
            y: Math.round(crop.y * scaleFactor),
            width: Math.round(crop.width * scaleFactor),
            height: Math.round(crop.height * scaleFactor)
          }
          cropRect = {
            x: Math.round(cropRect.x + cropPhysical.x),
            y: Math.round(cropRect.y + cropPhysical.y),
            width: cropPhysical.width,
            height: cropPhysical.height
          }
        }

        const croppedNativeImage = matchedScreenSource.thumbnail.crop(cropRect)
        // 压缩后再缓存（VLM 兼容，避免 agnes 大图 500）
        const croppedScreenshot = await compressScreenshot(croppedNativeImage)

        const resultBounds = crop ? { x: bounds.x + crop.x, y: bounds.y + crop.y, width: crop.width, height: crop.height } : bounds
        const cacheResult: ScreenshotCache = {
          screenshotBase64: croppedScreenshot,
          nativeImage: croppedNativeImage,
          bounds: resultBounds,
          display,
          timestamp: Date.now()
        }
        screenshotCache.set(cacheKey, cacheResult)
        return cacheResult
      } catch (error) {
        console.error('Screenshot capture error:', error)
        return null
      } finally {
        screenshotPendingPromises.delete(cacheKey)
      }
    })()

    screenshotPendingPromises.set(cacheKey, capturePromise)
    const captureResult = await capturePromise

    if (!captureResult) return { success: false, error: '截图失败', display }
    
    return { success: true, screenshotBase64: captureResult.screenshotBase64, nativeImage: captureResult.nativeImage, bounds: captureResult.bounds, display: captureResult.display }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * 截图 chatMainArea 区域，返回 NativeImage
 *
 * 从 LayoutCache 获取 chatMainArea.bbox → 计算 crop 区域 → 局部截图
 * 用于 diff 检测：对比前后两张 chatMainArea 截图判断是否有新消息
 */
export async function captureChatMainArea(
  appType: AppType
): Promise<Electron.NativeImage | null> {
  try {
    // 延迟导入避免循环引用
    const { getLayoutCache, bboxToCropBounds } = await import('./vision-utils')

    const layout = getLayoutCache(appType)
    if (!layout?.chatMainArea?.bbox) {
      console.log('[captureChatMainArea] 未找到 chatMainArea 缓存')
      return null
    }

    const windowInfo = await getWindowInfo(appType, false)
    if (!windowInfo?.bounds) {
      console.log('[captureChatMainArea] 获取窗口信息失败')
      return null
    }

    // 从归一化 bbox (0-1000) 计算出 crop 区域（逻辑像素）
    const cropBounds = bboxToCropBounds(layout.chatMainArea.bbox, windowInfo.bounds)
    const crop = {
      x: cropBounds.x,
      y: cropBounds.y,
      width: cropBounds.width,
      height: cropBounds.height
    }

    const screenshotResult = await captureWechatWindow(appType, crop)
    if (!screenshotResult.success) {
      console.log('[captureChatMainArea] 截图失败:', screenshotResult.error)
      return null
    }

    if (screenshotResult.nativeImage) {
      return screenshotResult.nativeImage
    }

    console.log('[captureChatMainArea] 截图结果无 nativeImage')
    return null
  } catch (error: any) {
    console.error('[captureChatMainArea] 异常:', error)
    return null
  }
}
