import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

function clean(text: string): string {
  if (!text) return ''
  return text.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = clean(body.query || '')
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const words = query.split(' ')
      .filter(w => w.length > 3)
      .slice(0, 2)
      .join(' & ')

    let sermonResults: any[] = []
    let bibleResults: any[] = []

    if (words) {
      const { data: s } = await supabase
        .from('sermon_chunks')
        .select('text, sermon_id, sermons(title, date)')
        .textSearch('text', words)
        .limit(3)
      sermonResults = s || []

      const { data: b } = await supabase
        .from('bible_verses')
        .select('book, chapter, verse, text')
        .textSearch('text', words)
        .limit(2)
      bibleResults = b || []
    }

    const context = [
      ...sermonResults.map((r: any) =>
        `From "${clean(r.sermons?.title || 'Unknown')}" (${r.sermons?.date || 'Unknown'}):\n${clean(r.text).slice(0, 400)}`
      ),
      ...bibleResults.map((r: any) =>
        `From ${r.book} ${r.chapter}:${r.verse} (KJV):\n${clean(r.text)}`
      )
    ].join('\n\n---\n\n') || 'No relevant passages found.'

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You are a research assistant for William Branham sermons and KJV Bible. Answer ONLY from these passages. Be concise.\n\nPASSAGES:\n${context}`,
      messages: [{ role: 'user', content: query }]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    return NextResponse.json({
      response: responseText,
      sources: sermonResults.slice(0, 2).map((r: any) => ({
        title: r.sermons?.title,
        date: r.sermons?.date,
        source: 'message'
      }))
    })

  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
