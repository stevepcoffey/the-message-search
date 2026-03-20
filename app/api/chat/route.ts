import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { supabaseServer } from '@/lib/supabase-server'

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
You are a warm, knowledgeable William Branham sermon research assistant.
Use ONLY the provided context passages. Do not invent citations or verses not in context.

Write like you are talking with the user — natural paragraphs, not a rigid outline.
Weave Scripture and Brother Branham's words throughout your answer:
- When you cite the Bible from context, work the verse or phrase into the sentence flow, then give the reference in parentheses or after a short line (e.g. "As it is written in John 3:3 (KJV): ...").
- When you quote a sermon, use a markdown blockquote: every quoted line must start with ">" (one > per line).
  Immediately after each blockquote, add the source on its own line, e.g. "— Sermon Title (Date) [#Ref]" or "— Book Chapter:Verse (KJV)" for Bible-only lines from context.
- Alternate explanation, scripture, and sermon quotes so the reader moves through the topic conversationally — like answering "What does William Branham say about faith?" with biblical grounding, then his preaching, then another angle, another quote, etc.
- Do NOT use separate stacked sections titled like "Summary" then "All quotes" then "All scriptures". Optional short "## Summary" at the very end (2–4 sentences) is fine if it helps close the answer.

If context is thin, say so briefly and still only use what is given.

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