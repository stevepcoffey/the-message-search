import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

function safe(str: string): string {
  if (!str) return ''
  let out = ''
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c >= 32 && c <= 126) out += str[i]
    else out += ' '
  }
  return out.replace(/  +/g, ' ').trim()
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = safe(body.query || '')
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const keyword = query.split(' ').filter((w: string) => w.length > 3)[0] || query.split(' ')[0]

    const { data: sermonResults, error: se } = await supabase
      .from('sermon_chunks')
      .select('text, sermon_id, sermons(title, date)')
      .ilike('text', '%' + keyword + '%')
      .limit(3)

    if (se) console.error('Sermon search error:', se.message)

    const { data: bibleResults, error: be } = await supabase
      .from('bible_verses')
      .select('book, chapter, verse, text')
      .ilike('text', '%' + keyword + '%')
      .limit(2)

    if (be) console.error('Bible search error:', be.message)

    const sr = sermonResults || []
    const br = bibleResults || []

    const passages = [
      ...sr.map((r: any) => 'From ' + safe(r.sermons?.title || 'Unknown') + ' (' + (r.sermons?.date || '') + '):\n' + safe(r.text).slice(0, 400)),
      ...br.map((r: any) => 'From ' + r.book + ' ' + r.chapter + ':' + r.verse + ' (KJV):\n' + safe(r.text))
    ].join('\n\n---\n\n') || 'No relevant passages found.'

    const systemPrompt = 'You are a research assistant for William Branham sermons and KJV Bible. Answer ONLY from these passages. Be concise.\n\nPASSAGES:\n' + safe(passages)

    const aiResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: query }]
    })

    const responseText = aiResponse?.content?.[0]?.type === 'text' ? aiResponse.content[0].text : ''

    return NextResponse.json({
      response: safe(responseText),
      sources: sr.slice(0, 2).map((r: any) => ({
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
