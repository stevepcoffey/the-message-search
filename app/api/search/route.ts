import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

type SearchSource = 'message' | 'bible' | 'both'

function normalizeSource(source: unknown): SearchSource {
  if (source === 'message' || source === 'bible' || source === 'both') return source
  return 'both'
}

export async function POST(request: NextRequest) {
  try {
    const { query, source } = await request.json()
    const normalizedQuery = String(query || '').trim()
    const normalizedSource = normalizeSource(source)

    if (!normalizedQuery) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const results: Array<{
      quote_text: string
      source_title: string
      source_date: string
      source: 'message' | 'bible'
    }> = []

    if (normalizedSource === 'both' || normalizedSource === 'message') {
      const { data: sermonMatches, error: sermonError } = await supabase
        .from('sermon_chunks')
        .select('text, sermons(title, date)')
        .ilike('text', `%${normalizedQuery}%`)
        .limit(30)

      if (sermonError) {
        return NextResponse.json({ error: sermonError.message }, { status: 500 })
      }

      for (const row of sermonMatches || []) {
        results.push({
          quote_text: row.text || '',
          source_title: row.sermons?.title || 'William Branham Sermon',
          source_date: row.sermons?.date || '',
          source: 'message',
        })
      }
    }

    if (normalizedSource === 'both' || normalizedSource === 'bible') {
      const { data: bibleMatches, error: bibleError } = await supabase
        .from('bible_verses')
        .select('book, chapter, verse, text')
        .ilike('text', `%${normalizedQuery}%`)
        .limit(30)

      if (bibleError) {
        return NextResponse.json({ error: bibleError.message }, { status: 500 })
      }

      for (const row of bibleMatches || []) {
        results.push({
          quote_text: row.text || '',
          source_title: `${row.book || ''} ${row.chapter || ''}:${row.verse || ''}`.trim(),
          source_date: '',
          source: 'bible',
        })
      }
    }

    return NextResponse.json({ results })

  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}