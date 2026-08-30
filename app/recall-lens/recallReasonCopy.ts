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
  empty_query: {
    title: '本轮没有可检索内容',
    description: '消息为空或清理后没有可用于判断召回必要性的内容，因此本轮不进行长期记忆召回。',
    effect: 'info',
  },
  natural_contextual_topic: {
    title: '自然话题允许相关记忆进入',
    description: '本轮没有明确要求回忆，但包含可定位的自然话题。Shadow 会审核相关候选，没有可靠候选时仍可保持为空。',
    effect: 'info',
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
  shadow_invalid_candidate: {
    title: 'Shadow 无法读取候选',
    description: '候选缺少可识别的记忆桶数据，Shadow 无法继续判断，因此拒绝。',
    effect: 'reject',
  },
  shadow_hard_exclusion: {
    title: 'Shadow 保留正式硬排除',
    description: '候选命中了会话去重或排除域等不可软化的边界，Shadow 不会重新放行。',
    effect: 'reject',
  },
  shadow_unique_direct_evidence: {
    title: 'Shadow 命中唯一直接证据',
    description: '候选命中了明确桶 ID、可信稀有名称、身份实体或来源记录等可唯一定位的直接证据，因此选择。',
    effect: 'allow',
  },
  shadow_strong_semantic_topic: {
    title: '强语义与本轮主题一致',
    description: '候选达到强语义阈值，并且命中清理称呼后的可信主题，因此 Shadow 选择。',
    effect: 'allow',
  },
  shadow_semantic_keyword_agreement: {
    title: '语义与关键词共同支持主题',
    description: '候选同时获得足够的语义和关键词支持，并命中清理后的可信主题，因此 Shadow 选择。',
    effect: 'allow',
  },
  shadow_explicit_semantic_topic: {
    title: '明确回忆下语义命中主题',
    description: '本轮是明确回忆请求；候选具有足够语义相关性，并命中可信主题，因此 Shadow 选择。',
    effect: 'allow',
  },
  shadow_explicit_exact_topic: {
    title: '明确回忆下精确命中主题',
    description: '本轮是明确回忆请求；候选的精确锚点与清理后的可信主题一致，因此 Shadow 选择。',
    effect: 'allow',
  },
  shadow_query_unavailable_formal_topic_keyword: {
    title: '语义查询故障时保守保留正式候选',
    description: '本轮语义查询不可用，但该候选原本已在正式结果中，且关键词分和可信主题命中都达到保守降级要求，因此 Shadow 保留。',
    effect: 'degraded',
  },
  shadow_semantic_not_scored: {
    title: '候选没有可用语义分',
    description: '候选本轮没有获得语义分，且不满足受限的关键词故障降级条件，因此 Shadow 拒绝。具体原因请查看语义状态。',
    effect: 'reject',
  },
  shadow_keyword_only_without_unique_anchor: {
    title: '只有关键词，没有唯一锚点',
    description: '候选只有关键词命中，没有可靠语义或唯一直接证据；普通词碰撞不足以证明相关，因此 Shadow 拒绝。',
    effect: 'reject',
  },
  shadow_query_topic_missing: {
    title: '没有命中清理后的可信主题',
    description: '候选未命中去除日常称呼后的本轮主题。称呼或身份背景不能单独证明记忆相关，因此 Shadow 拒绝。',
    effect: 'reject',
  },
  shadow_insufficient_relevance: {
    title: 'Shadow 综合相关性不足',
    description: '候选虽然可能有部分分数或命中，但没有形成足以选择的可信主题与相关性组合。',
    effect: 'reject',
  },
  shadow_selected: {
    title: 'Shadow 已选择候选',
    description: '后端记录该候选已进入 Shadow 结果，但没有返回更具体的选择原因。',
    effect: 'allow',
  },
  shadow_utility_rejected: {
    title: '召回价值明确不足',
    description: '候选已经通过相关性审核，但 Utility 判断认为它对当前回复没有增量价值，因此不进入 Shadow 最终结果。',
    effect: 'reject',
  },
  utility_explicit_recall_expectation: {
    title: '用户明确期待回忆',
    description: '用户明确要求回忆或搜索过去；候选已经通过相关性审核，因此具有明确的当前召回价值。',
    effect: 'allow',
  },
  utility_resolves_contextual_reference: {
    title: '帮助解决当前指代',
    description: '当前消息正在接续前文，系统也取得了可用的上一轮用户上下文；这段相关记忆能帮助理解“那次、后来”等指代。',
    effect: 'allow',
  },
  utility_relevant_value_uncertain: {
    title: '相关，但增量价值暂不确定',
    description: '候选与当前自然话题相关，但本地规则无法可靠判断它会让回复更好还是显得突兀。它保持 neutral，仍有召回资格，不会默认沉默。',
    effect: 'info',
  },
  utility_exact_repetition_without_increment: {
    title: '只重复当前原句',
    description: '候选正文与用户当前原句完全相同，没有提供新的事件、背景或关系连续性，因此 Utility 拒绝。',
    effect: 'reject',
  },
  utility_invalid_candidate: {
    title: 'Utility 无法读取候选',
    description: '候选缺少可识别的记忆桶数据，无法继续判断召回价值，因此拒绝。',
    effect: 'reject',
  },
  shadow_not_selected_without_candidate_debug: {
    title: 'Shadow 未选择，逐候选原因未记录',
    description: '该桶不在 Shadow 结果中，但本条 Debug 没有对应的逐候选判断记录。页面保留真实结果，不推测具体拒绝规则。',
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
  admitted_bucket: {
    title: '正式路径已准入',
    description: '候选已经通过正式召回路径并进入可选结果；旧记录可能只保留这个通用原因。',
    effect: 'allow',
  },
  explicit_query_without_reliable_evidence: {
    title: '明确查询缺少可靠证据',
    description: '虽然本轮包含明确查询目标，但候选没有直接主题、强语义、强重排或高可信关联证据，因此拒绝。',
    effect: 'reject',
  },
  strong_rerank: {
    title: '重排模型给出强相关',
    description: '候选经过重排模型后达到强相关阈值，作为正式准入或评分证据。',
    effect: 'score',
  },
  context_only_temperature_moment: {
    title: '仅作上下文温度，不直接召回',
    description: '这条记忆只适合辅助上下文氛围，不允许作为直接召回结果注入。',
    effect: 'reject',
  },
  short_taste_query_without_taste_evidence: {
    title: '偏好短问句缺少偏好证据',
    description: '本轮像是在询问偏好，但候选没有命中对应偏好主题，也没有足够强的模型分数，因此拒绝。',
    effect: 'reject',
  },
  anchor_direct_disallowed: {
    title: '锚点计划不允许直接召回',
    description: '本轮锚点计划只允许其他路径使用该候选，不允许它直接进入正式召回结果。',
    effect: 'reject',
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
  category_overview_item_missing: {
    title: '缺少类别总览证据',
    description: '本轮按类别总览检索，但候选不是该类别的总览项，因此被正式路径拒绝。',
    effect: 'reject',
  },
  retrieval_alias_only: {
    title: '只有检索别名等弱证据',
    description: '候选命中了稳定检索别名，但没有独立的强锚点、主题或模型证据；别名命中不能单独决定注入，因此拒绝。',
    effect: 'reject',
  },
  generic_category_only: {
    title: '只有宽泛类别提示',
    description: '候选只命中了宽泛类别或词图提示，没有足够具体的直接证据，因此拒绝。',
    effect: 'reject',
  },
  weak_evidence_only: {
    title: '只有弱语义或关系提示',
    description: '候选只有语义命中或图关系等弱信号，没有正式路径认可的强证据，因此拒绝。',
    effect: 'reject',
  },
  session_hard_exclude: {
    title: '当前会话硬排除',
    description: '候选在当前会话中已被排除，通常用于避免同一记忆重复注入。',
    effect: 'reject',
  },
  semantic_session_dedupe: {
    title: '与本会话已召回记忆过于相似',
    description: '候选与当前会话近期已经使用的记忆高度相似，为避免重复注入而被拒绝。',
    effect: 'reject',
  },
  word_map_topic_evidence_missing: {
    title: '词图提示缺少主题证据',
    description: '词图把候选带入了候选池，但候选没有本轮主题证据或足够强的模型分数，因此拒绝。',
    effect: 'reject',
  },
  semantic_rescue_direct_evidence: {
    title: '语义救援找到直接证据',
    description: '候选原本被抑制，但语义救援在记忆内容中找到了与本轮主题直接对应的片段，因此重新准入。',
    effect: 'allow',
  },
  journey_domain_excluded: {
    title: '关系轨迹域被排除',
    description: '该候选属于关系轨迹域，不参与当前动态记忆召回。',
    effect: 'reject',
  },
  journal_domain_excluded: {
    title: '日记域被排除',
    description: '该候选属于日记域，不参与当前动态记忆召回。',
    effect: 'reject',
  },
  suppressed: {
    title: '正式路径未准入',
    description: '旧记录只保留了通用抑制状态，没有更具体的正式拒绝原因。',
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
  query_planner_fallback_used: {
    title: '查询规划器使用本地降级方案',
    description: '远端查询规划失败后，系统改用本地规则生成搜索计划；本轮结果可能更依赖字面线索。',
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
  title_anchor: {
    title: '标题命中具体锚点',
    description: '候选标题命中了本轮具体查询词，作为直接主题证据。',
    effect: 'score',
  },
  protected_phrase: {
    title: '命中受保护的完整短语',
    description: '候选包含查询中的完整短语，系统避免把它拆散后丢失含义。',
    effect: 'score',
  },
  entity_match: {
    title: '命中明确实体',
    description: '候选命中了查询规划器或关系边确认的明确实体。',
    effect: 'score',
  },
  identity_name_match: {
    title: '命中身份名称',
    description: '候选命中了当前配置中的身份名称；正式路径将它记录为直接证据，Shadow 还会检查可信主题。',
    effect: 'score',
  },
  source_record_exact: {
    title: '精确命中来源记录',
    description: '查询明确指向候选关联的来源记录，因此形成直接证据。',
    effect: 'score',
  },
  taste_evidence: {
    title: '命中具体偏好证据',
    description: '候选包含本轮询问的具体偏好主题。',
    effect: 'score',
  },
  category_overview_item: {
    title: '命中类别总览项',
    description: '候选是当前类别检索对应的总览记忆。',
    effect: 'score',
  },
  retrieval_alias: {
    title: '命中稳定检索别名',
    description: '查询命中了记忆维护的稳定别名。它能把候选带入检索，但单独存在时不一定足以正式注入。',
    effect: 'score',
  },
  semantic_rescue_direct_span: {
    title: '语义救援找到直接文本片段',
    description: '语义救援在候选正文中找到了与本轮主题直接对应的文本片段。',
    effect: 'score',
  },
  category_seed: {
    title: '命中类别种子词',
    description: '候选通过词图中的类别种子词获得提示；这是辅助信号，不一定能单独准入。',
    effect: 'score',
  },
  keyword_match: {
    title: '关键词与具体主题一致',
    description: '候选的关键词命中同时满足区分性锚点和本轮主题要求。',
    effect: 'score',
  },
  graph_related: {
    title: '词图或实体关系提供关联',
    description: '候选通过词图、低频词或实体关系获得关联提示；它通常需要其他主题证据共同支持。',
    effect: 'score',
  },
  raw_transcript_exact: {
    title: '精确命中原始对话',
    description: '候选与原始对话记录存在精确文本对应。',
    effect: 'score',
  },
  same_day_metadata: {
    title: '命中同日元数据',
    description: '候选的日期元数据与本轮指定日期一致。',
    effect: 'score',
  },
}

const SEMANTIC_STATUS_COPY: Record<string, RecallRuleCopy> = {
  scored: { title: '已获得语义分', description: '候选进入本轮语义 Top K，并获得可用的向量相似度分数。', effect: 'score' },
  indexed_not_in_semantic_top_k: { title: '有有效向量，但未进入语义 Top K', description: '候选向量有效，语义查询也已完成，只是本轮相似度没有排进语义候选 Top K。', effect: 'info' },
  query_timeout: { title: '查询语义超时', description: '本轮生成或搜索 query 向量超过 Gateway 等待上限，因此候选没有语义分。', effect: 'degraded' },
  query_failed: { title: '查询语义搜索失败', description: '本轮语义搜索发生异常，因此候选没有语义分。', effect: 'degraded' },
  query_embedding_unavailable: { title: '查询向量不可用', description: 'Embedding 服务没有返回可用的 query 向量，因此无法计算候选语义分。', effect: 'degraded' },
  query_embedding_failed: { title: '查询向量生成失败', description: '生成 query 向量时发生异常，因此无法计算候选语义分。', effect: 'degraded' },
  engine_disabled: { title: '语义引擎已关闭', description: '当前 Haven 配置没有启用语义引擎，本轮只使用其他检索信号。', effect: 'degraded' },
  disabled_for_request: { title: '本轮未启用语义检索', description: '语义引擎可能可用，但当前请求路径明确没有执行语义检索。', effect: 'info' },
  index_empty: { title: '语义索引为空', description: 'Embedding 索引中没有可搜索的记忆向量。', effect: 'degraded' },
  no_current_model_embeddings: { title: '没有当前模型可用的向量', description: '索引中没有与当前 embedding 模型和维度匹配的记忆向量。', effect: 'degraded' },
  embedding_missing: { title: '候选缺少向量', description: '该记忆桶没有保存 embedding，因此本轮无法获得语义分。', effect: 'degraded' },
  embedding_invalid: { title: '候选向量损坏', description: '该记忆桶保存的 embedding 无法解析，需要检查或重建向量。', effect: 'degraded' },
  embedding_stale_model_or_dimension: { title: '候选向量模型或维度已过期', description: '该记忆桶的 embedding 与当前模型或维度不一致，不能用于本轮语义检索。', effect: 'degraded' },
  embedding_status_unknown: { title: '候选向量状态未知', description: 'Haven 没有取得该候选的具体 embedding 状态。', effect: 'info' },
  legacy_unknown: { title: '旧记录未保存语义状态', description: '这条 Debug 来自旧版本，只记录了空语义分，没有保存当时的具体原因。', effect: 'info' },
}

const PLANNER_STATUS_COPY: Record<string, RecallRuleCopy> = {
  normal: { title: 'Planner 正常完成', description: '查询规划器已运行并返回可用计划。', effect: 'info' },
  degraded: { title: 'Planner 已降级', description: '查询规划器出现错误，本轮使用降级路径。', effect: 'degraded' },
  not_triggered: { title: '本轮无需调用 Planner', description: '正式路径不需要额外整理查询，因此没有触发 Planner。', effect: 'info' },
  disabled: { title: 'Planner 已关闭', description: '当前 Haven 配置没有启用查询规划器。', effect: 'degraded' },
  not_run: { title: '正式路径提前结束，Planner 未运行', description: '本轮在空查询、模糊查询或零卡片等条件下提前结束，没有进入 Planner。', effect: 'info' },
}

const FALLBACK_STRATEGY_COPY: Record<string, RecallRuleCopy> = {
  shadow_disabled: { title: 'Shadow 已关闭', description: '本轮没有执行 Phase 1 Shadow 判断。', effect: 'info' },
  necessity_none: { title: '无需召回，Shadow 结果为空', description: '召回必要性判断为 none，因此 Shadow 不审核候选并保持空结果。', effect: 'info' },
  explicit_target_missing: { title: '明确想回忆，但不扩大猜测', description: '用户有回忆意图但缺少可定位目标，Shadow 不扩大检索。', effect: 'reject' },
  conservative_no_expansion: { title: 'Planner 不可用时保守不扩召回', description: 'contextual 轮次遇到 Planner 降级、关闭或未运行时，Shadow 只允许删除正式噪声，不从额外候选新增记忆。', effect: 'degraded' },
  contextual_strict_relevance: { title: '自然话题使用严格相关性', description: 'Shadow 可以审核额外候选，但只有可信主题与强相关证据同时成立时才会选择。', effect: 'info' },
  explicit_strict_relevance_with_planner_fallback: { title: '明确回忆使用严格相关性与 Planner 降级', description: '明确回忆即使 Planner 不可用也可继续审核，但候选仍必须具有严格的直接或主题相关证据。', effect: 'info' },
}

const UTILITY_STATUS_COPY: Record<string, RecallRuleCopy> = {
  promote: {
    title: '优先召回',
    description: '系统找到了明确的当前价值；排序时优先从 promote 候选中选择。',
    effect: 'allow',
  },
  neutral: {
    title: '保留召回资格',
    description: '候选确实相关，但增量价值暂不确定。neutral 仍可被 Shadow 选择，不等于拒绝。',
    effect: 'info',
  },
  reject: {
    title: '不值得本轮召回',
    description: '系统能明确判断候选对当前回复没有增量价值，因此不进入 Shadow 最终选择。',
    effect: 'reject',
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
  if (RECALL_RULE_COPY[code]) return RECALL_RULE_COPY[code]
  if (code.startsWith('query_planner_parse_failed:')) {
    return { title: '查询规划结果解析失败', description: 'Planner 返回了内容，但 Haven 无法解析为有效查询计划。冒号后的内容是具体失败详情。', effect: 'degraded' }
  }
  if (code.startsWith('query_planner_dehydration_call_failed:')) {
    return { title: '查询意图提炼调用失败', description: 'Dehydration Planner 调用发生异常，冒号后的内容是异常类型；本轮会进入降级路径。', effect: 'degraded' }
  }
  if (code.startsWith('query_planner_call_failed:')) {
    return { title: '查询规划器调用失败', description: 'Planner 调用发生异常，冒号后的内容是异常类型；本轮会进入降级路径。', effect: 'degraded' }
  }
  const category = code.startsWith('utility_')
    ? 'Utility 判断'
    : code.startsWith('shadow_')
    ? 'Shadow 判断'
    : code.startsWith('query_planner_')
      ? '查询规划器状态'
      : code.includes('semantic') || code.includes('embedding')
        ? '语义检索状态'
        : '召回规则'
  return {
    title: `未识别的${category}：${code || '空内部码'}`,
    description: `Haven 返回了新的${category}。页面尚无专门中文解释，但已保留完整内部码；请结合正式/Shadow 结果、语义状态和证据字段判断其实际影响。`,
    effect: 'info',
  }
}

function getStatusCopy(code: string | undefined, copies: Record<string, RecallRuleCopy>, category: string): RecallRuleCopy {
  if (code && copies[code]) return copies[code]
  return {
    title: code ? `未识别的${category}：${code}` : `没有返回${category}`,
    description: code
      ? `Haven 返回了页面尚未收录的${category}。完整内部码已显示，请结合本轮其他诊断字段判断。`
      : `这条 Debug 没有保存${category}，通常是旧记录或该路径未运行。`,
    effect: 'info',
  }
}

export function getSemanticStatusCopy(code?: string): RecallRuleCopy {
  return getStatusCopy(code, SEMANTIC_STATUS_COPY, '语义状态')
}

export function getPlannerStatusCopy(code?: string): RecallRuleCopy {
  return getStatusCopy(code, PLANNER_STATUS_COPY, 'Planner 状态')
}

export function getFallbackStrategyCopy(code?: string): RecallRuleCopy {
  return getStatusCopy(code, FALLBACK_STRATEGY_COPY, 'Shadow 降级策略')
}

export function getUtilityStatusCopy(code?: string): RecallRuleCopy {
  return getStatusCopy(code, UTILITY_STATUS_COPY, 'Utility 状态')
}
