import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

function mapDirectSermonRow(row: any): ResultRow {
  return {
    id: row?.id ?? '',
    text: String(row?.text || ''),
    title: String(row?.sermon_title || 'William Branham Sermon'),
    date: String(row?.sermon_date || ''),
    reference_code: String(row?.sermon_reference_code || ''),
    paragraph_number: row?.paragraph_number == null ? null : Number(row.paragraph_number),
    source: 'message',
    score: 0,
  }
}

function mapBibleRow(row: any): ResultRow {
  return {
    id: row?.id ?? '',
    text: String(row?.text || ''),
    title: `${row?.book || ''} ${row?.chapter || ''}:${row?.verse || ''}`.trim() || 'KJV Bible',
    date: 'KJV',
    reference_code: '',
    paragraph_number: null,
    source: 'bible',
    score: 0,
  }
}

function dedupeRows(rows: ResultRow[]): ResultRow[] {
  const seen = new Set<string>()
  const out: ResultRow[] = []
  for (const row of rows) {
    const key = `${row.source}|${row.id}|${row.title}|${row.text.slice(0, 120)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

async function searchSermonsExact(query: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('sermon_chunks')
    .select('id,text,paragraph_number,sermon_title,sermon_date,sermon_reference_code')
    .ilike('normalized_text', `%${query.toLowerCase()}%`)
    .limit(20)
  if (error) throw error
  return ((data || []) as any[]).map(mapDirectSermonRow)
}

async function searchBibleExact(query: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('bible_verses')
    .select('id,book,chapter,verse,text')
    .ilike('normalized_text', `%${query.toLowerCase()}%`)
    .limit(20)
  if (error) throw error
  return ((data || []) as any[]).map(mapBibleRow)
}

async function searchSermonsAllWords(query: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('sermon_chunks')
    .select('id,text,paragraph_number,sermon_title,sermon_date,sermon_reference_code')
    .textSearch('search_vector', query, { type: 'plain', config: 'english' })
    .limit(20)
  if (error) throw error
  return ((data || []) as any[]).map(mapDirectSermonRow)
}

async function searchBibleAllWords(query: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('bible_verses')
    .select('id,book,chapter,verse,text')
    .textSearch('search_vector', query, { type: 'plain', config: 'english' })
    .limit(20)
  if (error) throw error
  return ((data || []) as any[]).map(mapBibleRow)
}

async function searchRelevantHybrid(query: string): Promise<ResultRow[]> {
  const embed = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  const queryEmbedding = embed.data[0]?.embedding
  if (!queryEmbedding) return []

  const { data, error } = await supabase.rpc('match_documents_hybrid', {
    query_embedding: queryEmbedding,
    keyword_query: query,
    match_count: 20,
  })
  if (error) throw error
  return ((data || []) as any[]).map(mapRpcRow)
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
      const sermons = source === 'bible' ? [] : await searchSermonsExact(query)
      const bible = source === 'message' ? [] : await searchBibleExact(query)
      results = dedupeRows([...sermons, ...bible]).slice(0, 20)
    } else if (mode === 'allwords') {
      const sermons = source === 'bible' ? [] : await searchSermonsAllWords(query)
      const bible = source === 'message' ? [] : await searchBibleAllWords(query)
      results = dedupeRows([...sermons, ...bible]).slice(0, 20)
    } else {
      const hybrid = await searchRelevantHybrid(query)
      const filtered = source === 'both' ? hybrid : hybrid.filter(r => r.source === source)
      results = dedupeRows(filtered).slice(0, 20)
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('Search route error:', error)
    return NextResponse.json({ error: error?.message || 'Search failed' }, { status: 500 })
  }
}