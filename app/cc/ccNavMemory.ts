// 手机端离开 /cc 再回来时要记住的两样界面状态（2026-09-29）。
//
// 1. 回到哪：从某个对话切到别的 Tab，点「聊天」回到那个对话；从列表切走就回列表。
//    存 sessionStorage：只管这次打开 app 期间，杀掉重开照旧从列表开始。
// 2. 草稿：每个对话打到一半的字，切页面、关掉重开都还在，发出去就清掉。
//    存 localStorage：换设备丢了也无所谓的界面偏好，不进 Haven。
//
// 函数都接收 Storage 参数，方便在 node 环境里测。

export const CC_RETURN_SESSION_KEY = 'ob2-cc-return-session'
export const CC_DRAFTS_KEY = 'ob2-cc-drafts'
const MAX_DRAFTS = 30

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function rememberCcReturnSession(storage: KeyValueStorage, sessionId: string) {
  try {
    if (sessionId) storage.setItem(CC_RETURN_SESSION_KEY, sessionId)
    else storage.removeItem(CC_RETURN_SESSION_KEY)
  } catch {
    /* 隐私模式写不了，回聊天时退回列表 */
  }
}

export function ccReturnHref(storage: KeyValueStorage): string {
  try {
    const sessionId = storage.getItem(CC_RETURN_SESSION_KEY)?.trim() || ''
    if (sessionId && sessionId.length <= 200) return `/cc?session_id=${encodeURIComponent(sessionId)}`
  } catch {
    /* 同上 */
  }
  return '/cc'
}

export function loadCcDrafts(storage: KeyValueStorage): Map<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CC_DRAFTS_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    return new Map(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''),
    )
  } catch {
    return new Map()
  }
}

// Map 保留插入顺序；超过上限时丢最早写入的那些。
export function saveCcDrafts(storage: KeyValueStorage, drafts: Map<string, string>) {
  const kept = [...drafts].filter(([id, text]) => id && text).slice(-MAX_DRAFTS)
  try {
    if (kept.length === 0) storage.removeItem(CC_DRAFTS_KEY)
    else storage.setItem(CC_DRAFTS_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    /* 存满或隐私模式：草稿只留在内存里 */
  }
}
