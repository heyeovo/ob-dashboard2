import { readPdfText } from './pdfTextReader'

const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_DOCUMENT_CHARS = 120_000
const MAX_CSV_CHARS = 80_000
const MAX_CSV_ROWS = 80
const MAX_CSV_COLUMNS = 12

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
}

export type ParsedDocument = {
  mimeType: string
  textContent: string
  truncated: boolean
}

export function documentExtension(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
}

export function isSupportedDocument(file: File) {
  return Boolean(MIME_BY_EXTENSION[documentExtension(file.name)])
}

function normalizeText(text: string) {
  return text.replace(/\r/g, '').replace(/\u0000/g, '').trim()
}

function truncate(text: string, limit: number) {
  const normalized = normalizeText(text)
  return normalized.length <= limit
    ? { text: normalized, truncated: false }
    : { text: normalized.slice(0, limit).trim(), truncated: true }
}

function localName(node: Element) {
  return node.localName || node.tagName.split(':').pop() || ''
}

function paragraphText(paragraph: Element) {
  let text = ''
  const walker = paragraph.ownerDocument.createTreeWalker(
    paragraph,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  )
  let current: Node | null = paragraph
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) text += current.textContent ?? ''
    else if (current.nodeType === Node.ELEMENT_NODE) {
      const name = localName(current as Element)
      if (name === 'tab') text += '\t'
      else if (name === 'br' || name === 'cr') text += '\n'
    }
    current = walker.nextNode()
  }
  return text.replace(/\u00a0/g, ' ').trim()
}

async function readDocxText(buffer: ArrayBuffer) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.values(zip.files)
    .filter(entry => !entry.dir && /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  const parser = new DOMParser()
  const sections: string[] = []
  for (const entry of entries) {
    const doc = parser.parseFromString(await entry.async('string'), 'application/xml')
    const paragraphs = Array.from(doc.getElementsByTagName('*'))
      .filter(element => localName(element) === 'p')
      .map(paragraphText)
      .filter(Boolean)
    if (paragraphs.length) sections.push(paragraphs.join('\n\n'))
  }
  return sections.join('\n\n').trim()
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const pushCell = () => { row.push(cell); cell = '' }
  const pushRow = () => {
    pushCell()
    if (row.some(value => value.trim())) rows.push(row)
    row = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === ',' && !quoted) pushCell()
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      pushRow()
    } else cell += char
  }
  if (cell || row.length) pushRow()
  return rows
}

function csvText(raw: string) {
  const rows = parseCsvRows(raw)
  const rowTruncated = rows.length > MAX_CSV_ROWS
  const columnTruncated = rows.some(row => row.length > MAX_CSV_COLUMNS)
  const body = rows.slice(0, MAX_CSV_ROWS)
    .map(row => row.slice(0, MAX_CSV_COLUMNS).map(value => value.replace(/\s+/g, ' ').trim()).join(' | '))
    .join('\n')
  return [
    '### CSV',
    body,
    rowTruncated ? '[行数已截断]' : '',
    columnTruncated ? '[列数已截断]' : '',
  ].filter(Boolean).join('\n')
}

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const extension = documentExtension(file.name)
  const mimeType = MIME_BY_EXTENSION[extension]
  if (!mimeType) throw new Error(`${file.name} 不是支持的 PDF、DOCX、MD、TXT 或 CSV 文件`)
  if (file.size <= 0) throw new Error(`${file.name} 是空文件`)
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过 4MB`)

  let rawText = ''
  if (extension === 'pdf') rawText = await readPdfText(await file.arrayBuffer())
  else if (extension === 'docx') rawText = await readDocxText(await file.arrayBuffer())
  else if (extension === 'csv') rawText = csvText(await file.text())
  else rawText = await file.text()

  const limit = extension === 'csv' ? MAX_CSV_CHARS : MAX_DOCUMENT_CHARS
  const result = truncate(rawText, limit)
  if (!result.text) {
    throw new Error(`${file.name} 没有提取到可读文字；扫描版 PDF 暂不支持 OCR`)
  }
  const label = extension === 'pdf'
    ? '已从 PDF 中提取可读文字，原始排版可能会丢失。'
    : extension === 'docx'
      ? '已从 DOCX 中提取正文内容。'
      : '已读取文件正文。'
  return {
    mimeType,
    textContent: [label, result.truncated ? '内容已按体积截断。' : '', '', result.text]
      .filter(Boolean)
      .join('\n'),
    truncated: result.truncated,
  }
}
