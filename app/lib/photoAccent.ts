// 从背景照片里取强调色：只保留色相和压过的饱和度，亮度交给主题（浅色偏深、夜偏浅），
// 这样任何照片都不会出荧光色，强调色上的文字也能看清。纯浏览器端计算，结果存进外观配置同步。

export type PhotoAccent = { h: number; s: number }

const SAMPLE = 48
const BINS = 24

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s, l]
}

// 在灰、白、黑之外找「面积大又有点颜色」的色相；整张图几乎没颜色时返回 null，回落到主题强调色。
export function pickAccent(pixels: Uint8ClampedArray): PhotoAccent | null {
  const weight = new Array<number>(BINS).fill(0)
  const sinSum = new Array<number>(BINS).fill(0)
  const cosSum = new Array<number>(BINS).fill(0)
  const satSum = new Array<number>(BINS).fill(0)
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2])
    if (s < 0.12 || l < 0.12 || l > 0.9) continue
    const w = s * (1 - Math.abs(l - 0.5))
    const bin = Math.floor(h / (360 / BINS)) % BINS
    const rad = (h * Math.PI) / 180
    weight[bin] += w
    sinSum[bin] += Math.sin(rad) * w
    cosSum[bin] += Math.cos(rad) * w
    satSum[bin] += s * w
  }
  let best = -1
  for (let i = 0; i < BINS; i++) {
    // 相邻两格一起算，避免一种颜色正好跨在格子边界上被拆成两半
    const total = weight[i] + weight[(i + 1) % BINS]
    if (total > 0 && (best < 0 || total > weight[best] + weight[(best + 1) % BINS])) best = i
  }
  if (best < 0) return null
  const bins = [best, (best + 1) % BINS]
  const w = bins.reduce((sum, b) => sum + weight[b], 0)
  if (w < SAMPLE * SAMPLE * 0.01) return null
  const hue = (Math.atan2(bins.reduce((a, b) => a + sinSum[b], 0), bins.reduce((a, b) => a + cosSum[b], 0)) * 180) / Math.PI
  const sat = bins.reduce((a, b) => a + satSum[b], 0) / w
  return {
    h: Math.round((hue + 360) % 360),
    s: Math.round(Math.max(25, Math.min(50, sat * 100))),
  }
}

export async function extractPhotoAccent(source: Blob): Promise<PhotoAccent | null> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE
    canvas.height = SAMPLE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE)
    return pickAccent(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data)
  } finally {
    bitmap.close()
  }
}
