import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CcMarkdown from '@/app/cc/CcMarkdown'

describe('CcMarkdown 中文粗体', () => {
  it('解析中文句号后闭合、紧接汉字的粗体', () => {
    const html = renderToStaticMarkup(createElement(CcMarkdown, {
      text: '**等衣服洗完、晾好，就去睡。**然后休息。',
    }))
    expect(html).toContain('<strong>等衣服洗完、晾好，就去睡。</strong>然后休息。')
    expect(html).not.toContain('**')
  })
})
