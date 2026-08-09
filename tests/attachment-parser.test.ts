import { describe, expect, it } from 'vitest'
import { documentExtension, isSupportedDocument, parseDocument } from '@/app/lib/attachments/documentParser'

describe('窗口文件解析', () => {
  it('只识别第一版允许的文件扩展名', () => {
    expect(documentExtension('说明.DOCX')).toBe('docx')
    expect(isSupportedDocument(new File(['hello'], 'notes.md', { type: 'text/markdown' }))).toBe(true)
    expect(isSupportedDocument(new File(['hello'], 'sheet.xlsx'))).toBe(false)
  })

  it('读取 TXT，并把 CSV 转成受限表格文本', async () => {
    const text = await parseDocument(new File(['第一行\n第二行'], 'notes.txt', { type: 'text/plain' }))
    expect(text.textContent).toContain('第一行\n第二行')
    expect(text.truncated).toBe(false)

    const csv = await parseDocument(new File(['姓名,备注\n小羊,"两行\n内容"'], 'people.csv', { type: 'text/csv' }))
    expect(csv.textContent).toContain('姓名 | 备注')
    expect(csv.textContent).toContain('小羊 | 两行 内容')
  })
})
