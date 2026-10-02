import { describe, expect, it } from 'vitest'
import { editorAvailableHeight, editorGeometry } from '@/app/components/BucketContentEditor'

describe('bucket editor visual geometry', () => {
  it('keeps the reading font and width while meeting the iPhone input font minimum', () => {
    const geometry = editorGeometry(15, 64, 300)
    expect(geometry.inputFontSize).toBe(16)
    expect(geometry.inputFontSize * geometry.scale).toBe(15)
    expect(geometry.widthPercent * geometry.scale).toBe(100)
    expect(geometry.height).toBe(60)
    expect(geometry.inputHeight).toBe(64)
  })

  it('does not force a short body into a fourteen-row editor', () => {
    expect(editorGeometry(16, 30, 300).height).toBe(30)
  })

  it('caps a long body and leaves a larger scrollable content area inside the input', () => {
    const geometry = editorGeometry(15, 3000, 200)
    expect(geometry.height).toBe(200)
    expect(geometry.inputHeight).toBeCloseTo(200 / geometry.scale)
    expect(geometry.inputHeight).toBeLessThan(3000)
  })

  it('follows the reading font when appearance scaling makes it larger than 16px', () => {
    const geometry = editorGeometry(21, 150, 400)
    expect(geometry.inputFontSize).toBe(21)
    expect(geometry.scale).toBe(1)
    expect(geometry.widthPercent).toBe(100)
  })

  it('reduces available editor height when the keyboard reduces the visual viewport', () => {
    const full = editorAvailableHeight(15, 800, 800, 200)
    const keyboard = editorAvailableHeight(15, 360, 360, 150)
    expect(full).toBe(400)
    expect(keyboard).toBe(114)
  })

  it('accounts for a panned visual viewport and keeps three lines available to edit', () => {
    expect(editorAvailableHeight(15, 360, 460, 250)).toBe(114)
    expect(editorAvailableHeight(15, 360, 360, 350)).toBeCloseTo(83.25)
  })
})
