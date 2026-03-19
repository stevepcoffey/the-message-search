import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

function cleanText(text: string): string {
  return text
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/[^\x00-\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const words = cleanText(query).split(' ').slice(0, 2).join(' | ')

    const { data: sermonResults } = await supabase
      .from('sermon_chunks')
      .select('text, sermon_id, sermons(title, date)')
      .textSearch('text', words)
      .limit(3)

    const { data: bibleResults } = await supabase
      .from('bible_verses')
      .select('book, chapter, verse, text')
      .textSearch('text', words)
      .limit(2)

    const context = [
      ...(sermonResults || []).map((r: any) =>
        `From "${cleanText(r.sermons?.title || '')}" (${r.sermons?.date}):\n${cleanText(r.text).slice(0, 300)}`
      ),
      ...(bibleResults || []).map((r: any) =>
        `From ${r.book} ${r.chapter}:${r.verse} (KJV):\n${cleanText(r.text)}`
      )
    ].join('\n\n---\n\n')

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You are a research assistant for William Branham's sermons and the KJV Bible. Answer ONLY from the passages below. Be concise.\n\nPASSAGES:\n${context}`,
      messages: [{ role: 'user', content: cleanText(query) }]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    return NextResponse.json({
      response: responseText,
      sources: [
        ...(sermonResults || []).slice(0, 2).map((r: any) => ({
          title: r.sermons?.title,
          date: r.sermons?.date,
          source: 'message'
        }))
      ]
    })

  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
