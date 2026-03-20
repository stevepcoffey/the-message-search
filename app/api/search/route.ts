import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

type SearchSource = 'message' | 'bible' | 'both'
type SearchMatchType = 'exact_phrase' | 'all_words'
type SermonRelation = { title: string | null; date: string | null } | Array<{ title: string | null; date: string | null }> | null

function normalizeSource(source: unknown): SearchSource {
  if (source === 'message' || source === 'bible' || source === 'both') return source
  return 'both'
}

function normalizeMatchType(mode: unknown): SearchMatchType {
  if (mode === 'all_words' || mode === 'exact_phrase') return mode
  return 'exact_phrase'
}

function stripOuterQuotes(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1).trim()
  return t
}

function tokenizeAllWords(s: string): string[] {
  return [...new Set(s.toLowerCase().split(/\s+/).map(w => w.trim()).filter(w => w.length >= 2))]
}

function containsAllWords(text: string, words: string[]): boolean {
  if (!words.length) return false
  const lower = text.toLowerCase()
  return words.every(w => lower.includes(w))
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

function splitSentences(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

async function suggestSimilarPhrasesFromSermons(query: string): Promise<string[]> {
  const cleaned = query.trim().toLowerCase()
  if (!cleaned) return []
  const tokens = [...new Set(cleaned.split(/\s+/).map(w => w.replace(/[^a-z0-9]/gi, '').trim()).filter(w => w.length >= 3))].slice(0, 5)
  const seed = tokens[0] || cleaned
  if (!seed) return []

  const { data } = await supabase
    .from('sermon_chunks')
    .select('text')
    .ilike('text', `%${seed}%`)
    .limit(140)

  const scored: Array<{ sentence: string; score: number }> = []
  for (const row of data || []) {
    const text = String(row?.text || '')
    if (!text) continue
    const sentences = splitSentences(text)
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase()
      const hits = tokens.reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
      if (hits === 0) continue
      if (sentence.length < 24 || sentence.length > 180) continue
      const cleanedSentence = sentence.replace(/\s+/g, ' ').trim()
      scored.push({ sentence: cleanedSentence, score: hits * 10 - Math.abs(cleanedSentence.length - 90) * 0.03 })
    }
  }

  const seen = new Set<string>()
  return scored
    .sort((a, b) => b.score - a.score)
    .map(x => x.sentence)
    .filter(s => {
      const key = s.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
}

export async function POST(request: NextRequest) {
  try {
    const { query, source, match_type } = await request.json()
    const normalizedQuery = String(query || '').trim()
    const normalizedSource = normalizeSource(source)
    const normalizedMatchType = normalizeMatchType(match_type)
    const phraseQuery = stripOuterQuotes(normalizedQuery)
    const allWords = tokenizeAllWords(normalizedQuery)

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
      const sermonSearchSeed = normalizedMatchType === 'all_words'
        ? (allWords[0] || phraseQuery)
        : phraseQuery
      const { data: sermonMatches, error: sermonError } = await supabase
        .from('sermon_chunks')
        .select('text, sermons(title, date)')
        .ilike('text', `%${sermonSearchSeed}%`)
        .limit(80)

      if (sermonError) {
        return NextResponse.json({ error: sermonError.message }, { status: 500 })
      }

      for (const row of sermonMatches || []) {
        const quoteText = row.text || ''
        const pass =
          normalizedMatchType === 'all_words'
            ? containsAllWords(quoteText, allWords)
            : quoteText.toLowerCase().includes(phraseQuery.toLowerCase())
        if (!pass) continue
        const sermon = getSermonMeta(row.sermons as SermonRelation)
        results.push({
          quote_text: quoteText,
          source_title: sermon.title || 'William Branham Sermon',
          source_date: sermon.date,
          source: 'message',
        })
        if (results.length >= 30) break
      }
    }

    if (normalizedSource === 'both' || normalizedSource === 'bible') {
      const bibleSearchSeed = normalizedMatchType === 'all_words'
        ? (allWords[0] || phraseQuery)
        : phraseQuery
      const { data: bibleMatches, error: bibleError } = await supabase
        .from('bible_verses')
        .select('book, chapter, verse, text')
        .ilike('text', `%${bibleSearchSeed}%`)
        .limit(80)

      if (bibleError) {
        return NextResponse.json({ error: bibleError.message }, { status: 500 })
      }

      for (const row of bibleMatches || []) {
        const quoteText = row.text || ''
        const pass =
          normalizedMatchType === 'all_words'
            ? containsAllWords(quoteText, allWords)
            : quoteText.toLowerCase().includes(phraseQuery.toLowerCase())
        if (!pass) continue
        results.push({
          quote_text: quoteText,
          source_title: `${row.book || ''} ${row.chapter || ''}:${row.verse || ''}`.trim(),
          source_date: '',
          source: 'bible',
        })
        if (results.length >= 60) break
      }
    }

    if (normalizedMatchType === 'exact_phrase' && results.length === 0) {
      const recommended = await suggestSimilarPhrasesFromSermons(phraseQuery || normalizedQuery)
      return NextResponse.json({
        results,
        no_results_message: `No relevant search results were found for the exact phrase "${phraseQuery || normalizedQuery}".`,
        suggested_phrases: recommended,
      })
    }

    return NextResponse.json({ results, no_results_message: '', suggested_phrases: [] })

  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}