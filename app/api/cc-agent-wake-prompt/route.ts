import { NextRequest, NextResponse } from 'next/server'
import {
  getAgentWakePromptConfig,
  saveAgentWakePromptConfig,
  resetAgentWakePromptConfig,
} from '@/app/lib/cc/agentWakePrompt'

export const runtime = 'nodejs'

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export async function GET() {
  return NextResponse.json({ ok: true, config: getAgentWakePromptConfig() })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const instructions = String(body?.instructions || '').trim()
    const toolDescription = String(body?.tool_description || '').trim()
    if (!instructions) return error('instructions 不能为空')
    if (!toolDescription) return error('tool_description 不能为空')
    const config = saveAgentWakePromptConfig(instructions, toolDescription)
    return NextResponse.json({ ok: true, config: { ...getAgentWakePromptConfig(), ...config } })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE() {
  resetAgentWakePromptConfig()
  return NextResponse.json({ ok: true, config: getAgentWakePromptConfig() })
}
