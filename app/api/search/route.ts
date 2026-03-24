import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

async function runFastSearch(query: string, source: SearchSource): Promise<ResultRow[]> {
  try {
    const { data, error } = await supabase.rpc('search_fast', {
      query_text: query,
      source_filter: source || 'both',
      result_limit: 20,
    })
    if (error) throw error
    return ((data || []) as any[]).map(mapRpcRow)
  } catch (err: any) {
    console.warn(`search_fast failed, falling back to ILIKE: ${err?.message || String(err)}`)
    return fallbackSermonIlike(query)
  }
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

    // All search modes now use search_fast with the same fallback behavior.
    void mode
    results = await runFastSearch(query, source)

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('Search route error:', error)
    return NextResponse.json({ error: error?.message || 'Search failed' }, { status: 500 })
  }
}