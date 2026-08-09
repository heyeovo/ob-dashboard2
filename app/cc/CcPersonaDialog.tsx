'use client'
import { useEffect, useState } from 'react'
import { ENGINE_OPTIONS, TINT_PRESETS, type CcEngine, type CcPersona } from './persona'

// 当前协作者的设置（对话列表**右上角**点开的那个）。4 个子 tab。
//
// 组织方式照 Polaris 的协作者信息页，但只留 cc 引擎下真会生效的项：
//   身份    头像 / 名字 / 印象 / 你的称呼 / 协作者定位
//   提示词  可独立维护、排序和默认启停的 systemPrompt 模块
//   记忆    手写记忆条目 + 两个召回开关
//   引擎    订阅 / 中转站 / 自建（自建是第 7 步，灰着）
//
// Polaris 那页里的温度、top_p、max_tokens、provider 清单、自定义 headers/body
// **这里没有** —— claude code 自己组装请求，SDK 不给这些参数。等第 7 步自建引擎回来。
// 模型选择和 MCP 归主页侧边栏；主题字体归 UI 设置工具。都是用户定的分工。

type TabKey = 'identity' | 'prompt' | 'memory' | 'engine'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'identity', label: '身份' },
  { key: 'prompt', label: '提示词' },
  { key: 'memory', label: '记忆' },
  { key: 'engine', label: '引擎' },
]

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
  const [tab, setTab] = useState<TabKey>('identity')
  const [draft, setDraft] = useState<CcPersona>(persona)
  const [entryInput, setEntryInput] = useState('')
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

  const addEntry = () => {
    const text = entryInput.trim()
    if (!text) return
    patch('memoryEntries', [...draft.memoryEntries, text])
    setEntryInput('')
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
      setTab('identity')
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
      <div className="cc-modal relative flex max-h-[86vh] w-full max-w-lg flex-col">
        {/* 头 */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-light)] px-5 py-3.5">
          <span className="cc-avatar" style={{ background: draft.tint }} aria-hidden="true">
            {draft.initial}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[var(--color-text-heading)]">
              {draft.name || '未命名'}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">协作者设置</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            关闭
          </button>
        </div>

        {/* 子 tab */}
        <div className="flex gap-1 border-b border-[var(--color-border-light)] px-4 py-2">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`cc-subtab${tab === t.key ? ' active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {tab === 'identity' ? (
            <div className="flex flex-col gap-4">
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
                <span className="cc-field-label">印象</span>
                <input
                  className="cc-input"
                  value={draft.description}
                  onChange={e => patch('description', e.target.value)}
                  placeholder="一句话，只在协作者列表里显示"
                />
              </label>

              <label className="cc-field">
                <span className="cc-field-label">你的称呼</span>
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
              </label>

              <div className="cc-field border-t border-[var(--color-border-light)] pt-3.5">
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
                        <span className="min-w-0 flex-1 break-all font-mono text-[11px]">{dir}</span>
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
                    className="cc-input flex-1 font-mono text-[11px]"
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
                        <span className="min-w-0 flex-1 break-all font-mono text-[11px]">{dir}</span>
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
                    className="cc-input flex-1 font-mono text-[11px]"
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

              {canDelete ? (
                <div className="border-t border-[var(--color-border-light)] pt-3.5">
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--color-text-secondary)]">
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
            </div>
          ) : null}

          {tab === 'prompt' ? (
            <div className="flex flex-col gap-3">
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
                const module = draft.promptModules.find(item => item.id === editingPromptModuleId)
                if (!module) return null
                return (
                  <div className="flex flex-col gap-4">
                    <button type="button" className="w-fit text-sm text-[var(--color-text-secondary)]" onClick={() => setEditingPromptModuleId(null)}>
                      ← 返回模块列表
                    </button>
                    <label className="cc-field">
                      <span className="cc-field-label">模块名称</span>
                      <input className="cc-input" value={module.name} onChange={event => updatePromptModule(module.id, { name: event.target.value })} placeholder="例如：互动规则" />
                    </label>
                    <label className="cc-field">
                      <span className="cc-field-label">提示词内容</span>
                      <textarea className="cc-textarea font-mono" rows={14} value={module.content} onChange={event => updatePromptModule(module.id, { content: event.target.value })} placeholder="这段内容会作为独立模块加入 system。" />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                      <input type="checkbox" checked={module.enabledByDefault} onChange={event => updatePromptModule(module.id, { enabledByDefault: event.target.checked })} />
                      新窗口默认开启
                    </label>
                    <button
                      type="button"
                      className="cc-btn-ghost w-fit text-[var(--color-danger)]"
                      onClick={() => {
                        patch('promptModules', draft.promptModules.filter(item => item.id !== module.id))
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
                      <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">默认开启的模块会用于每个新窗口</div>
                    </div>
                    <button type="button" className="cc-btn-ghost" onClick={addPromptModule}>＋ 新增</button>
                  </div>
                  {draft.promptModules.length === 0 ? (
                    <div className="cc-recall-empty">还没有提示词模块</div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {draft.promptModules.map((module, index) => (
                        <div key={module.id} className="rounded-2xl border border-[var(--color-border-light)] bg-white p-3.5">
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
            </div>
          ) : null}

          {tab === 'memory' ? (
            <div className="flex flex-col gap-4">
              <div className="cc-field">
                <span className="cc-field-label">记忆条目</span>
                <span className="cc-field-hint">
                  手写的固定事实，每轮都跟提示词一起送过去。跟 OB 记忆桶是两件事 ——
                  这里是你钉死的，那边是自动召回的。
                </span>
                <div className="mt-2 flex flex-col gap-1.5">
                  {draft.memoryEntries.length === 0 ? (
                    <div className="cc-recall-empty">还没有条目</div>
                  ) : (
                    draft.memoryEntries.map((entry, i) => (
                      <div key={`${i}-${entry.slice(0, 8)}`} className="cc-entry-row">
                        <span className="min-w-0 flex-1 break-words">{entry}</span>
                        <button
                          type="button"
                          aria-label="删掉这条"
                          className="cc-entry-del"
                          onClick={() =>
                            patch(
                              'memoryEntries',
                              draft.memoryEntries.filter((_, idx) => idx !== i),
                            )
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
                    className="cc-input flex-1"
                    value={entryInput}
                    onChange={e => setEntryInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addEntry()
                      }
                    }}
                    placeholder="加一条，回车确认"
                  />
                  <button type="button" className="cc-btn-ghost" onClick={addEntry}>
                    添加
                  </button>
                </div>
              </div>

              <div className="border-t border-[var(--color-border-light)] pt-3.5">
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
                <label className="cc-toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.semanticOn}
                    disabled={!draft.recallOn}
                    onChange={e => patch('semanticOn', e.target.checked)}
                  />
                  <span>
                    <span className="cc-field-label">语义检索</span>
                    <span className="cc-field-hint">
                      开着单次约 4-6 秒、召回更全；关掉只做关键词匹配，快但会漏
                    </span>
                  </span>
                </label>
              </div>
            </div>
          ) : null}

          {tab === 'engine' ? (
            <div className="flex flex-col gap-2.5">
              {ENGINE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => patch('engine', opt.id as CcEngine)}
                  className={`cc-engine-card${draft.engine === opt.id ? ' active' : ''}${
                    opt.disabled ? ' disabled' : ''
                  }`}
                >
                  <span className="cc-engine-radio" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-[var(--color-text-primary)]">
                      {opt.label}
                      {opt.disabled ? (
                        <span className="ml-1.5 rounded-full bg-[var(--color-surface-tertiary)] px-1.5 py-px text-[10px] text-[var(--color-text-tertiary)]">
                          第 7 步
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                      {opt.hint}
                    </span>
                  </span>
                </button>
              ))}
              <p className="cc-note">
                改引擎<b>新对话</b>一定生效，老对话同上（看后台进程还在不在）。额度是启动参数，
                中途换要重起进程、丢上下文，所以不做热切。
                <br />
                模型选择在主页侧边栏，不在这里。
              </p>
            </div>
          ) : null}
        </div>

        {/* 底 */}
        <div className="flex items-center gap-3 border-t border-[var(--color-border-light)] px-5 py-3">
          <span className="text-[11px] text-[var(--color-text-disabled)]">{hint}</span>
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
