/**
 * 画像（Portrait / Profile）模块的 TS 类型。
 *
 * 字段名与 Haven server.py 的画像接口一一对应：
 *   GET /api/portrait-state          → PortraitStatePayload
 *   GET /api/profile-facts           → ProfileFact
 *   POST /api/profile-fact-proposals → ProfileFactProposal
 *   POST /api/anchor-proposals       → AnchorProposal
 * 空态一律 `|| ''` / `|| []` 兜底，后端可能缺字段或整个 scope。
 */

/** 画像时间线 / 候选 / staging / recent buffer 里的通用行条目 */
export interface PortraitRow {
  text?: string
  summary?: string
  fact?: string
  reason?: string
  scope?: string
  status?: string
  profile_kind?: string
  predicate?: string
  object?: string
  confidence?: number
  count?: number
  time_label?: string
  source_dates?: string[]
  source_date?: string
  last_seen_date?: string
  updated_at?: string
  created_at?: string
  evidence?: PortraitEvidence[]
  [key: string]: unknown
}

export interface PortraitEvidence {
  bucket_id?: string
  moment_id?: string
  session_id?: string
  name?: string
  exists?: boolean
}

export interface PortraitStableHistoryRow {
  revision?: number
  text?: string
  source?: string
  updated_at?: string
}

/** 单个 portrait scope（user / persona / relationship）的状态 */
export interface PortraitScopeState {
  stable?: string
  stable_revision?: number
  stable_locked?: boolean
  stable_source?: string
  stable_updated_at?: string
  stable_history?: PortraitStableHistoryRow[]
  mid_term?: string
  mid_term_evidence?: PortraitEvidence[]
  mid_term_source_dates?: string[]
  mid_term_source_date?: string
  mid_term_updated_at?: string
  staging_pool?: PortraitRow[]
  recent_buffer?: PortraitRow[]
}

export interface SelfAnchorEntry {
  bucket_id?: string
  name?: string
  text?: string
  configured?: boolean
  updated_at?: string
}

export interface PortraitStatePayload {
  state_path?: string
  enabled?: boolean
  auto_enabled?: boolean
  auto_initial_enabled?: boolean
  daily_enabled?: boolean
  updated_at?: string
  last_run_date?: string
  portrait?: {
    user?: PortraitScopeState
    persona?: PortraitScopeState
    relationship?: PortraitScopeState
  }
  recent_activities?: PortraitRow[]
  recent_timeline?: PortraitRow[]
  current_focus?: string
  stable_candidates?: PortraitRow[]
  profile_fact_candidates?: PortraitRow[]
  self_anchor_entry?: SelfAnchorEntry
}

export type PortraitScope = 'user' | 'persona' | 'relationship'

export interface ProfileFact {
  id?: string
  name?: string
  fact?: string
  sections?: {
    fact?: string
    evidence_context?: string
    reflection?: string
    followup?: string
  }
  kind?: string
  subject?: string
  predicate?: string
  object?: string
  evidence?: PortraitEvidence[]
  confidence?: number
  source?: string
  active?: boolean
  deprecated?: boolean
  state?: string
  tags?: string[]
  created?: string
  updated_at?: string
  last_active?: string
  content_preview?: string
}

export interface ProfileFactProposal {
  profile_kind?: string
  subject?: string
  predicate?: string
  object?: string
  confidence?: number
  fact?: string
  reason?: string
  evidence_bucket_id?: string
  evidence_moment_id?: string
}

export interface AnchorProposal {
  bucket_id?: string
  anchor_kind?: string
  confidence?: number
  reason?: string
  future_use?: string
}

/** portrait-state/items 的删除规格：时间线/候选用 area+index+text，画像层用 area+scope+layer+text */
export interface PortraitDeleteSpec {
  area: string
  scope?: string
  layer?: string
  index?: number
  text?: string
}
