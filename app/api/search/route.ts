import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { expandQuery } from '@/lib/expandQuery'

export const maxDuration = 60

type SearchMode = 'exact' | 'allwords' | 'relevant'
type SearchSource = 'message' | 'bible' | 'both'

type ResultRow = {
  id: string | number
  text: string
  title: string
  date: string
  reference_code: string
  paragraph_number: number | null
  source: 'message' | 'bible'
  score: number
}
type RpcRowsResponse = { data: any[] | null; error: any }

const RPC_TIMEOUT_MS = 5000

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function normalizeMode(mode: unknown): SearchMode {
  if (mode === 'exact' || mode === 'allwords' || mode === 'relevant') return mode
  return 'relevant'
}

function normalizeSource(source: unknown): SearchSource {
  if (source === 'message' || source === 'bible' || source === 'both') return source
  return 'both'
}

function mapRpcRow(row: any): ResultRow {
  const source = row?.source === 'bible' ? 'bible' : 'message'
  return {
    id: row?.id ?? '',
    text: String(row?.text || ''),
    title: String(row?.title || (source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')),
    date: String(row?.date || ''),
    reference_code: String(row?.reference_code || row?.ref || ''),
    paragraph_number: row?.paragraph_number == null ? null : Number(row.paragraph_number),
    source,
    score: Number(row?.score ?? row?.hybrid_score ?? row?.similarity ?? 0),
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

function mapDirectSermonRow(row: any): ResultRow {
  const sermonMeta = Array.isArray(row?.sermons) ? row.sermons[0] : row?.sermons
  return {
    id: row?.id ?? '',
    text: String(row?.text || ''),
    title: String(sermonMeta?.title || 'William Branham Sermon'),
    date: String(sermonMeta?.date || ''),
    reference_code: String(sermonMeta?.reference_code || ''),
    paragraph_number: row?.paragraph_number == null ? null : Number(row.paragraph_number),
    source: 'message',
    score: 0,
  }
}

async function fallbackSermonIlike(query: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('sermon_chunks')
    .select('id,text,paragraph_number,sermons(title,date,reference_code)')
    .ilike('text', `%${query}%`)
    .limit(20)

  if (error) throw error
  return ((data || []) as any[]).map(mapDirectSermonRow)
}

async function runExactSearch(query: string, source: SearchSource): Promise<ResultRow[]> {
  try {
    const rpc = supabase.rpc('search_exact', {
      query_text: query,
      source_filter: source || 'both',
      result_limit: 20,
    }) as Promise<RpcRowsResponse>
    const { data, error } = await withTimeout<RpcRowsResponse>(rpc, RPC_TIMEOUT_MS, 'search_exact')
    if (error) throw error
    return ((data || []) as any[]).map(mapRpcRow)
  } catch (err: any) {
    console.warn(`search_exact failed, falling back to ILIKE: ${err?.message || String(err)}`)
    return fallbackSermonIlike(query)
  }
}

async function runAllWordsSearch(query: string, source: SearchSource): Promise<ResultRow[]> {
  try {
    const rpc = supabase.rpc('search_all_words', {
      query_text: query,
      source_filter: source || 'both',
      result_limit: 20,
    }) as Promise<RpcRowsResponse>
    const { data, error } = await withTimeout<RpcRowsResponse>(rpc, RPC_TIMEOUT_MS, 'search_all_words')
    if (error) throw error
    return ((data || []) as any[]).map(mapRpcRow)
  } catch (err: any) {
    console.warn(`search_all_words failed, falling back to ILIKE: ${err?.message || String(err)}`)
    return fallbackSermonIlike(query)
  }
}

async function runRelevantSearch(query: string, source: SearchSource): Promise<ResultRow[]> {
  const expandedTerms = expandQuery(query)
  const expandedQuery = expandedTerms.join(' ')

  const embed = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: expandedQuery,
  })
  const queryEmbedding = embed.data[0]?.embedding
  if (!queryEmbedding) return []

  const { data, error } = await supabase.rpc('match_documents_hybrid', {
    query_embedding: queryEmbedding,
    keyword_query: expandedQuery,
    match_count: 20,
  })
  if (error) throw error

  const rows = ((data || []) as any[]).map(mapRpcRow)
  const filtered = source === 'both' ? rows : rows.filter(r => r.source === source)
  return filtered.slice(0, 20)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = String(body?.query || '').trim()
    const mode = normalizeMode(body?.mode)
    const source = normalizeSource(body?.source)

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    let results: ResultRow[] = []

    if (mode === 'exact') {
      results = await runExactSearch(query, source)
    } else if (mode === 'allwords') {
      results = await runAllWordsSearch(query, source)
    } else {
      results = await runRelevantSearch(query, source)
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('Search route error:', error)
    return NextResponse.json({ error: error?.message || 'Search failed' }, { status: 500 })
  }
}