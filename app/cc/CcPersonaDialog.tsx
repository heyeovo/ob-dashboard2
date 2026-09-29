'use client'
import { useEffect, useState } from 'react'
import { TINT_PRESETS, type CcPersona } from './persona'

// 当前协作者的提示词设置。隐藏的 description / memoryEntries / semanticOn / engine
// 仍留在 draft 中，保存时原值透传。

type Props = {
  persona: CcPersona
  /** 只有一个协作者时不给删（删完界面就空了） */
  canDelete: boolean
  saving: boolean
  onSave: (persona: CcPersona) => Promise<{ ok: boolean }>
  onDelete: (id: string) => Promise<{ ok: boolean }>
  onClose: () => void
}

export default function CcPersonaDialog({
  persona,
  canDelete,
  saving,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<CcPersona>(persona)
  const [dirInput, setDirInput] = useState('')
  const [writeDirInput, setWriteDirInput] = useState('')
  const [editingPromptModuleId, setEditingPromptModuleId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hint, setHint] = useState('')

  // 草稿只在挂载时从 persona 取一次。换协作者靠 page 那边给 key，整个弹窗重挂 ——
  // 用 effect 同步会触发 cascading render（eslint react-hooks/set-state-in-effect）。

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = <K extends keyof CcPersona>(key: K, value: CcPersona[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
    setHint('')
  }

  const addPromptModule = () => {
    const id = `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    patch('promptModules', [
      ...draft.promptModules,
      { id, name: '新模块', content: '', enabledByDefault: true },
    ])
    setEditingPromptModuleId(id)
  }

  const updatePromptModule = (
    id: string,
    changes: Partial<CcPersona['promptModules'][number]>,
  ) => {
    patch('promptModules', draft.promptModules.map(module =>
      module.id === id ? { ...module, ...changes } : module,
    ))
  }

  const movePromptModule = (id: string, direction: -1 | 1) => {
    const index = draft.promptModules.findIndex(module => module.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= draft.promptModules.length) return
    const next = [...draft.promptModules]
    ;[next[index], next[target]] = [next[target], next[index]]
    patch('promptModules', next)
  }

  const addDir = () => {
    const text = dirInput.trim()
    if (!text) return
    if (draft.dirs.includes(text)) {
      setDirInput('')
      return
    }
    patch('dirs', [...draft.dirs, text])
    setDirInput('')
  }

  const addWriteDir = () => {
    const text = writeDirInput.trim()
    if (!text) return
    if (draft.writeDirs.includes(text)) {
      setWriteDirInput('')
      return
    }
    patch('writeDirs', [...draft.writeDirs, text])
    setWriteDirInput('')
  }

  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      setHint('名字不能为空')
      return
    }
    const cleaned: CcPersona = {
      ...draft,
      name,
      initial: (draft.initial.trim() || name).slice(0, 2),
      promptModules: draft.promptModules.flatMap((module, index) => {
        const content = module.content.trim()
        if (!content) return []
        return [{
          ...module,
          id: module.id.trim() || `module-${index + 1}`,
          name: module.name.trim() || '未命名模块',
          content,
        }]
      }),
    }
    const res = await onSave(cleaned)
    setHint(res.ok ? '已保存' : '保存失败，看页面顶部的错误')
    if (res.ok) setDraft(cleaned)
  }

  return (
    <div className="cc-modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0" />
      {/* 弹窗限制在视口内，长内容由中段滚动，底部保存按钮保持可见。 */}
      <div className="cc-modal relative flex max-h-[86vh] w-full max-w-lg flex-col">
        {/* 头 */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-light)] px-5 py-3.5">
          <span className="cc-avatar" style={{ background: draft.tint }} aria-hidden="true">
            {draft.initial}
          </span>
          <div className="min-w-0">
            <div className="truncate text-xl text-[var(--color-text-heading)]" style={{ fontFamily: 'var(--font-display)' }}>
              {draft.name || '未命名'}
            </div>
            <div className="mt-0.5 text-meta text-[var(--color-text-disabled)]">协作者设置</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-meta text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            关闭
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-4" aria-labelledby="cc-persona-identity">
              <h2 id="cc-persona-identity" className="text-meta font-semibold tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">身份</h2>
              <label className="cc-field">
                <span className="cc-field-label">名字</span>
                <input
                  className="cc-input"
                  value={draft.name}
                  onChange={e => patch('name', e.target.value)}
                  placeholder="比如 Ombre"
                />
              </label>

              <div className="cc-field">
                <span className="cc-field-label">头像</span>
                <div className="flex items-center gap-2.5">
                  <input
                    className="cc-input w-14 text-center"
                    value={draft.initial}
                    maxLength={2}
                    onChange={e => patch('initial', e.target.value)}
                    aria-label="头像上的字"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {TINT_PRESETS.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        aria-label={t.label}
                        title={t.label}
                        onClick={() => patch('tint', t.value)}
                        className={`cc-tint-dot${draft.tint === t.value ? ' active' : ''}`}
                        style={{ background: t.value }}
                      />
                    ))}
                  </div>
                </div>
                <span className="cc-field-hint">上传图片头像等第 7 步，现在是字 + 底色</span>
              </div>

              <label className="cc-field">
                <span className="text-meta text-[var(--color-text-secondary)]">你的称呼</span>
                <input
                  className="cc-input"
                  value={draft.userName}
                  onChange={e => patch('userName', e.target.value)}
                  placeholder="TA 该怎么叫你"
                />
                <span className="cc-field-hint">会写进提示词，留空就不提</span>
              </label>

              <label className="cc-field">
                <span className="cc-field-label">协作者定位</span>
                <textarea
                  className="cc-textarea"
                  rows={3}
                  value={draft.purpose}
                  onChange={e => patch('purpose', e.target.value)}
                  placeholder="TA 为什么在这里，以怎样的身份存在？"
                />
                <span className="cc-field-hint">会写进提示词的「关于我」</span>
              </label>

              {canDelete ? (
                <div className="border-t border-[var(--color-border-light)] pt-3.5">
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-meta text-[var(--color-text-secondary)]">
                        删掉「{draft.name}」？历史对话会保留
                      </span>
                      <button
                        type="button"
                        className="cc-btn-danger"
                        onClick={() => void onDelete(draft.id).then(r => r.ok && onClose())}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="cc-btn-ghost"
                        onClick={() => setConfirmDelete(false)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="cc-btn-ghost" onClick={() => setConfirmDelete(true)}>
                      删除这个协作者
                    </button>
                  )}
                </div>
              ) : null}
          </section>

          <section className="mt-6 flex flex-col gap-3 border-t border-[var(--color-border-light)] pt-5" aria-labelledby="cc-persona-prompt">
              <h2 id="cc-persona-prompt" className="text-meta font-semibold tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">提示词</h2>
              <label className="cc-field">
                <span className="cc-field-label">基础提示词</span>
                <span className="cc-field-hint">每个协作者独立保存，会放在 system 的最前面；允许留空。</span>
                <textarea
                  className="cc-textarea font-mono"
                  rows={6}
                  value={draft.basePrompt}
                  onChange={event => patch('basePrompt', event.target.value)}
                  placeholder="填写这个协作者始终需要遵守的基础说明"
                />
              </label>
              <div className="border-t border-[var(--color-border-light)]" />
              {editingPromptModuleId ? (() => {
                const promptModule = draft.promptModules.find(item => item.id === editingPromptModuleId)
                if (!promptModule) return null
                return (
                  <div className="flex flex-col gap-4">
                    <button type="button" className="w-fit text-sm text-[var(--color-text-secondary)]" onClick={() => setEditingPromptModuleId(null)}>
                      ← 返回模块列表
                    </button>
                    <label className="cc-field">
                      <span className="cc-field-label">模块名称</span>
                      <input className="cc-input" value={promptModule.name} onChange={event => updatePromptModule(promptModule.id, { name: event.target.value })} placeholder="例如：互动规则" />
                    </label>
                    <label className="cc-field">
                      <span className="cc-field-label">提示词内容</span>
                      <textarea className="cc-textarea font-mono" rows={14} value={promptModule.content} onChange={event => updatePromptModule(promptModule.id, { content: event.target.value })} placeholder="这段内容会作为独立模块加入 system。" />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                      <input type="checkbox" checked={promptModule.enabledByDefault} onChange={event => updatePromptModule(promptModule.id, { enabledByDefault: event.target.checked })} />
                      新窗口默认开启
                    </label>
                    <button
                      type="button"
                      className="cc-btn-ghost w-fit text-[var(--color-danger)]"
                      onClick={() => {
                        patch('promptModules', draft.promptModules.filter(item => item.id !== promptModule.id))
                        setEditingPromptModuleId(null)
                      }}
                    >
                      删除这个模块
                    </button>
                  </div>
                )
              })() : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="cc-field-label">提示词模块</div>
                      <div className="mt-1 text-meta text-[var(--color-text-tertiary)]">默认开启的模块会用于每个新窗口</div>
                    </div>
                    <button type="button" className="cc-btn-ghost" onClick={addPromptModule}>＋ 新增</button>
                  </div>
                  {draft.promptModules.length === 0 ? (
                    <div className="cc-recall-empty">还没有提示词模块</div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {draft.promptModules.map((module, index) => (
                        <div key={module.id} className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-3.5">
                          <button type="button" className="w-full text-left" onClick={() => setEditingPromptModuleId(module.id)}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-[var(--color-text-heading)]">{module.name || '未命名模块'}</div>
                                <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[var(--color-text-secondary)]">{module.content || '还没有内容'}</div>
                              </div>
                              <span className="shrink-0 text-[var(--color-text-tertiary)]">›</span>
                            </div>
                          </button>
                          <div className="mt-3 flex items-center border-t border-[var(--color-border-light)] pt-2.5">
                            <button type="button" disabled={index === 0} className="cc-btn-ghost px-2 disabled:opacity-30" onClick={() => movePromptModule(module.id, -1)} aria-label="上移">↑</button>
                            <button type="button" disabled={index === draft.promptModules.length - 1} className="cc-btn-ghost px-2 disabled:opacity-30" onClick={() => movePromptModule(module.id, 1)} aria-label="下移">↓</button>
                            <label className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                              <input type="checkbox" checked={module.enabledByDefault} onChange={event => updatePromptModule(module.id, { enabledByDefault: event.target.checked })} />
                              默认开启
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="cc-note">模块会进入 system，不会拼进用户原话。聊天里的「＋」只覆盖当前窗口，其他窗口仍使用这里的默认状态。</p>
                </>
              )}
          </section>

          <section className="mt-6 flex flex-col gap-4 border-t border-[var(--color-border-light)] pt-5" aria-labelledby="cc-persona-memory">
              <h2 id="cc-persona-memory" className="text-meta font-semibold tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">记忆</h2>
              <div>
                <label className="cc-toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.recallOn}
                    onChange={e => patch('recallOn', e.target.checked)}
                  />
                  <span>
                    <span className="cc-field-label">注入 OB 记忆</span>
                    <span className="cc-field-hint">
                      关掉之后每轮不再查 Haven，回复下方的召回按钮也不出现
                    </span>
                  </span>
                </label>
              </div>
          </section>
          <section className="mt-6 flex flex-col gap-4 border-t border-[var(--color-border-light)] pt-5" aria-labelledby="cc-persona-directories">
            <div>
              <h2 id="cc-persona-directories" className="text-meta font-semibold tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">目录</h2>
              <p className="cc-field-hint mt-1">以后搬去工作台</p>
            </div>
              <div className="cc-field">
                <span className="cc-field-label">能访问哪些目录</span>
                <span className="cc-field-hint">
                  一行一个绝对路径。第一个当工作目录，其余是附加目录。
                  留空就只有看板仓库本身。
                </span>
                <div className="mt-2 flex flex-col gap-1.5">
                  {draft.dirs.length === 0 ? (
                    <div className="cc-recall-empty">没配，就只能读看板仓库</div>
                  ) : (
                    draft.dirs.map((dir, i) => (
                      <div key={`${i}-${dir.slice(-12)}`} className="cc-entry-row">
                        <span className="min-w-0 flex-1 break-all font-mono text-meta">{dir}</span>
                        <button
                          type="button"
                          aria-label="删掉这个目录"
                          className="cc-entry-del"
                          onClick={() => patch('dirs', draft.dirs.filter((_, idx) => idx !== i))}
                        >
                          删
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="cc-input flex-1 font-mono text-meta"
                    value={dirInput}
                    onChange={e => setDirInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addDir()
                      }
                    }}
                    placeholder="C:\\Users\\yangh\\OneDrive\\Desktop\\Ombre-Brain"
                  />
                  <button type="button" className="cc-btn-ghost" onClick={addDir}>
                    添加
                  </button>
                </div>
                <p className="cc-note mt-2">
                  密钥类文件（<code>.env</code>、<code>*.key</code>、<code>id_rsa</code>、
                  <code>.ssh/</code> 这些）<b>跟这份清单无关，永远读不到</b> ——
                  服务端按文件名硬拦，没有开关。要给 TA 看里面的值，你自己贴进对话。
                </p>
              </div>

              {/* 写权限（第 5 步）。故意跟上面那份分开：读可以宽，写必须窄 */}
              <div className="cc-field border-t border-[var(--color-border-light)] pt-3.5">
                <span className="cc-field-label">能改哪些目录里的文件</span>
                <span className="cc-field-hint">
                  跟上面那份规则相反：<b>留空 = 一个文件都不能改</b>。
                  只填你现在真的在做的那个项目。
                </span>
                <div className="mt-2 flex flex-col gap-1.5">
                  {draft.writeDirs.length === 0 ? (
                    <div className="cc-recall-empty">没配，所以现在只能看不能改</div>
                  ) : (
                    draft.writeDirs.map((dir, i) => (
                      <div key={`w${i}-${dir.slice(-12)}`} className="cc-entry-row">
                        <span className="min-w-0 flex-1 break-all font-mono text-meta">{dir}</span>
                        <button
                          type="button"
                          aria-label="删掉这个目录"
                          className="cc-entry-del"
                          onClick={() =>
                            patch('writeDirs', draft.writeDirs.filter((_, idx) => idx !== i))
                          }
                        >
                          删
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="cc-input flex-1 font-mono text-meta"
                    value={writeDirInput}
                    onChange={e => setWriteDirInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addWriteDir()
                      }
                    }}
                    placeholder="C:\\Users\\yangh\\OneDrive\\Desktop\\ob-dashboard2"
                  />
                  <button type="button" className="cc-btn-ghost" onClick={addWriteDir}>
                    添加
                  </button>
                </div>
                <p className="cc-note mt-2">
                  这份清单管的是「哪些地方<b>可以</b>被批准」，不是「不用问了」——
                  每次改文件都会在聊天页弹一张卡片，写着改哪个文件、改成什么样，点了才动。
                  <br />
                  跑命令（build、git status 这些）<b>每一条都要单独点</b>，
                  没有「都放行」——命令能干的事没有边界。
                  <br />
                  改完这两份清单要<b>开新对话</b>才生效。
                </p>
              </div>

          </section>
        </div>

        {/* 底 */}
        <div className="flex items-center gap-3 border-t border-[var(--color-border-light)] px-5 py-3">
          <span className="text-meta text-[var(--color-text-disabled)]">{hint}</span>
          <button
            type="button"
            className="cc-btn-primary ml-auto"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
