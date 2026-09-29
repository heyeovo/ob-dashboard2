import { describe, expect, it } from 'vitest'
import {
  CC_DRAFTS_KEY,
  ccReturnHref,
  loadCcDrafts,
  rememberCcReturnSession,
  saveCcDrafts,
} from '../app/cc/ccNavMemory'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

describe('cc return target', () => {
  it('returns to the remembered conversation', () => {
    const storage = memoryStorage()
    rememberCcReturnSession(storage, 'ob2-20260929-abc')
    expect(ccReturnHref(storage)).toBe('/cc?session_id=ob2-20260929-abc')
  })

  it('returns to the list when left from the list', () => {
    const storage = memoryStorage()
    rememberCcReturnSession(storage, 'ob2-20260929-abc')
    rememberCcReturnSession(storage, '')
    expect(ccReturnHref(storage)).toBe('/cc')
  })

  it('falls back to the list when storage throws', () => {
    const broken = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    rememberCcReturnSession(broken, 'x')
    expect(ccReturnHref(broken)).toBe('/cc')
  })
})

describe('cc drafts', () => {
  it('round-trips drafts and drops empty ones', () => {
    const storage = memoryStorage()
    saveCcDrafts(storage, new Map([['a', '打到一半'], ['b', '']]))
    expect([...loadCcDrafts(storage)]).toEqual([['a', '打到一半']])
  })

  it('removes the key when nothing is left', () => {
    const storage = memoryStorage()
    saveCcDrafts(storage, new Map([['a', 'x']]))
    saveCcDrafts(storage, new Map())
    expect(storage.data.has(CC_DRAFTS_KEY)).toBe(false)
  })

  it('keeps only the 30 most recent drafts', () => {
    const storage = memoryStorage()
    const drafts = new Map(Array.from({ length: 35 }, (_, i) => [`s${i}`, `d${i}`] as [string, string]))
    saveCcDrafts(storage, drafts)
    const loaded = loadCcDrafts(storage)
    expect(loaded.size).toBe(30)
    expect(loaded.has('s0')).toBe(false)
    expect(loaded.get('s34')).toBe('d34')
  })

  it('ignores corrupted storage', () => {
    const storage = memoryStorage()
    storage.setItem(CC_DRAFTS_KEY, '{not json')
    expect(loadCcDrafts(storage).size).toBe(0)
    storage.setItem(CC_DRAFTS_KEY, '["a"]')
    expect(loadCcDrafts(storage).size).toBe(0)
  })
})
