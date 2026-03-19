import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = Buffer.from(body.query || '', 'ascii').toString('ascii')
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const words = query.split(' ').filter((w: string) => w.length > 3).slice(0, 2).join(' & ')

    let sermonResults: any[] = []
    let bibleResults: any[] = []

    if (words) {
      const { data: s } = await supabase
        .from('sermon_chunks')
        .select('text, sermon_id, sermons(title, date)')
        .textSearch('text', words)
        .limit(3)
      sermonResults = (s || []).map((r: any) => ({
        ...r,
        text: Buffer.from(r.text || '', 'ascii').toString('ascii')
      }))

      const { data: b } = await supabase
        .from('bible_verses')
        .select('book, chapter, verse, text')
        .textSearch('text', words)
        .limit(2)
      bibleResults = (b || []).map((r: any) => ({
        ...r,
        text: Buffer.from(r.text || '', 'ascii').toString('ascii')
      }))
    }

    const passages = [
      ...sermonResults.map((r: any) =>
        'From ' + (r.sermons?.title || 'Unknown') + ' (' + (r.sermons?.date || '') + '):\n' + (r.text || '').slice(0, 400)
      ),
      ...bibleResults.map((r: any) =>
        'From ' + r.book + ' ' + r.chapter + ':' + r.verse + ' (KJV):\n' + (r.text || '')
      )
    ].join('\n\n---\n\n') || 'No relevant passages found.'

    const systemPrompt = 'You are a research assistant for William Branham sermons and KJV Bible. Answer ONLY from these passages. Be concise.\n\nPASSAGES:\n' + passages

    const aiResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: query }]
    })

    const responseText = aiResponse?.content?.[0]?.type === 'text' ? aiResponse.content[0].text : ''

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
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
