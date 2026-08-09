import { ensurePdfRuntimeCompat } from './pdfRuntimeCompat'

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfRuntime = typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler?: unknown }
}

let pdfJsPromise: Promise<PdfJsModule> | null = null

async function loadPdfJs() {
  if (!pdfJsPromise) {
    ensurePdfRuntimeCompat()
    pdfJsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ]).then(([pdfjs, worker]) => {
      const runtime = globalThis as PdfRuntime
      runtime.pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler }
      return pdfjs
    })
  }
  return await pdfJsPromise
}

function normalizeChunk(value: string) {
  return value.replace(/\u0000/g, '').replace(/\s+/g, ' ')
}

function needsSpace(left: string, right: string) {
  const last = left.at(-1)
  const first = right[0]
  if (!last || !first || /\s/.test(last) || /\s/.test(first)) return false
  if (/[([{\/"'“‘-]$/.test(left) || /^[)\]}.,;:!?\/"'”’-]/.test(right)) return false
  if (/[\u4e00-\u9fff]$/.test(left) || /^[\u4e00-\u9fff]/.test(right)) return false
  return true
}

function pageText(items: unknown[]) {
  const lines: string[] = []
  let line = ''
  let lastY: number | null = null
  const flush = () => {
    const value = line.replace(/[ \t]+/g, ' ').trim()
    if (value) lines.push(value)
    line = ''
  }
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { str?: unknown; transform?: unknown; hasEOL?: unknown }
    const chunk = typeof item.str === 'string' ? normalizeChunk(item.str) : ''
    if (!chunk) continue
    const transform = Array.isArray(item.transform) ? item.transform : null
    const y = typeof transform?.[5] === 'number' ? transform[5] : null
    if (line && y != null && lastY != null && Math.abs(y - lastY) > 2.5) flush()
    if (line && needsSpace(line, chunk)) line += ' '
    line += chunk
    lastY = y ?? lastY
    if (item.hasEOL) {
      flush()
      lastY = null
    }
  }
  flush()
  return lines.join('\n').trim()
}

export async function readPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
  })
  const document = await task.promise
  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const text = pageText(content.items as unknown[])
        if (text) pages.push(text)
      } finally {
        page.cleanup()
      }
    }
    return pages.join('\n\n').trim()
  } finally {
    await document.destroy()
  }
}
