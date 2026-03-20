import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { expandQuery } from '@/lib/expandQuery'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type SearchSource = 'message' | 'bible' | 'both'
type SearchMatchType = 'relevant' | 'exact_phrase' | 'all_words'
type SearchRow = {
  quote_text: string
  source_title: string
  source_date: string
  source: 'message' | 'bible'
  relevance_score: number
}
type SermonRelation = { title: string | null; date: string | null; reference_code?: string | null } | Array<{ title: string | null; date: string | null; reference_code?: string | null }> | null
const STOP_WORDS = new Set([
  'what', 'is', 'the', 'are', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'about', 'how',
  'do', 'does', 'did', 'be', 'was', 'were', 'this', 'that', 'these', 'those', 'please', 'show', 'me',
])
const KEY_PHRASES = [
  'holy spirit', 'holy ghost', 'spirit of god', 'baptism spirit', 'seven church ages', 'jesus name',
  'new birth', 'divine healing', 'bride of christ', 'son of man', 'word of god', 'eternal life',
]

function normalizeSource(source: unknown): SearchSource {
  if (source === 'message' || source === 'bible' || source === 'both') return source
  return 'both'
}

function normalizeMatchType(mode: unknown): SearchMatchType {
  if (mode === 'relevant' || mode === 'all_words' || mode === 'exact_phrase') return mode
  return 'relevant'
}

function stripOuterQuotes(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1).trim()
  return t
}

function tokenizeAllWords(s: string): string[] {
  return [...new Set(s.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '').trim()).filter(w => w.length >= 2))]
}

function extractMeaningfulTerms(query: string, expanded: string): string[] {
  const base = `${query} ${expanded}`.toLowerCase()
  const out: string[] = []
  for (const p of KEY_PHRASES) {
    if (base.includes(p)) out.push(p)
  }
  const words = tokenizeAllWords(base).filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  out.push(...words)
  return [...new Set(out)].slice(0, 12)
}

function containsAllWords(text: string, words: string[]): boolean {
  if (!words.length) return false
  const lower = text.toLowerCase()
  return words.every(w => lower.includes(w))
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function getSermonMeta(sermons: SermonRelation) {
  if (!sermons) return { title: '', date: '' }
  if (Array.isArray(sermons)) {
    return {
      title: sermons[0]?.title || '',
      date: sermons[0]?.date || '',
    }
  }
  return {
    title: sermons.title || '',
    date: sermons.date || '',
  }
}

function applyMatchType(rows: SearchRow[], matchType: SearchMatchType, query: string): SearchRow[] {
  if (matchType === 'relevant') return rows
  const phraseQuery = stripOuterQuotes(query).toLowerCase()
  const allWords = tokenizeAllWords(query)
  return rows.filter(r => {
    const text = (r.quote_text || '').toLowerCase()
    if (matchType === 'exact_phrase') return phraseQuery ? text.includes(phraseQuery) : true
    return containsAllWords(text, allWords)
  })
}

async function resolveUserId(request: NextRequest, explicitUserId?: string | null): Promise<string | null> {
  if (explicitUserId) return explicitUserId
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return null
  try {
    const { data } = await supabase.auth.getUser(token)
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
    await supabase.from('search_history').insert(entry)
  } catch {
    // Non-blocking logging
  }
}

async function hybridRows(query: string, expandedQuery: string, source: SearchSource): Promise<SearchRow[]> {
  const embed = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: expandedQuery || query,
  })
  const queryEmbedding = embed.data[0]?.embedding
  if (!queryEmbedding) return []

  const { data } = await supabase.rpc('match_documents_hybrid', {
    query_embedding: queryEmbedding,
    keyword_query: expandedQuery || query,
    match_count: 50,
  })
  const raw = (data || []) as any[]
  let rows = raw
    .filter(r => (r?.source === 'message' || r?.source === 'bible') && typeof r?.text === 'string')
    .map((r: any) => ({
      quote_text: String(r.text || ''),
      source_title: String(r.title || (r.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')),
      source_date: String(r.date || ''),
      source: (r.source === 'bible' ? 'bible' : 'message') as 'message' | 'bible',
      relevance_raw: Number(r.hybrid_score || 0),
    }))

  if (source !== 'both') rows = rows.filter(r => r.source === source)
  const maxRaw = Math.max(1e-6, ...rows.map(r => r.relevance_raw))
  return rows
    .map(r => ({
      quote_text: r.quote_text,
      source_title: r.source_title,
      source_date: r.source_date,
      source: r.source,
      relevance_score: clamp01(r.relevance_raw / maxRaw),
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score)
}

async function keywordFallbackRows(query: string, source: SearchSource, matchType: SearchMatchType): Promise<SearchRow[]> {
  const tokens = tokenizeAllWords(query).slice(0, 10)
  const primary = [...tokens].sort((a, b) => b.length - a.length)[0] || stripOuterQuotes(query)
  const allWords = tokenizeAllWords(query)
  const phrase = stripOuterQuotes(query).toLowerCase()
  const keywordSet = new Set([query.toLowerCase(), ...tokens])
  const rows: SearchRow[] = []

  if (source === 'both' || source === 'message') {
    const { data: sermonMatches } = await supabase
      .from('sermon_chunks')
      .select('text, sermons(title, date, reference_code)')
      .ilike('text', `%${primary}%`)
      .limit(140)
    for (const row of sermonMatches || []) {
      const quoteText = String(row?.text || '')
      const lower = quoteText.toLowerCase()
      const pass = matchType === 'exact_phrase' ? (phrase ? lower.includes(phrase) : true) : (matchType === 'all_words' ? containsAllWords(lower, allWords) : true)
      if (!pass) continue
      const sermon = getSermonMeta(row?.sermons as SermonRelation)
      const hits = [...keywordSet].reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
      const denom = Math.max(1, Math.min(8, keywordSet.size))
      rows.push({
        quote_text: quoteText,
        source_title: sermon.title || 'William Branham Sermon',
        source_date: sermon.date || '',
        source: 'message',
        relevance_score: clamp01(hits / denom),
      })
    }
  }

  if (source === 'both' || source === 'bible') {
    const { data: bibleMatches } = await supabase
      .from('bible_verses')
      .select('book, chapter, verse, text')
      .ilike('text', `%${primary}%`)
      .limit(140)
    for (const row of bibleMatches || []) {
      const quoteText = String(row?.text || '')
      const lower = quoteText.toLowerCase()
      const pass = matchType === 'exact_phrase' ? (phrase ? lower.includes(phrase) : true) : (matchType === 'all_words' ? containsAllWords(lower, allWords) : true)
      if (!pass) continue
      const hits = [...keywordSet].reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
      const denom = Math.max(1, Math.min(8, keywordSet.size))
      rows.push({
        quote_text: quoteText,
        source_title: `${row?.book || ''} ${row?.chapter || ''}:${row?.verse || ''}`.trim(),
        source_date: 'KJV',
        source: 'bible',
        relevance_score: clamp01(hits / denom),
      })
    }
  }

  return rows.sort((a, b) => b.relevance_score - a.relevance_score)
}

async function expandedTermFallbackRows(query: string, expanded: string, source: SearchSource): Promise<SearchRow[]> {
  const terms = extractMeaningfulTerms(query, expanded)
  if (!terms.length) return []
  const orClause = terms.map(t => `text.ilike.%${t}%`).join(',')
  const keySet = new Set(terms.map(t => t.toLowerCase()))
  const rows: SearchRow[] = []

  if (source === 'both' || source === 'message') {
    const { data } = await supabase
      .from('sermon_chunks')
      .select('text, sermons(title, date)')
      .or(orClause)
      .limit(180)
    for (const row of data || []) {
      const quoteText = String(row?.text || '')
      const lower = quoteText.toLowerCase()
      const hits = [...keySet].reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
      if (hits === 0) continue
      const sermon = getSermonMeta(row?.sermons as SermonRelation)
      rows.push({
        quote_text: quoteText,
        source_title: sermon.title || 'William Branham Sermon',
        source_date: sermon.date || '',
        source: 'message',
        relevance_score: hits,
      })
    }
  }
  if (source === 'both' || source === 'bible') {
    const { data } = await supabase
      .from('bible_verses')
      .select('book, chapter, verse, text')
      .or(orClause)
      .limit(180)
    for (const row of data || []) {
      const quoteText = String(row?.text || '')
      const lower = quoteText.toLowerCase()
      const hits = [...keySet].reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
      if (hits === 0) continue
      rows.push({
        quote_text: quoteText,
        source_title: `${row?.book || ''} ${row?.chapter || ''}:${row?.verse || ''}`.trim(),
        source_date: 'KJV',
        source: 'bible',
        relevance_score: hits,
      })
    }
  }
  return rows.sort((a, b) => b.relevance_score - a.relevance_score)
}

function normalizeRelativeScores(rows: SearchRow[]): SearchRow[] {
  if (!rows.length) return rows
  const top = Math.max(1e-6, ...rows.map(r => Number(r.relevance_score || 0)))
  return rows.map(r => ({ ...r, relevance_score: clamp01(Number(r.relevance_score || 0) / top) }))
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const body = await request.json()
    const query = String(body?.query || '').trim()
    const source = normalizeSource(body?.source)
    const matchType = normalizeMatchType(body?.match_type)
    const userId = await resolveUserId(request, body?.user_id || null)
    if (!query) return NextResponse.json({ error: 'Query is required' }, { status: 400 })

    let expanded = query
    try {
      expanded = await expandQuery(query)
    } catch {
      expanded = query
    }

    let rows: SearchRow[] = []
    try {
      rows = await hybridRows(query, expanded, source)
    } catch {
      rows = []
    }

    if (matchType === 'relevant' && rows.length < 5) {
      const expandedFallback = await expandedTermFallbackRows(query, expanded, source)
      if (expandedFallback.length) rows = expandedFallback
    }

    rows = applyMatchType(rows, matchType, query)
    if (!rows.length) rows = await keywordFallbackRows(query, source, matchType)
    rows = normalizeRelativeScores(rows)

    const seen = new Set<string>()
    const results = rows.filter(r => {
      const key = `${r.source}|${r.source_title}|${r.quote_text.slice(0, 120)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 20)

    await logSearchHistory({
      query,
      mode: 'search',
      user_id: userId,
      result_count: results.length,
      response_time_ms: Date.now() - startedAt,
    })

    return NextResponse.json({
      results,
      no_results_message: results.length ? '' : `No relevant search results were found for "${query}".`,
      suggested_phrases: [],
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}