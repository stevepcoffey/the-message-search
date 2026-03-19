import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

const SKIP = new Set(['what','does','did','about','the','and','for','with','from','that','this','have','will','your','they','been','were','when','said','branham','william','say','tell','explain','describe','according','holy','spirit','lord','god','jesus','christ','bible'])

function safe(s: string): string {
  if (!s) return ''
  let o = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    o += (c >= 32 && c <= 126) ? s[i] : ' '
  }
  return o.replace(/ +/g, ' ').trim()
}

function getKeywords(query: string): string[] {
  return query.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(w => w.length > 3 && !SKIP.has(w))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = safe(body.query || '')
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const keywords = getKeywords(query)
    const keyword = keywords[0] || query.split(' ').filter(w => w.length > 2)[0] || 'faith'

    console.log('Query:', query, 'Keyword:', keyword)

    const { data: sr } = await supabase
      .from('sermon_chunks')
      .select('text, sermon_id, sermons(title, date)')
      .ilike('text', '%' + keyword + '%')
      .order('sermon_id', { ascending: false })
      .limit(6)

    const { data: br } = await supabase
      .from('bible_verses')
      .select('book, chapter, verse, text')
      .ilike('text', '%' + keyword + '%')
      .limit(3)

    const sermons = (sr || []).map((r: any) => 'From "' + safe(r.sermons?.title || '') + '" (' + (r.sermons?.date || '') + '):\n' + safe(r.text || '').slice(0, 500))
    const bible = (br || []).map((r: any) => 'From ' + r.book + ' ' + r.chapter + ':' + r.verse + ' (KJV):\n' + safe(r.text || ''))
    const passages = [...sermons, ...bible].join('\n\n---\n\n') || 'No relevant passages found.'

    const sys = 'You are a William Branham sermon research assistant. Answer ONLY from these passages. Do not use outside knowledge. Always quote directly from the passages when possible and name the sermon title and date.\n\nPASSAGES:\n' + safe(passages)

    const ai = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      system: sys,
      messages: [{ role: 'user', content: query }]
    })

    const response = ai?.content?.[0]?.type === 'text' ? safe(ai.content[0].text) : ''

    return NextResponse.json({
      response,
      sources: (sr || []).slice(0, 3).map((r: any) => ({
        title: r.sermons?.title,
        date: r.sermons?.date,
        source: 'message'
      }))
    })

  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}