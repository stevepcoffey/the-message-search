import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { expandQuery } from '@/lib/expandQuery'

export const maxDuration = 60

type Passage = {
  id: string | number
  text: string
  title: string
  date: string
  reference_code: string
  paragraph_number: number | null
  source: 'message' | 'bible'
  score: number
}

const ANSWER_SYSTEM_PROMPT = `You are a retrieval assistant for William Branham sermons and the KJV Bible.

ABSOLUTE RULES:
1. Every quote must be copied EXACTLY word-for-word from the passages provided
2. Never paraphrase or summarize Branham words or the Bible
3. Never add theological interpretation beyond what is explicitly stated
4. Never use outside knowledge
5. If the answer cannot be found say exactly: I cannot find that stated directly in the provided passages.

FORMAT your response exactly like this:
[One sentence introducing what was found — your words only]

> [Exact quote copied word for word]
— [Sermon Title] ([Date]) · Par. [paragraph_number]

[Optional one connecting sentence — your words only]

> [Exact quote copied word for word]
— [Sermon Title] ([Date]) · Par. [paragraph_number]`

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function anthropicText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((item: any) => item?.type === 'text' && typeof item?.text === 'string')
    .map((item: any) => item.text)
    .join('\n')
    .trim()
}

function mapPassage(row: any): Passage {
  const source = row?.source === 'bible' ? 'bible' : 'message'
  return {
    id: row?.id ?? '',
    text: String(row?.text || ''),
    title: String(row?.title || (source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')),
    date: String(row?.date || ''),
    reference_code: String(row?.reference_code || row?.ref || ''),
    paragraph_number: row?.paragraph_number == null ? null : Number(row.paragraph_number),
    source,
    score: Number(row?.hybrid_score ?? row?.score ?? row?.similarity ?? 0),
  }
}

function mostMeaningfulWord(query: string): string {
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'from', 'into'])
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .filter(w => !stop.has(w))
    .sort((a, b) => b.length - a.length)
  return words[0] || query.toLowerCase().trim()
}

async function retrieveHybridPassages(query: string): Promise<Passage[]> {
  const expandedTerms = expandQuery(query)
  const expanded = expandedTerms.join(' ')

  const embed = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: expanded,
  })
  const embedding = embed.data[0]?.embedding
  if (!embedding) return []

  const { data, error } = await supabase.rpc('match_documents_hybrid', {
    query_embedding: embedding,
    keyword_query: expanded,
    match_count: 20,
  })
  if (error) throw error

  return ((data || []) as any[]).map(mapPassage).slice(0, 20)
}

async function fallbackIlikePassages(query: string): Promise<Passage[]> {
  const term = mostMeaningfulWord(query)
  const { data, error } = await supabase
    .from('sermon_chunks')
    .select('id,text,paragraph_number,sermon_title,sermon_date,sermon_reference_code')
    .ilike('text', `%${term}%`)
    .limit(15)
  if (error) throw error

  const rows = (data || []) as any[]
  return rows.map(row => ({
    id: row?.id ?? '',
    text: String(row?.text || ''),
    title: String(row?.sermon_title || 'William Branham Sermon'),
    date: String(row?.sermon_date || ''),
    reference_code: String(row?.sermon_reference_code || ''),
    paragraph_number: row?.paragraph_number == null ? null : Number(row.paragraph_number),
    source: 'message' as const,
    score: 0,
  }))
}

async function generateResponse(query: string, passages: Passage[]): Promise<string> {
  if (!passages.length) {
    return 'I cannot find that stated directly in the provided passages.'
  }

  const generationInput = passages.map((p, i) => ({
    index: i,
    title: p.title,
    date: p.date,
    reference_code: p.reference_code,
    paragraph_number: p.paragraph_number,
    source: p.source,
    text: p.text,
  }))

  const completion = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    temperature: 0,
    max_tokens: 1400,
    system: ANSWER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Question: ${query}\n\nPassages:\n${JSON.stringify(generationInput)}`,
      },
    ],
  })

  const text = anthropicText(completion.content)
  return text || 'I cannot find that stated directly in the provided passages.'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = String(body?.query || '').trim()
    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    let passages: Passage[] = []
    try {
      passages = await retrieveHybridPassages(query)
    } catch {
      passages = []
    }
    if (!passages.length) {
      try {
        passages = await fallbackIlikePassages(query)
      } catch {
        passages = []
      }
    }

    const topPassages = passages.slice(0, 15)
    const response = await generateResponse(query, topPassages)

    const sources = topPassages.map(p => ({
      title: p.title,
      date: p.date,
      reference_code: p.reference_code,
      paragraph_number: p.paragraph_number,
    }))

    return NextResponse.json({ response, sources })
  } catch (error: any) {
    console.error('Chat route error:', error)
    return NextResponse.json({ error: error?.message || 'Chat failed' }, { status: 500 })
  }
}
