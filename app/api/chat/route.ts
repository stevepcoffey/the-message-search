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

const RERANK_PROMPT =
  'Score each passage 1-10 for how directly it answers this question. Score 1 = completely irrelevant. Score 10 = direct exact answer. Return ONLY a JSON array like [{index: 0, score: 8}, {index: 1, score: 3}]. Nothing else.'

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

function parseRerankScores(raw: string): Array<{ index: number; score: number }> {
  if (!raw) return []
  const block = raw.match(/\[[\s\S]*\]/)?.[0] || raw
  try {
    const parsed = JSON.parse(block)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: any) => ({
        index: Number(item?.index),
        score: Number(item?.score),
      }))
      .filter(item => Number.isFinite(item.index) && Number.isFinite(item.score))
  } catch {
    return []
  }
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

async function retrieveTopPassages(query: string): Promise<Passage[]> {
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
    match_count: 30,
  })
  if (error) throw error

  return ((data || []) as any[]).map(mapPassage).slice(0, 30)
}

async function rerankPassages(query: string, passages: Passage[]): Promise<Passage[]> {
  if (!passages.length) return []

  const payload = passages.map((p, i) => ({
    index: i,
    title: p.title,
    date: p.date,
    reference_code: p.reference_code,
    paragraph_number: p.paragraph_number,
    source: p.source,
    text: p.text,
  }))

  try {
    const rerank = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      max_tokens: 1200,
      system: RERANK_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Question: ${query}\n\nPassages:\n${JSON.stringify(payload)}`,
        },
      ],
    })
    const scores = parseRerankScores(anthropicText(rerank.content))
    if (!scores.length) throw new Error('rerank_parse_failed')

    const byIndex = new Map(scores.map(s => [s.index, s.score]))
    const ranked = passages
      .map((p, i) => ({ ...p, rerank_score: byIndex.get(i) ?? 0 }))
      .filter(p => p.rerank_score >= 6)
      .sort((a, b) => b.rerank_score - a.rerank_score || b.score - a.score)
      .slice(0, 12)

    return ranked.map(({ rerank_score, ...rest }: any) => rest as Passage)
  } catch {
    return passages.slice().sort((a, b) => b.score - a.score).slice(0, 12)
  }
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

    // Step 1 + Step 2
    const retrieved = await retrieveTopPassages(query)

    // Step 3
    const topPassages = await rerankPassages(query, retrieved)

    // Step 4
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
