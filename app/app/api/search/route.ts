import { NextRequest, NextResponse } from 'next/server'
import { semanticSearch, exactSearch, fullTextSearch } from '@/lib/search'

export async function POST(request: NextRequest) {
  try {
    const { query, mode, source = 'both' } = await request.json()

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    let results = []

    if (mode === 'semantic') {
      results = await semanticSearch(query, source)
    } else if (mode === 'exact') {
      results = await exactSearch(query, source)
    } else if (mode === 'allwords' || mode === 'anyword') {
      results = await fullTextSearch(query, mode, source)
    }

    return NextResponse.json({ results })

  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}