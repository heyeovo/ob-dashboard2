export type CcContextTokenItem = {
  name: string
  tokens: number
  isDeferred?: boolean
  isLoaded?: boolean
}

export type CcExactContextAnalysis = {
  updatedAt: number
  model: string
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  categories: CcContextTokenItem[]
  memoryFiles: Array<CcContextTokenItem & { path: string; type: string }>
  mcpTools: Array<CcContextTokenItem & { serverName: string }>
  deferredBuiltinTools: CcContextTokenItem[]
  systemTools: CcContextTokenItem[]
  systemPromptSections: CcContextTokenItem[]
  agents: Array<CcContextTokenItem & { source: string }>
  slashCommands: { totalCommands: number; includedCommands: number; tokens: number } | null
  skills: { totalSkills: number; includedSkills: number; tokens: number } | null
  messageBreakdown: {
    toolCallTokens: number
    toolResultTokens: number
    attachmentTokens: number
    assistantMessageTokens: number
    userMessageTokens: number
    redirectedContextTokens: number
    unattributedTokens: number
  } | null
}

export type CcContextAnalysisResult = {
  ok: boolean
  analysis: CcExactContextAnalysis | null
  cached: boolean
  error: string
}
