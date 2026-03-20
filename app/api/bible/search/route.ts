import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { supabaseServer } from '@/lib/supabase-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function normalizeQuery(raw: unknown): string {
  return String(raw || '').replace(/[%_]/g, ' ').trim()
}

const STOP_WORDS = new Set([
  'what', 'is', 'are', 'the', 'a', 'an', 'about', 'for', 'to', 'of', 'in', 'on', 'and', 'or', 'me', 'my',
  'with', 'that', 'this', 'those', 'these', 'scriptures', 'verse', 'verses',
])

function queryTokens(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, '').trim())
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  )]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = normalizeQuery(body?.query)
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    let results: Array<{ book: string; chapter: number; verse: number; text: string }> = []

    // Semantic-first path via existing hybrid RPC; then keep Bible-only rows.
    try {
      const embed = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
      })
      const queryEmbedding = embed.data[0]?.embedding
      if (queryEmbedding) {
        const { data } = await supabaseServer.rpc('match_documents_hybrid', {
          query_embedding: queryEmbedding,
          keyword_query: query,
          match_count: 120,
        })

        const bibleRows = ((data || []) as any[])
          .filter((r: any) => r?.source === 'bible' && typeof r?.title === 'string' && typeof r?.text === 'string')
          .slice(0, 100)

        const parsed = bibleRows
          .map((row: any) => {
            const m = String(row.title).match(/^(.+?)\s+(\d+):(\d+)$/)
            if (!m) return null
            return {
              book: m[1],
              chapter: Number(m[2]),
              verse: Number(m[3]),
              text: String(row.text),
            }
          })
          .filter((r: any) => r && Number.isFinite(r.chapter) && Number.isFinite(r.verse)) as Array<{ book: string; chapter: number; verse: number; text: string }>

        const seen = new Set<string>()
        for (const r of parsed) {
          const key = `${r.book}|${r.chapter}|${r.verse}`
          if (seen.has(key)) continue
          seen.add(key)
          results.push(r)
          if (results.length >= 100) break
        }
      }
    } catch {
      // Fall through to keyword fallback
    }

    if (!results.length) {
      const tokens = queryTokens(query).slice(0, 8)
      const primary = [...tokens].sort((a, b) => b.length - a.length)[0] || query
      const keywordSet = new Set([query.toLowerCase(), ...tokens])

      const { data: primaryData, error: primaryErr } = await supabaseServer
        .from('bible_verses')
        .select('book, chapter, verse, text')
        .ilike('text', `%${primary}%`)
        .limit(120)
      if (primaryErr) return NextResponse.json({ error: primaryErr.message }, { status: 500 })

      const orClause = tokens.map(t => `text.ilike.%${t}%`).join(',')
      let extraData: any[] = []
      if ((primaryData || []).length < 25 && orClause) {
        const { data } = await supabaseServer
          .from('bible_verses')
          .select('book, chapter, verse, text')
          .or(orClause)
          .limit(160)
        extraData = data || []
      }

      const merged = [...(primaryData || []), ...extraData]
      const scored = merged
        .map((r: any) => {
          const text = String(r?.text || '')
          const lower = text.toLowerCase()
          const score = [...keywordSet].reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
          return {
            book: String(r?.book || ''),
            chapter: Number(r?.chapter || 0),
            verse: Number(r?.verse || 0),
            text,
            score,
          }
        })
        .filter(r => r.book && Number.isFinite(r.chapter) && Number.isFinite(r.verse) && r.text && r.score > 0)
        .sort((a, b) => b.score - a.score)

      const seen = new Set<string>()
      results = []
      for (const r of scored) {
        const key = `${r.book}|${r.chapter}|${r.verse}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({ book: r.book, chapter: r.chapter, verse: r.verse, text: r.text })
        if (results.length >= 100) break
      }
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Bible search failed' }, { status: 500 })
  }
}
