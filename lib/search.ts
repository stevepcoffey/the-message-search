import { supabase } from './supabase'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Generate embedding for a query
async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  })
  return response.data[0].embedding
}

// Semantic search across sermons and bible
export async function semanticSearch(query: string, source: string = 'both') {
  const embedding = await getEmbedding(query)
  const results = []

  if (source === 'both' || source === 'message') {
    const { data: sermonResults } = await supabase.rpc('search_sermons', {
      query_embedding: embedding,
      match_count: 10
    })
    if (sermonResults) {
      results.push(...sermonResults.map((r: any) => ({ ...r, source: 'message' })))
    }
  }

  if (source === 'both' || source === 'bible') {
    const { data: bibleResults } = await supabase.rpc('search_bible', {
      query_embedding: embedding,
      match_count: 10
    })
    if (bibleResults) {
      results.push(...bibleResults.map((r: any) => ({ ...r, source: 'bible' })))
    }
  }

  return results
}

// Exact phrase search
export async function exactSearch(query: string, source: string = 'both') {
  const results = []

  if (source === 'both' || source === 'message') {
    const { data } = await supabase
      .from('sermon_chunks')
      .select('*, sermons(title, date, location, reference_code)')
      .ilike('text', `%${query}%`)
      .limit(10)
    if (data) results.push(...data.map((r: any) => ({ ...r, source: 'message' })))
  }

  if (source === 'both' || source === 'bible') {
    const { data } = await supabase
      .from('bible_verses')
      .select('*')
      .ilike('text', `%${query}%`)
      .limit(10)
    if (data) results.push(...data.map((r: any) => ({ ...r, source: 'bible' })))
  }

  return results
}

// Full text search (all words / any word)
export async function fullTextSearch(query: string, mode: 'allwords' | 'anyword', source: string = 'both') {
  const operator = mode === 'allwords' ? '&' : '|'
  const formattedQuery = query.trim().split(/\s+/).join(` ${operator} `)
  const results = []

  if (source === 'both' || source === 'message') {
    const { data } = await supabase
      .from('sermon_chunks')
      .select('*, sermons(title, date, location, reference_code)')
      .textSearch('text', formattedQuery)
      .limit(10)
    if (data) results.push(...data.map((r: any) => ({ ...r, source: 'message' })))
  }

  if (source === 'both' || source === 'bible') {
    const { data } = await supabase
      .from('bible_verses')
      .select('*')
      .textSearch('text', formattedQuery)
      .limit(10)
    if (data) results.push(...data.map((r: any) => ({ ...r, source: 'bible' })))
  }

  return results
}
