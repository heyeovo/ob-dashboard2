export type RecallRuleEffect = 'allow' | 'reject' | 'score' | 'degraded' | 'info'

export interface RecallRuleCopy {
  title: string
  description: string
  effect: RecallRuleEffect
}

const RECALL_RULE_COPY: Record<string, RecallRuleCopy> = {
  no_recall_need: {
    title: '本轮不需要翻旧记忆',
    description: '当前消息可以独立回答，没有明确回忆请求或必须依赖长期记忆的指代。',
    effect: 'info',
  },
  recall_meta_discussion: {
    title: '正在讨论召回机制',
    description: '用户是在评价召回规则或误召问题，不是在要求系统寻找一段旧记忆。',
    effect: 'info',
  },
  explicit_recall_request: {
    title: '用户明确要求回忆',
    description: '本轮明确出现了记得、上次、之前等回忆意图，shadow 会积极执行直接检索。',
    effect: 'allow',
  },
  explicit_memory_search: {
    title: '用户明确要求搜索记忆',
    description: '本轮明确要求寻找或单独搜索某件事，不能被错误的模糊或主题轴判断整轮拦截。',
    effect: 'allow',
  },
  explicit_target_present: {
    title: '回忆目标可以定位',
    description: '消息中包含名称、事件、时间或其他可用于直接检索的目标。',
    effect: 'score',
  },
  explicit_target_missing: {
    title: '明确想回忆，但没有说明目标',
    description: '系统知道用户想回忆，但没有足够信息定位具体记忆，因此不会扩大搜索乱猜。',
    effect: 'reject',
  },
  contextual_reference: {
    title: '当前消息依赖前文指代',
    description: '消息没有直接提出搜索，但“后来呢、那件事”等表达需要结合最近上下文理解。',
    effect: 'info',
  },
  recent_context_available: {
    title: '存在可用的最近上下文',
    description: '系统找到了上一条有效用户消息，可用于确认当前指代是否需要长期记忆。',
    effect: 'score',
  },
  contextual_reference_without_context: {
    title: '有指代表达，但缺少上下文',
    description: '当前表达像是在接续前文，但系统没有可用的最近上下文，因此不会扩大召回。',
    effect: 'reject',
  },
  shadow_explicit_soft_gate: {
    title: 'Shadow 软化了查询形状误杀',
    description: '候选原本被模糊、主题轴或锚点规则拒绝；明确回忆请求下，shadow 将该规则降为软证据后重新比较。',
    effect: 'score',
  },
  shadow_direct_candidate: {
    title: 'Shadow 直接检索候选',
    description: '正式路径提前结束后，shadow 只使用现有直接检索通道生成候选，不影响正式注入。',
    effect: 'score',
  },
  shadow_insufficient_positive_evidence: {
    title: '软化误杀后仍缺少正向证据',
    description: '即使不让模糊或主题轴一票否决，这个候选仍没有足够可靠的直接证据，因此 shadow 也不选择。',
    effect: 'reject',
  },
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
