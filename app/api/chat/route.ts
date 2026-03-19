import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = (body.query || '').replace(/[^a-zA-Z0-9 ?.,]/g, '')

    const ai = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: 'You are a helpful assistant. Be brief.',
      messages: [{ role: 'user', content: query }]
    })

    const response = ai?.content?.[0]?.type === 'text' ? ai.content[0].text : 'No response'
    return NextResponse.json({ response, sources: [] })

  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}