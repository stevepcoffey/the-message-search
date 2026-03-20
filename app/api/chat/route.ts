import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { supabaseServer } from '@/lib/supabase-server'
import { expandQuery } from '@/lib/expandQuery'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type HybridRow = {
  source: 'message' | 'bible'
  text: string
  title: string
  date: string
  ref: string
  vector_score: number
  keyword_score: number
  hybrid_score: number
}

type SermonRow = {
  id: string
  title: string | null
  date: string | null
  reference_code: string | null
}

function toAscii(s: string): string {
  if (!s) return ''
  let o = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 10 || c === 13) o += '\n'
    else if (c >= 32 && c <= 126) o += s[i]
    else o += ' '
  }
  return o
}

function parseRerankScores(raw: string): Map<number, number> {
  const out = new Map<number, number>()
  if (!raw) return out

  const block = raw.match(/\{[\s\S]*\}/)?.[0] || raw
  try {
    const parsed = JSON.parse(block)
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.scores) ? parsed.scores : []
    for (const item of arr) {
      const idx = Number(item?.idx)
      const score = Number(item?.score)
      if (Number.isFinite(idx) && Number.isFinite(score)) out.set(idx, score)
    }
  } catch {
    return out
  }
  return out
}

function getAnthropicText(content: any): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
    .map((block: any) => block.text)
    .join('\n')
    .trim()
}

function buildLocalFallbackAnswer(query: string, rows: HybridRow[]): string {
  if (!rows.length) {
    return 'I could not find enough matching material for that query yet. Please try a more specific wording or sermon reference.'
  }
  const top = rows.slice(0, 3)
  const intro = `Here are the most relevant matches I found for "${query}":`
  const bullets = top.map((r, i) => {
    const source = `${r.title}${r.date ? ` (${r.date})` : ''}${r.ref ? ` #${r.ref}` : ''}`
    const excerpt = r.text.replace(/\s+/g, ' ').trim().slice(0, 260)
    return `${i + 1}. ${source}\n> ${excerpt}${r.text.length > 260 ? '...' : ''}`
  }).join('\n\n')
  return `${intro}\n\n${bullets}\n\nTry narrowing your question to a specific sermon, quote phrase, or scripture for deeper synthesis.`
}

function extractReferenceCode(query: string): string | null {
  const m = query.match(/\b\d{2}-\d{4}[A-Z]?\b/i)
  return m ? m[0].toUpperCase() : null
}

function cleanTitleCandidate(query: string): string {
  let q = query.trim()
  q = q.replace(/\b(let us discuss|discuss|about|sermon|message)\b/gi, ' ')
  q = q.replace(/[#()]/g, ' ')
  q = q.replace(/\s+/g, ' ').trim()
  return q
}

async function findSpecificSermon(query: string): Promise<SermonRow | null> {
  const refCode = extractReferenceCode(query)
  const titleCandidate = cleanTitleCandidate(query)

  if (refCode) {
    const { data } = await supabaseServer
      .from('sermons')
      .select('id,title,date,reference_code')
      .ilike('reference_code', `%${refCode}%`)
      .limit(1)
      .maybeSingle()
    if (data) return data as SermonRow
  }

  if (titleCandidate.length >= 6) {
    const { data } = await supabaseServer
      .from('sermons')
      .select('id,title,date,reference_code')
      .ilike('title', `%${titleCandidate}%`)
      .limit(1)
      .maybeSingle()
    if (data) return data as SermonRow
  }

  return null
}

async function rerankWithClaude(query: string, rows: HybridRow[]): Promise<HybridRow[]> {
  if (!rows.length) return []
  try {
    const docs = rows.map((r, i) => `${i + 1}. [${r.source}] ${r.title} ${r.date ? `(${r.date})` : ''}\n${r.text.slice(0, 550)}`).join('\n\n')

    const ai = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: 'You are a strict relevance rater. Return JSON only.',
      messages: [{
        role: 'user',
        content: toAscii(`Question: ${query}\n\nRate each candidate 1-10 for relevance to the question.\nReturn ONLY JSON in this form:\n{"scores":[{"idx":1,"score":9.5}, ... ]}\n\nCandidates:\n${docs}`),
      }],
    })

    const text = getAnthropicText(ai?.content)
    const scores = parseRerankScores(text)

    return [...rows]
      .map((row, i) => ({ row, score: scores.get(i + 1) ?? 0, idx: i }))
      .sort((a, b) => b.score - a.score || b.row.hybrid_score - a.row.hybrid_score || a.idx - b.idx)
      .slice(0, 8)
      .map(x => x.row)
  } catch {
    return rows.slice(0, 8)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = toAscii(body.query || '').trim()
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const specificSermon = await findSpecificSermon(query)
    let ranked: HybridRow[] = []
    let usedSpecificSermon = false

    if (specificSermon?.id) {
      const { data: chunkRows, error: chunkError } = await supabaseServer
        .from('sermon_chunks')
        .select('text,chunk_index')
        .eq('sermon_id', specificSermon.id)
        .order('chunk_index', { ascending: true })
        .limit(20)

      if (!chunkError && (chunkRows || []).length > 0) {
        ranked = (chunkRows || []).map((row: any) => ({
          source: 'message',
          text: toAscii(row.text || ''),
          title: toAscii(specificSermon.title || 'William Branham Sermon'),
          date: specificSermon.date || '',
          ref: specificSermon.reference_code || '',
          vector_score: 1,
          keyword_score: 1,
          hybrid_score: 1,
        }))
        usedSpecificSermon = true
      }
    }

    if (!usedSpecificSermon) {
      const expandedQuery = await expandQuery(query)

      const embed = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: expandedQuery || query,
      })
      const queryEmbedding = embed.data[0]?.embedding
      if (!queryEmbedding) {
        return NextResponse.json({ error: 'Failed to embed query' }, { status: 500 })
      }

      const { data: hybridResults, error: hybridError } = await supabaseServer
        .rpc('match_documents_hybrid', {
          query_embedding: queryEmbedding,
          keyword_query: expandedQuery || query,
          match_count: 20,
        })

      if (hybridError) {
        return NextResponse.json({ error: hybridError.message }, { status: 500 })
      }

      ranked = ((hybridResults || []) as any[]).map((row: any) => ({
        source: row.source === 'bible' ? 'bible' : 'message',
        text: toAscii(row.text || ''),
        title: toAscii(row.title || (row.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')),
        date: row.date || '',
        ref: row.ref || '',
        vector_score: Number(row.vector_score || 0),
        keyword_score: Number(row.keyword_score || 0),
        hybrid_score: Number(row.hybrid_score || 0),
      } as HybridRow))
    }

    let reranked = usedSpecificSermon ? ranked.slice(0, 20) : await rerankWithClaude(query, ranked)

    if (!reranked.length) {
      const { data: keywordFallbackRows } = await supabaseServer
        .from('sermon_chunks')
        .select('text,sermons(title,date,reference_code)')
        .ilike('text', `%${query}%`)
        .limit(20)
      reranked = (keywordFallbackRows || []).map((row: any) => ({
        source: 'message',
        text: toAscii(row?.text || ''),
        title: toAscii(row?.sermons?.title || 'William Branham Sermon'),
        date: row?.sermons?.date || '',
        ref: row?.sermons?.reference_code || '',
        vector_score: 0,
        keyword_score: 1,
        hybrid_score: 1,
      }))
    }

    const passages = reranked.map((r, idx) =>
      `${idx + 1}. [${r.source.toUpperCase()}] ${r.title}${r.date ? ` (${r.date})` : ''}${r.ref ? ` #${r.ref}` : ''}\n${r.text.slice(0, 950)}`
    ).join('\n\n')

    const systemPrompt = toAscii(`
You are a William Branham sermon research assistant.
Use only the context items below. Do not invent quotes, sermons, or scripture text.
Never say "the passages provided".

Write the response in this exact structure:
1) Opening summary paragraph (natural, direct)
2) ## Direct Quotes
   - Include multiple markdown blockquotes (every quoted line starts with >)
   - After each quote, include source line: — Sermon Title (Date) [#Reference]
3) ## Key Scriptures
   - List KJV verses verbatim with references
4) Brief synthesis paragraph at the end

Context:
${passages || 'No passages found.'}
    `)

    let response = ''
    try {
      const ai = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: toAscii(query) }],
      })
      response = getAnthropicText(ai?.content)
    } catch {
      response = ''
    }
    if (!response) response = buildLocalFallbackAnswer(query, reranked)

    return NextResponse.json({
      response,
      sources: reranked.slice(0, 8).map(r => ({
        title: r.title,
        date: r.date,
        source: r.source,
        ref: r.ref || undefined,
      })),
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}
