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
  sermon_id?: string
  source: 'message' | 'bible'
  score: number
}

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'about', 'how',
  'do', 'does', 'did', 'are', 'was', 'were', 'this', 'that', 'these', 'those',
])

const DOCTRINE_QUERY_EXPANSIONS: Record<string, string[]> = {
  'serpent seed': ['Eve', 'garden', 'devil', 'seed', 'Cain', 'beast'],
  godhead: ['oneness', 'trinity', 'Jesus name', 'Father', 'Son'],
  'seven seals': ['Revelation', 'seals', 'Lamb', 'book'],
  rapture: ['translation', 'catching away', 'bride'],
  bride: ['elected', 'called', 'chosen', 'wife', 'Lamb'],
  'mark of beast': ['666', 'antichrist', 'church system'],
  'new birth': ['born again', 'Spirit', 'regeneration'],
  vindication: ['pillar fire', 'angel', 'prophet', 'sign'],
}

const DOCTRINE_SERMON_HINTS: Record<string, string[]> = {
  'serpent seed': ['The Serpent Seed', 'Oneness', 'Marriage And Divorce'],
  'seven seals': ['The First Seal', 'The Second Seal', 'The Third Seal', 'The Fourth Seal', 'The Fifth Seal', 'The Sixth Seal', 'The Seventh Seal'],
  'seven church ages': ['The Ephesian Church Age', 'The Smyrnean Church Age', 'The Pergamean Church Age', 'The Thyatirean Church Age', 'The Sardisean Church Age', 'The Philadelphian Church Age', 'The Laodicean Church Age'],
  godhead: ['The Godhead Explained'],
  'new birth': ['What Is The New Birth'],
}

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

function parseJsonBlock(raw: string): any | null {
  if (!raw) return null
  const block = raw.match(/\{[\s\S]*\}/)?.[0] || raw
  try {
    return JSON.parse(block)
  } catch {
    return null
  }
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

function detectDoctrineHints(query: string): { titles: string[]; terms: string[] } {
  const q = query.toLowerCase()
  const titles: string[] = []
  const terms: string[] = []
  for (const [k, vals] of Object.entries(DOCTRINE_QUERY_EXPANSIONS)) {
    if (q.includes(k)) terms.push(...vals)
  }
  for (const [k, vals] of Object.entries(DOCTRINE_SERMON_HINTS)) {
    if (q.includes(k)) titles.push(...vals)
  }
  return {
    titles: [...new Set(titles)],
    terms: [...new Set(terms)],
  }
}

function enforceSermonDiversity(rows: Passage[], maxPerSermon = 2, maxTotal = 15): Passage[] {
  const out: Passage[] = []
  const sermonCounts = new Map<string, number>()
  for (const row of rows) {
    if (out.length >= maxTotal) break
    if (row.source === 'message') {
      const key = row.sermon_id || `${row.title}|${row.date}|${row.reference_code}`
      const used = sermonCounts.get(key) || 0
      if (used >= maxPerSermon) continue
      sermonCounts.set(key, used + 1)
    }
    out.push(row)
  }
  return out
}

function sampleAcrossSermonChunks(rows: Array<{ text: string; chunk_index: number }>, want = 2): Array<{ text: string; chunk_index: number }> {
  if (rows.length <= want) return rows
  const sorted = [...rows].sort((a, b) => a.chunk_index - b.chunk_index)
  const picks: Array<{ text: string; chunk_index: number }> = []
  const idxs = want === 1
    ? [Math.floor((sorted.length - 1) / 2)]
    : [0, Math.floor((sorted.length - 1) / 2), sorted.length - 1]
  for (const i of idxs) {
    const row = sorted[Math.max(0, Math.min(sorted.length - 1, i))]
    if (!row) continue
    if (!picks.find(p => p.chunk_index === row.chunk_index)) picks.push(row)
    if (picks.length >= want) break
  }
  return picks
}

async function retrieveSpecificSermonPassages(query: string, doctrineTitles: string[]): Promise<Passage[]> {
  const q = query.trim()
  const titleOrs = [...new Set([q, ...doctrineTitles])]
    .map(t => `title.ilike.%${t.replace(/[%_]/g, ' ').trim()}%`)
    .filter(Boolean)
    .join(',')
  if (!titleOrs) return []

  const { data: sermonRows } = await supabaseServer
    .from('sermons')
    .select('id,title,date,reference_code')
    .or(titleOrs)
    .limit(5)

  const out: Passage[] = []
  for (const s of sermonRows || []) {
    const { data: chunks } = await supabaseServer
      .from('sermon_chunks')
      .select('text,chunk_index')
      .eq('sermon_id', s.id)
      .order('chunk_index', { ascending: true })
      .limit(220)
    const sampled = sampleAcrossSermonChunks((chunks || []) as any[], 2)
    for (const c of sampled) {
      out.push({
        text: toAscii(String(c?.text || '')),
        title: toAscii(String(s?.title || 'William Branham Sermon')),
        date: String(s?.date || ''),
        reference_code: String(s?.reference_code || ''),
        sermon_id: String(s?.id || ''),
        source: 'message',
        score: 2.5,
      })
    }
  }
  return out
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

async function retrievePassages(query: string): Promise<{ passages: Passage[]; searchedTerms: string[]; oneSermonOnly: boolean }> {
  let expanded = query
  try {
    expanded = await expandQuery(query)
  } catch {
    expanded = query
  }
  const doctrine = detectDoctrineHints(query)
  const searchedTerms = [...new Set([query, ...doctrine.terms, ...meaningfulTokens(expanded || query)])].slice(0, 12)

  // 1) Title/doctrine-first pass for specific sermon retrieval.
  const specific = await retrieveSpecificSermonPassages(query, doctrine.titles)
  if (specific.length) {
    const diversified = enforceSermonDiversity(specific.sort((a, b) => b.score - a.score), 2, 15)
    const sermonIds = new Set(diversified.filter(p => p.source === 'message').map(p => p.sermon_id || p.title))
    return { passages: diversified, searchedTerms, oneSermonOnly: sermonIds.size <= 1 }
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
        sermon_id: String(r?.sermon_id || ''),
        source: r?.source === 'bible' ? 'bible' : 'message',
        score: Number(r?.hybrid_score || 0),
      } as Passage))
      .sort((a, b) => b.score - a.score)
    if (rows.length >= 5) {
      const diversified = enforceSermonDiversity(rows, 2, 15)
      const sermonIds = new Set(diversified.filter(p => p.source === 'message').map(p => p.sermon_id || p.title))
      return { passages: diversified, searchedTerms, oneSermonOnly: sermonIds.size <= 1 }
    }
  } catch {
    // continue to fallback
  }

  const tokens = [...new Set([...doctrine.terms.map(t => t.toLowerCase()), ...meaningfulTokens(expanded || query)])].slice(0, 10)
  const orClause = tokens.map(t => `text.ilike.%${t}%`).join(',')
  if (!orClause) return { passages: [], searchedTerms, oneSermonOnly: false }

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

  const diversified = enforceSermonDiversity(out.sort((a, b) => b.score - a.score), 2, 15)
  const sermonIds = new Set(diversified.filter(p => p.source === 'message').map(p => p.sermon_id || p.title))
  return { passages: diversified, searchedTerms, oneSermonOnly: sermonIds.size <= 1 }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const body = await request.json()
    const query = toAscii(body?.query || '').trim()
    const userId = await resolveUserId(request, body?.user_id || null)
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const retrieval = await retrievePassages(query)
    const passages = retrieval.passages
    const rawPassages = passages
      .map((p, i) => `${i + 1}. From ${p.title}${p.date ? ` (${p.date})` : ''}:\n${p.text}`)
      .join('\n\n')

    let response = ''
    if (!passages.length) {
      response = 'These passages were found but may not directly answer your question.'
    } else {
      const candidatePassages = passages.slice(0, 10)
      const systemPrompt = `You are a research organizer.
Create a conversational guide using ONLY the provided passages.

Required style:
- 1-2 sentence intro in your own words.
- Then alternate: short bridge/commentary sentence -> exact quote.
- Commentary lines must be SHORT (1-2 sentences max).
- Quote labels use: From [Sermon Title] ([Date]):
- End with a short 1-2 sentence summary.
- Choose a maximum of 5 quotes.
- If fewer than 3 good quotes exist, say so honestly.

Critical constraints:
- Never paraphrase quote text.
- Never invent quote text.
- Never add info not supported by passages.

Return JSON only in this exact shape:
{
  "intro": "string",
  "quote_indices": [1,2,3],
  "bridges": ["string","string"],
  "summary": "string",
  "insufficient_quotes_note": "string or empty"
}`
      try {
        const ai = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: toAscii(`Question: ${query}\n\nPassages:\n${candidatePassages.map((p, i) => `${i + 1}. From ${p.title}${p.date ? ` (${p.date})` : ''}\n${p.text}`).join('\n\n')}`),
          }],
        })
        const text = getAnthropicText(ai?.content)
        const plan = parseJsonBlock(text) || {}
        const quoteIndices = (Array.isArray(plan?.quote_indices) ? plan.quote_indices : [])
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n) && n >= 1 && n <= candidatePassages.length)
          .slice(0, 5)
        const chosen: Passage[] = quoteIndices.length
          ? quoteIndices.map((n: number) => candidatePassages[n - 1]).filter(Boolean)
          : candidatePassages.slice(0, Math.min(4, candidatePassages.length))
        const bridges: string[] = Array.isArray(plan?.bridges) ? plan.bridges.map((s: any) => String(s || '').trim()).filter(Boolean) : []
        const intro = String(plan?.intro || '').trim()
        const summary = String(plan?.summary || '').trim()
        const insufficient = String(plan?.insufficient_quotes_note || '').trim()

        const parts: string[] = []
        if (intro) parts.push(intro)
        chosen.forEach((p: Passage, idx: number) => {
          if (idx > 0 && bridges[idx - 1]) parts.push(bridges[idx - 1])
          parts.push(`From ${p.title}${p.date ? ` (${p.date})` : ''}:`)
          parts.push(`> ${p.text}`)
        })
        if (insufficient) parts.push(insufficient)
        if (summary) parts.push(summary)
        response = parts.join('\n\n').trim()
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
      searched_terms: retrieval.searchedTerms,
      diversity_note: retrieval.oneSermonOnly && passages.length > 0
        ? 'All results from one sermon - try a broader search for more variety.'
        : '',
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
