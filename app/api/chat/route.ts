import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { supabaseServer } from '@/lib/supabase-server'
import { expandQuery } from '@/lib/expandQuery'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type Passage = {
  text: string
  title: string
  date: string
  reference_code: string
  source: 'message' | 'bible'
  score: number
}

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'about', 'how',
  'do', 'does', 'did', 'are', 'was', 'were', 'this', 'that', 'these', 'those',
])

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

function getAnthropicText(content: any): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b?.type === 'text' && typeof b?.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
    .trim()
}

function meaningfulTokens(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, '').trim())
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  )]
}

async function resolveUserId(request: NextRequest, explicitUserId?: string | null): Promise<string | null> {
  if (explicitUserId) return explicitUserId
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return null
  try {
    const { data } = await supabaseServer.auth.getUser(token)
    return data?.user?.id || null
  } catch {
    return null
  }
}

async function logSearchHistory(entry: {
  query: string
  mode: 'chat' | 'search'
  user_id: string | null
  result_count: number
  response_time_ms: number
}) {
  try {
    await supabaseServer.from('search_history').insert(entry)
  } catch {
    // Non-blocking logging
  }
}

async function retrievePassages(query: string): Promise<Passage[]> {
  let expanded = query
  try {
    expanded = await expandQuery(query)
  } catch {
    expanded = query
  }

  try {
    const embed = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: expanded || query,
    })
    const queryEmbedding = embed.data[0]?.embedding
    if (!queryEmbedding) throw new Error('embedding_empty')

    const { data } = await supabaseServer.rpc('match_documents_hybrid', {
      query_embedding: queryEmbedding,
      keyword_query: expanded || query,
      match_count: 30,
    })
    const rows = ((data || []) as any[])
      .filter((r: any) => (r?.source === 'message' || r?.source === 'bible') && typeof r?.text === 'string')
      .map((r: any) => ({
        text: toAscii(String(r?.text || '')),
        title: toAscii(String(r?.title || (r?.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon'))),
        date: String(r?.date || ''),
        reference_code: String(r?.ref || ''),
        source: r?.source === 'bible' ? 'bible' : 'message',
        score: Number(r?.hybrid_score || 0),
      } as Passage))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
    if (rows.length >= 10) return rows
  } catch {
    // continue to fallback
  }

  const tokens = meaningfulTokens(expanded || query).slice(0, 8)
  const orClause = tokens.map(t => `text.ilike.%${t}%`).join(',')
  if (!orClause) return []

  const out: Passage[] = []
  const { data: sermonRows } = await supabaseServer
    .from('sermon_chunks')
    .select('text, sermons(title, date, reference_code)')
    .or(orClause)
    .limit(140)
  for (const row of sermonRows || []) {
    const text = toAscii(String(row?.text || ''))
    const lower = text.toLowerCase()
    const hits = tokens.reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
    if (hits === 0) continue
    const meta = Array.isArray(row?.sermons) ? row?.sermons?.[0] : row?.sermons
    out.push({
      text,
      title: toAscii(String(meta?.title || 'William Branham Sermon')),
      date: String(meta?.date || ''),
      reference_code: String(meta?.reference_code || ''),
      source: 'message',
      score: hits,
    })
  }

  const { data: bibleRows } = await supabaseServer
    .from('bible_verses')
    .select('book,chapter,verse,text')
    .or(orClause)
    .limit(120)
  for (const row of bibleRows || []) {
    const text = toAscii(String(row?.text || ''))
    const lower = text.toLowerCase()
    const hits = tokens.reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
    if (hits === 0) continue
    out.push({
      text,
      title: `${row?.book || ''} ${row?.chapter || ''}:${row?.verse || ''}`.trim() || 'KJV Bible',
      date: 'KJV',
      reference_code: '',
      source: 'bible',
      score: hits,
    })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 15)
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const body = await request.json()
    const query = toAscii(body?.query || '').trim()
    const userId = await resolveUserId(request, body?.user_id || null)
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const passages = await retrievePassages(query)
    const rawPassages = passages
      .map((p, i) => `${i + 1}. From ${p.title}${p.date ? ` (${p.date})` : ''}:\n${p.text}`)
      .join('\n\n')

    let response = ''
    if (!passages.length) {
      response = 'These passages were found but may not directly answer your question.'
    } else {
      const systemPrompt = `You are a research organizer. You have been given exact passages from William Branham's sermons and the KJV Bible. Your ONLY job is:

Write one short sentence introducing the topic (your own words)
Select the most relevant exact passages and present them in order of relevance
Write one short sentence of transition between passages if needed (your own words)
Never reword, paraphrase, summarize or alter any passage text - copy it exactly
Never add information not found in the passages
If passages do not answer the question, say exactly: These passages were found but may not directly answer your question.

Format your response like this:
[Your one sentence introduction]
From [Sermon Title] ([Date]):
[EXACT quote copied word for word]
From [Sermon Title] ([Date]):
[EXACT quote copied word for word]
[Optional one sentence transition or summary in your own words]`
      try {
        const ai = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 900,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: toAscii(`Question: ${query}\n\nPassages:\n${rawPassages}`),
          }],
        })
        response = getAnthropicText(ai?.content)
      } catch {
        response = ''
      }
      if (!response) response = 'These passages were found but may not directly answer your question.'
    }

    await logSearchHistory({
      query,
      mode: 'chat',
      user_id: userId,
      result_count: passages.length,
      response_time_ms: Date.now() - startedAt,
    })

    return NextResponse.json({
      response,
      passages: passages.map(p => ({
        text: p.text,
        title: p.title,
        date: p.date,
        reference_code: p.reference_code,
        source: p.source,
      })),
      // Keep compatibility for existing UI consumers.
      commentary: response,
      exact_passages: passages.map((p, idx) => ({
        idx: idx + 1,
        text: p.text,
        title: p.title,
        date: p.date,
        ref: p.reference_code,
        source: p.source,
      })),
      sources: passages.map(p => ({
        title: p.title,
        date: p.date,
        source: p.source,
        ref: p.reference_code || undefined,
      })),
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error?.message || 'Chat failed' }, { status: 500 })
  }
}
