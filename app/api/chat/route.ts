import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

const SKIP = new Set(['what','does','did','about','the','and','for','with','from','that','this','have','will','your','they','been','were','when','said','branham','william','say','tell','teach','taught','explain','describe','according'])

function toAscii(s: string): string {
  if (!s) return ''
  let o = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 10 || c === 13) o += '\n'
    else if (c >= 32 && c <= 126) o += s[i]
    else o += ' '
  }
  return o
}

function getSearchPhrase(query: string): string {
  const q = query.toLowerCase().replace(/[^a-z ]/g, '').trim()
  const words = q.split(' ').filter(w => w.length > 1)
  const meaningful = words.filter(w => w.length > 2 && !SKIP.has(w))
  if (meaningful.length >= 2) return meaningful[meaningful.length - 2] + ' ' + meaningful[meaningful.length - 1]
  if (meaningful.length === 1) return meaningful[0]
  return words.filter(w => w.length > 2)[0] || 'faith'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = toAscii(body.query || '').trim()
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const phrase = getSearchPhrase(query)
    console.log('Searching for:', phrase)

    const { data: sr } = await supabase
      .from('sermon_chunks')
      .select('text, sermon_id, sermons(title, date)')
      .ilike('text', '%' + phrase + '%')
      .order('sermon_id', { ascending: false })
      .limit(6)

    const { data: br } = await supabase
      .from('bible_verses')
      .select('book, chapter, verse, text')
      .ilike('text', '%' + phrase + '%')
      .limit(2)

    const sermonPassages = (sr || []).map((r: any) =>
      'From "' + toAscii(r.sermons?.title || '') + '" (' + (r.sermons?.date || '') + '):\n' + toAscii(r.text || '').slice(0, 500)
    )
    const biblePassages = (br || []).map((r: any) =>
      'From ' + r.book + ' ' + r.chapter + ':' + r.verse + ' (KJV):\n' + toAscii(r.text || '')
    )

    const passages = [...sermonPassages, ...biblePassages].join('\n\n---\n\n') || 'No relevant passages found.'

    const systemPrompt = toAscii([
      'You are a William Branham sermon research assistant.',
      'Answer ONLY from the passages provided. Do not use outside knowledge.',
      '',
      'Formatting rules:',
      '- Use ## for section headings',
      '- Put EVERY direct quote on its own separate line starting with >',
      '- Use **bold** for key terms',
      '- Keep paragraphs short with blank lines between them',
      '- Always name the sermon title and date when quoting',
      '',
      'PASSAGES:',
      passages
    ].join('\n'))

    const ai = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: toAscii(query) }]
    })

    const response = ai?.content?.[0]?.type === 'text' ? ai.content[0].text : ''

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