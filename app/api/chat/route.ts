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
  sermon_id?: string
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

type RetrievalMeta = {
  path: 'specific_sermon' | 'hybrid' | 'keyword_fallback' | 'no_results'
  reason?: string
  counts: { ranked: number; reranked: number; sources: number }
  timings_ms: { total: number; retrieval: number; rerank: number; answer: number }
}

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'about', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'by',
  'do', 'does', 'did', 'be', 'are', 'was', 'were', 'it', 'this', 'that', 'as', 'at', 'from', 'how',
])

async function resolveUserId(request: NextRequest, explicitUserId?: string | null): Promise<string | null> {
  if (explicitUserId) return explicitUserId
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return null
  try {
    const { data } = await supabaseServer.auth.getUser(token)
    return data?.user?.id || null
  } catch {
    return null
  }
}

async function logSearchHistory(entry: {
  query: string
  mode: 'chat' | 'search'
  user_id: string | null
  result_count: number
  response_time_ms: number
}) {
  try {
    await supabaseServer.from('search_history').insert(entry)
  } catch {
    // Non-blocking logging
  }
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

function getMeaningfulTokens(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[^a-z0-9]/gi, '').trim())
      .filter(t => t.length >= 3 && !STOP_WORDS.has(t))
  )]
}

function buildLocalFallbackAnswer(query: string, rows: HybridRow[]): string {
  if (!rows.length) {
    return 'I found these related passages but none contain a direct statement on this specific question. Here is what was found:\n\n(No passages were retrieved.)\n\nAll quotes are exact and verbatim from William Branham\'s recorded sermons or the KJV Bible.'
  }
  const raw = rows
    .slice(0, 8)
    .map((r, i) => `${i + 1}. [${r.source.toUpperCase()}] ${r.title}${r.date ? ` (${r.date})` : ''}${r.ref ? ` [#${r.ref}]` : ''}\n${r.text}`)
    .join('\n\n')
  return `I found these related passages but none contain a direct statement on this specific question. Here is what was found:\n\n${raw}\n\nAll quotes are exact and verbatim from William Branham's recorded sermons or the KJV Bible.`
}

function enforceSourceDiversity(rows: HybridRow[], maxPerSermon = 2, maxTotal = 20): HybridRow[] {
  const out: HybridRow[] = []
  const sermonCounts = new Map<string, number>()
  for (const row of rows) {
    if (out.length >= maxTotal) break
    if (row.source === 'message') {
      const key = row.sermon_id || row.ref || `${row.title}|${row.date}`
      const used = sermonCounts.get(key) || 0
      if (used >= maxPerSermon) continue
      sermonCounts.set(key, used + 1)
    }
    out.push(row)
  }
  return out
}

async function keywordFallbackRows(query: string): Promise<HybridRow[]> {
  const q = query.trim()
  if (!q) return []
  const tokens = getMeaningfulTokens(q).slice(0, 10)
  const specificWord = [...tokens].sort((a, b) => b.length - a.length)[0] || q.toLowerCase()
  const keywordSet = new Set([q.toLowerCase(), ...tokens])
  const orClause = tokens.map(t => `text.ilike.%${t}%`).join(',')

  let sermonQuery: any = supabaseServer
    .from('sermon_chunks')
    .select('sermon_id,text, sermons(title, date, reference_code)')
    .ilike('text', `%${specificWord}%`)
    .order('id', { ascending: false })
    .limit(120)
  const { data: sermonMatches } = await sermonQuery

  let extraSermonMatches: any[] = []
  if ((sermonMatches || []).length < 15 && orClause) {
    let extraQuery: any = supabaseServer
      .from('sermon_chunks')
      .select('sermon_id,text, sermons(title, date, reference_code)')
      .order('id', { ascending: false })
      .limit(120)
      .or(orClause)
    const { data } = await extraQuery
    extraSermonMatches = data || []
  }

  let bibleQuery: any = supabaseServer
    .from('bible_verses')
    .select('book,chapter,verse,text')
    .ilike('text', `%${specificWord}%`)
    .order('id', { ascending: false })
    .limit(80)
  const { data: bibleMatches } = await bibleQuery

  const out: HybridRow[] = []
  for (const row of [...(sermonMatches || []), ...extraSermonMatches]) {
    const text = toAscii(row?.text || '')
    const lower = text.toLowerCase()
    const matchCount = [...keywordSet].reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
    if (matchCount === 0) continue
    const sermonMeta = Array.isArray(row?.sermons) ? row?.sermons?.[0] : row?.sermons
    out.push({
      source: 'message',
      sermon_id: row?.sermon_id || undefined,
      text,
      title: toAscii(sermonMeta?.title || 'William Branham Sermon'),
      date: sermonMeta?.date || '',
      ref: sermonMeta?.reference_code || '',
      vector_score: 0,
      keyword_score: 1,
      hybrid_score: 1,
    })
    if (out.length >= 20) break
  }

  for (const row of bibleMatches || []) {
    const text = toAscii(row?.text || '')
    const lower = text.toLowerCase()
    const matchCount = [...keywordSet].reduce((n, t) => (lower.includes(t) ? n + 1 : n), 0)
    if (matchCount === 0) continue
    out.push({
      source: 'bible',
      text,
      title: `${row?.book || ''} ${row?.chapter || ''}:${row?.verse || ''}`.trim() || 'KJV Bible',
      date: 'KJV',
      ref: '',
      vector_score: 0,
      keyword_score: 1,
      hybrid_score: 1,
    })
    if (out.length >= 20) break
  }
  const diversified = enforceSourceDiversity(out, 2, 20)
  return diversified.length >= 15 ? diversified : out.slice(0, 20)
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
        content: toAscii(`Question: ${query}\n\nScore 1-10 how directly this passage answers the question.\nScore 1 if the passage does not mention the topic at all.\nOnly keep passages scoring 6 or higher.\nReturn ONLY JSON in this form:\n{"scores":[{"idx":1,"score":9.5}, ... ]}\n\nCandidates:\n${docs}`),
      }],
    })

    const text = getAnthropicText(ai?.content)
    const scores = parseRerankScores(text)

    const filtered = [...rows]
      .map((row, i) => ({ row, score: scores.get(i + 1) ?? 0, idx: i }))
      .filter(x => x.score >= 6)
      .sort((a, b) => b.score - a.score || b.row.hybrid_score - a.row.hybrid_score || a.idx - b.idx)
      .slice(0, 8)
      .map(x => x.row)
    return filtered.length ? filtered : rows.slice(0, 8)
  } catch {
    return rows.slice(0, 8)
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let retrievalMs = 0
  let rerankMs = 0
  let answerMs = 0
  try {
    const body = await request.json()
    const query = toAscii(body.query || '').trim()
    const userId = await resolveUserId(request, body?.user_id || null)
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const specificSermon = await findSpecificSermon(query)
    let ranked: HybridRow[] = []
    let usedSpecificSermon = false
    let retrievalPath: RetrievalMeta['path'] = 'hybrid'
    let retrievalReason = ''

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
          sermon_id: specificSermon.id,
          text: toAscii(row.text || ''),
          title: toAscii(specificSermon.title || 'William Branham Sermon'),
          date: specificSermon.date || '',
          ref: specificSermon.reference_code || '',
          vector_score: 1,
          keyword_score: 1,
          hybrid_score: 1,
        }))
        usedSpecificSermon = true
        retrievalPath = 'specific_sermon'
      }
    }

    if (!usedSpecificSermon) {
      let expandedQuery = query
      try {
        expandedQuery = await expandQuery(query)
      } catch {
        expandedQuery = query
      }

      try {
        const embed = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: expandedQuery || query,
        })
        const queryEmbedding = embed.data[0]?.embedding
        if (!queryEmbedding) throw new Error('embedding_empty')

        const hybridCall = supabaseServer.rpc('match_documents_hybrid', {
          query_embedding: queryEmbedding,
          keyword_query: expandedQuery || query,
          match_count: 20,
        })
        const timeoutCall = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('hybrid_timeout_10s')), 10000)
        })
        const { data: hybridResults, error: hybridError } = await Promise.race([hybridCall, timeoutCall]) as any

        if (hybridError) throw new Error(hybridError.message || 'hybrid_error')

        ranked = ((hybridResults || []) as any[]).map((row: any) => ({
          source: row.source === 'bible' ? 'bible' : 'message',
          sermon_id: row.sermon_id || undefined,
          text: toAscii(row.text || ''),
          title: toAscii(row.title || (row.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')),
          date: row.date || '',
          ref: row.ref || '',
          vector_score: Number(row.vector_score || 0),
          keyword_score: Number(row.keyword_score || 0),
          hybrid_score: Number(row.hybrid_score || 0),
        } as HybridRow))
        const qTokens = getMeaningfulTokens(query)
        if (qTokens.length) {
          ranked = ranked.map(r => {
            const hay = `${r.title} ${r.ref}`.toLowerCase()
            const boostHits = qTokens.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0)
            if (!boostHits) return r
            return { ...r, hybrid_score: r.hybrid_score + boostHits * 0.35, keyword_score: r.keyword_score + boostHits * 0.15 }
          }).sort((a, b) => b.hybrid_score - a.hybrid_score)
        }
        retrievalPath = 'hybrid'
        if (!ranked.length) {
          retrievalReason = 'hybrid_empty'
          retrievalPath = 'keyword_fallback'
          ranked = await keywordFallbackRows(query)
        }
      } catch (e: any) {
        retrievalReason = String(e?.message || 'hybrid_failed')
        retrievalPath = 'keyword_fallback'
        ranked = await keywordFallbackRows(query)
      }
    }
    ranked = enforceSourceDiversity(ranked, 2, 20)
    retrievalMs = Date.now() - startedAt

    let reranked = usedSpecificSermon ? ranked.slice(0, 20) : await rerankWithClaude(query, ranked)
    if (!reranked.length && ranked.length) reranked = ranked.slice(0, 8)
    reranked = enforceSourceDiversity(reranked, 2, 8)
    rerankMs = Date.now() - startedAt - retrievalMs

    const exact_passages = reranked.slice(0, 8).map((r, idx) => ({
      idx: idx + 1,
      text: r.text,
      title: r.title,
      date: r.date,
      source: r.source,
      ref: r.ref || '',
    }))
    const passages = exact_passages
      .map((p) => `${p.idx}. [${p.source.toUpperCase()}] ${p.title}${p.date ? ` (${p.date})` : ''}${p.ref ? ` #${p.ref}` : ''}\n${p.text.slice(0, 950)}`)
      .join('\n\n')

    console.log('chat_context_debug', {
      chunk_count: reranked.length,
      context_preview: passages.slice(0, 200),
    })
    console.log('chat_context_full', passages)

    const systemPrompt = toAscii(`
ABSOLUTE RULE: You may NEVER paraphrase, summarize, or reword William Branham's sermons or the KJV Bible. Every quote must be word-for-word exact from the provided passages. If you cannot find an exact quote in the passages that answers the question, say so clearly - do not invent or approximate his words under any circumstances. Misquoting William Branham is worse than giving no answer at all.

PASSAGES (use only these):
${passages}

You have no knowledge of William Branham outside of the passages provided. Do not draw on any outside knowledge about him.
Never recommend external sources, websites, books, apps, or ministries.
Do not tell the user to search elsewhere.
Never suggest alternative search terms.

When quoting:
- Copy the text exactly as it appears in the passage
- Put it in a markdown blockquote
- Label each quote exactly as: Exact quote from [sermon title] ([date]):
- Include paragraph/chunk reference if available as [#reference]
- Never paraphrase even a single sentence

When summarizing context around quotes:
- You may write your own words to introduce or explain a quote
- You may never put words in Branham's mouth
- Clearly separate your explanation from exact quotes

If the retrieved passages do not contain a direct quote answering the question, respond exactly with:
I found these related passages but none contain a direct statement on this specific question. Here is what was found: [show the raw passages]

IMPORTANT OUTPUT RULE FOR THIS API:
- Do NOT output quote text from passages.
- Do NOT use blockquotes.
- Write commentary only (your own explanatory words) that references passage numbers like [1], [2], [3].
- Keep commentary concise and factual.
5) Final line (always include exactly):
All quotes are exact and verbatim from William Branham's recorded sermons or the KJV Bible.
    `)

    if (!reranked.length || !passages.trim()) {
      answerMs = Date.now() - startedAt - retrievalMs - rerankMs
      const retrieval_meta: RetrievalMeta = {
        path: 'no_results',
        reason: retrievalReason || 'retrieval_empty',
        counts: { ranked: ranked.length, reranked: reranked.length, sources: 0 },
        timings_ms: { total: Date.now() - startedAt, retrieval: retrievalMs, rerank: rerankMs, answer: answerMs },
      }
      console.log('chat_retrieval_meta', retrieval_meta)
      await logSearchHistory({
        query,
        mode: 'chat',
        user_id: userId,
        result_count: reranked.length,
        response_time_ms: Date.now() - startedAt,
      })
      return NextResponse.json({
        response: buildLocalFallbackAnswer(query, reranked),
        commentary: buildLocalFallbackAnswer(query, reranked),
        exact_passages: [],
        sources: [],
        retrieval_meta,
      })
    }

    let commentary = ''
    try {
      const ai = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: toAscii(query) }],
      })
      commentary = getAnthropicText(ai?.content)
    } catch {
      commentary = ''
    }
    if (!commentary) commentary = buildLocalFallbackAnswer(query, reranked)
    const disclaimer = "All quotes are exact and verbatim from William Branham's recorded sermons or the KJV Bible."
    if (!commentary.includes(disclaimer)) commentary = `${commentary.trim()}\n\n${disclaimer}`
    answerMs = Date.now() - startedAt - retrievalMs - rerankMs

    const retrieval_meta: RetrievalMeta = {
      path: retrievalPath,
      reason: retrievalReason || undefined,
      counts: { ranked: ranked.length, reranked: reranked.length, sources: Math.min(reranked.length, 8) },
      timings_ms: { total: Date.now() - startedAt, retrieval: retrievalMs, rerank: rerankMs, answer: answerMs },
    }
    console.log('chat_retrieval_meta', retrieval_meta)
    await logSearchHistory({
      query,
      mode: 'chat',
      user_id: userId,
      result_count: reranked.length,
      response_time_ms: Date.now() - startedAt,
    })

    return NextResponse.json({
      response: commentary,
      commentary,
      exact_passages,
      sources: reranked.slice(0, 8).map(r => ({
        title: r.title,
        date: r.date,
        source: r.source,
        ref: r.ref || undefined,
      })),
      retrieval_meta,
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}
