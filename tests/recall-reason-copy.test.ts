import { describe, expect, it } from 'vitest'
import {
  getFallbackStrategyCopy,
  getPlannerStatusCopy,
  getRecallRuleCopy,
  getSemanticStatusCopy,
} from '@/app/recall-lens/recallReasonCopy'

const necessityReasons = [
  'empty_query',
  'recall_meta_discussion',
  'explicit_memory_search',
  'explicit_recall_request',
  'explicit_target_present',
  'explicit_target_missing',
  'contextual_reference',
  'recent_context_available',
  'contextual_reference_without_context',
  'natural_contextual_topic',
  'no_recall_need',
]

const formalAdmissionReasons = [
  'admitted_bucket',
  'non_explicit_query',
  'topic_evidence',
  'strong_semantic',
  'strong_rerank',
  'high_confidence_direct_edge',
  'explicit_query_without_reliable_evidence',
  'auto_vague_query_without_topic',
  'context_only_temperature_moment',
  'relationship_background_without_query_topic_evidence',
  'short_taste_query_without_taste_evidence',
  'query_topic_evidence_missing',
  'anchor_direct_disallowed',
  'anchor_must_group_missing',
  'activated_axis_mismatch',
  'tech_domain_without_query_anchor',
  'low_recall_evidence',
  'discriminative_anchor_missing',
  'category_overview_item_missing',
  'no_hard_evidence',
  'semantic_only',
  'retrieval_alias_only',
  'generic_category_only',
  'weak_evidence_only',
  'planner_must_terms_missing',
  'session_hard_exclude',
  'semantic_session_dedupe',
  'word_map_topic_evidence_missing',
  'semantic_rescue_direct_evidence',
  'journey_domain_excluded',
  'journal_domain_excluded',
  'suppressed',
]

const shadowAdmissionReasons = [
  'shadow_invalid_candidate',
  'shadow_hard_exclusion',
  'shadow_unique_direct_evidence',
  'shadow_strong_semantic_topic',
  'shadow_semantic_keyword_agreement',
  'shadow_explicit_semantic_topic',
  'shadow_explicit_exact_topic',
  'shadow_query_unavailable_formal_topic_keyword',
  'shadow_semantic_not_scored',
  'shadow_keyword_only_without_unique_anchor',
  'shadow_query_topic_missing',
  'shadow_insufficient_relevance',
  'shadow_selected',
]

const evidenceLabels = [
  'title_anchor',
  'exact_anchor',
  'protected_phrase',
  'entity_match',
  'identity_name_match',
  'source_record_exact',
  'taste_evidence',
  'distinctive_anchor',
  'category_overview_item',
  'retrieval_alias',
  'semantic_rescue_direct_span',
  'category_seed',
  'keyword_match',
  'semantic_hit',
  'strong_semantic',
  'strong_rerank',
  'graph_related',
  'raw_transcript_exact',
  'same_day_metadata',
]

describe('recall lens Chinese explanations', () => {
  it('covers every audited necessity, formal, Shadow, and evidence code', () => {
    for (const code of [
      ...necessityReasons,
      ...formalAdmissionReasons,
      ...shadowAdmissionReasons,
      ...evidenceLabels,
    ]) {
      expect(getRecallRuleCopy(code).title, code).not.toContain('未识别')
    }
  })

  it('explains retrieval aliases accurately', () => {
    expect(getRecallRuleCopy('retrieval_alias').title).toBe('命中稳定检索别名')
    expect(getRecallRuleCopy('retrieval_alias_only').description).toContain('不能单独决定注入')
  })

  it('covers all current candidate semantic statuses', () => {
    const statuses = [
      'scored',
      'indexed_not_in_semantic_top_k',
      'query_timeout',
      'query_failed',
      'query_embedding_unavailable',
      'query_embedding_failed',
      'engine_disabled',
      'disabled_for_request',
      'index_empty',
      'no_current_model_embeddings',
      'embedding_missing',
      'embedding_invalid',
      'embedding_stale_model_or_dimension',
      'embedding_status_unknown',
      'legacy_unknown',
    ]
    for (const code of statuses) {
      expect(getSemanticStatusCopy(code).title, code).not.toContain('未识别')
    }
    expect(getSemanticStatusCopy('query_timeout').title).toBe('查询语义超时')
  })

  it('covers all current planner statuses and fallback strategies', () => {
    for (const code of ['normal', 'degraded', 'not_triggered', 'disabled', 'not_run']) {
      expect(getPlannerStatusCopy(code).title, code).not.toContain('未识别')
    }
    for (const code of [
      'shadow_disabled',
      'necessity_none',
      'explicit_target_missing',
      'conservative_no_expansion',
      'contextual_strict_relevance',
      'explicit_strict_relevance_with_planner_fallback',
    ]) {
      expect(getFallbackStrategyCopy(code).title, code).not.toContain('未识别')
    }
  })

  it('handles dynamic planner errors and keeps unknown internal codes visible', () => {
    expect(getRecallRuleCopy('query_planner_parse_failed:bad_json').title).toBe('查询规划结果解析失败')
    expect(getRecallRuleCopy('query_planner_call_failed:TimeoutError').effect).toBe('degraded')
    const unknown = getRecallRuleCopy('shadow_future_rule_v2')
    expect(unknown.title).toContain('shadow_future_rule_v2')
    expect(unknown.description).toContain('完整内部码')
    expect(unknown.title).not.toBe('尚未收录中文说明')
  })
})
