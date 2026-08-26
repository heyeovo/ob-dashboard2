export type RecallRuleEffect = 'allow' | 'reject' | 'score' | 'degraded' | 'info'

export interface RecallRuleCopy {
  title: string
  description: string
  effect: RecallRuleEffect
}

const RECALL_RULE_COPY: Record<string, RecallRuleCopy> = {
  non_explicit_query: {
    title: '非明确回忆请求仍被放行',
    description: '用户没有明确要求回忆，但系统仍认为这个候选可以注入。这是当前较宽松的放行通道。',
    effect: 'allow',
  },
  topic_evidence: {
    title: '命中当前话题证据',
    description: '候选包含系统认可的当前话题证据，因此通过准入。',
    effect: 'allow',
  },
  high_confidence_direct_edge: {
    title: '高可信直接关联',
    description: '系统找到了高可信的直接关联证据，因此允许注入。',
    effect: 'allow',
  },
  activated_axis_mismatch: {
    title: '没有命中系统提取的核心主题',
    description: '候选没有包含系统从本轮消息中提取的主题轴，因此被拒绝。主题轴提取错误时，可能误杀相关记忆。',
    effect: 'reject',
  },
  anchor_must_group_missing: {
    title: '没有满足整组必需锚点',
    description: '系统要求的一组关键词没有全部满足，因此拒绝候选。组内条件过严时，部分命中的相关记忆也会被拦截。',
    effect: 'reject',
  },
  planner_must_terms_missing: {
    title: '没有命中查询规划器的必需词',
    description: '查询规划器指定的必需词没有在候选中命中，因此候选被拒绝。',
    effect: 'reject',
  },
  discriminative_anchor_missing: {
    title: '缺少区分主题的稀有词',
    description: '候选没有覆盖系统认为最能区分主题的词，因此被拒绝。多个稀有词被要求全部命中时可能过严。',
    effect: 'reject',
  },
  auto_vague_query_without_topic: {
    title: '系统认为本轮表达太模糊',
    description: '系统无法从本轮消息中确认具体回忆主题，因此拒绝所有候选。明确回忆被错误判成模糊时会造成整轮漏召。',
    effect: 'reject',
  },
  no_hard_evidence: {
    title: '缺少系统认可的强证据',
    description: '候选虽然有一定分数，但没有关键词、锚点或其他被现有规则认可的强证据。',
    effect: 'reject',
  },
  semantic_only: {
    title: '只有语义相似',
    description: '候选主要依靠语义相似，没有关键词、锚点或其他额外支持，因此被拒绝。',
    effect: 'reject',
  },
  low_recall_evidence: {
    title: '综合召回证据不足',
    description: '系统认为候选的整体证据不够可靠，因此没有注入。',
    effect: 'reject',
  },
  session_hard_exclude: {
    title: '当前会话硬排除',
    description: '候选在当前会话中已被排除，通常用于避免同一记忆重复注入。',
    effect: 'reject',
  },
  tech_domain_without_query_anchor: {
    title: '技术记忆缺少技术主题锚点',
    description: '候选属于技术内容，但本轮消息没有明确的技术主题证据，因此被拒绝。',
    effect: 'reject',
  },
  relationship_background_without_query_topic_evidence: {
    title: '关系背景与本轮话题连接不足',
    description: '候选只是关系背景记忆，没有匹配本轮的具体话题证据，因此被拒绝。',
    effect: 'reject',
  },
  query_topic_evidence_missing: {
    title: '缺少本轮话题证据',
    description: '候选没有包含系统要求的本轮话题证据，因此被拒绝。',
    effect: 'reject',
  },
  query_planner_dehydration_unavailable: {
    title: '查询意图提炼不可用',
    description: '用于压缩和理解查询意图的规划器当前不可用，本轮正在使用降级路径。降级结果可能更依赖字面规则。',
    effect: 'degraded',
  },
  semantic_hit: {
    title: '语义检索命中',
    description: '候选在向量语义检索中与当前消息相似。这是正向证据，但不一定足以单独决定注入。',
    effect: 'score',
  },
  keyword_hit: {
    title: '关键词检索命中',
    description: '候选与当前消息存在关键词匹配。这是正向证据，但常见词或上下文无关的碰撞可能产生噪声。',
    effect: 'score',
  },
  strong_semantic: {
    title: '较强语义相似',
    description: '候选与当前消息的语义相似度较高，系统将它作为较强的正向证据。',
    effect: 'score',
  },
  distinctive_anchor: {
    title: '命中区分性锚点',
    description: '候选命中了较少见、较能区分主题的关键词。',
    effect: 'score',
  },
  exact_anchor: {
    title: '命中精确锚点',
    description: '候选命中了名称、稳定别名或其他精确定位信息。',
    effect: 'score',
  },
}

export const RECALL_EFFECT_LABEL: Record<RecallRuleEffect, string> = {
  allow: '放行',
  reject: '拒绝',
  score: '评分证据',
  degraded: '系统降级',
  info: '信息',
}

export function getRecallRuleCopy(code: string): RecallRuleCopy {
  return RECALL_RULE_COPY[code] || {
    title: '尚未收录中文说明',
    description: '这是 Haven 返回的内部规则码。当前页面还没有对应的产品语言解释。',
    effect: 'info',
  }
}
