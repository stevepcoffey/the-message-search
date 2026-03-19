import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { supabaseServer } from '@/lib/supabase'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

function normalizeSermonMeta(sermons: any): { title: string; date: string; ref: string } {
  const value = Array.isArray(sermons) ? sermons[0] : sermons
  return {
    title: value?.title || 'William Branham Sermon',
    date: value?.date || '',
    ref: value?.ref || '',
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = toAscii(body.query || '').trim()
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const embed = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
    const queryEmbedding = embed.data[0]?.embedding
    if (!queryEmbedding) {
      return NextResponse.json({ error: 'Failed to embed query' }, { status: 500 })
    }

    const { data: sermonMatches, error: sermonError } = await supabaseServer
      .rpc('search_sermons', { query_embedding: queryEmbedding, match_count: 12 })

    if (sermonError) {
      return NextResponse.json({ error: sermonError.message }, { status: 500 })
    }

    const { data: bibleMatches, error: bibleError } = await supabaseServer
      .rpc('search_bible', { query_embedding: queryEmbedding, match_count: 12 })

    if (bibleError) {
      return NextResponse.json({ error: bibleError.message }, { status: 500 })
    }

    const sermonRows = (sermonMatches || []).map((row: any) => {
      const meta = normalizeSermonMeta(row.sermons)
      return {
        source: 'message',
        similarity: Number(row.similarity || 0),
        text: toAscii(row.text || ''),
        title: toAscii(row.title || meta.title),
        date: row.date || meta.date,
        ref: row.ref || meta.ref,
      }
    })

    const bibleRows = (bibleMatches || []).map((row: any) => ({
      source: 'bible',
      similarity: Number(row.similarity || 0),
      text: toAscii(row.text || ''),
      title: `${row.book || ''} ${row.chapter || ''}:${row.verse || ''}`.trim() || 'KJV Bible',
      date: 'KJV',
      ref: '',
    }))

    const ranked = [...sermonRows, ...bibleRows]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 12)

    const passages = ranked.map((r, idx) =>
      `${idx + 1}. [${r.source.toUpperCase()}] ${r.title}${r.date ? ` (${r.date})` : ''}${r.ref ? ` #${r.ref}` : ''}\n${r.text.slice(0, 900)}`
    ).join('\n\n')

    const systemPrompt = toAscii(`
You are a William Branham sermon research assistant.
Use ONLY the provided context passages. Do not invent citations.

Output format requirements:
1) Start with a short summary paragraph.
2) Add a "## Direct Quotes" section with multiple blockquotes.
   - Every quote line must start with ">".
   - After each quote, add source like: — Sermon Title (Date) [#Ref]
3) Add a "## Key Scriptures" section as bullet points.
4) Add a "## Sources" section at the bottom formatted as source cards:
   - "- **Title** | Date | #Reference"
   - For Bible: "- **John 3:3** | KJV"

Context passages:
${passages || 'No passages found.'}
    `)

    const ai = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: toAscii(query) }]
    })

    const response = ai?.content?.[0]?.type === 'text' ? ai.content[0].text : ''

    return NextResponse.json({
      response,
      sources: ranked.slice(0, 6).map(r => ({
        title: r.title,
        date: r.date,
        source: r.source,
        ref: r.ref || undefined,
      })),
    })

  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}