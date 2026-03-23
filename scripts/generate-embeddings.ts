import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const INTER_CHUNK_DELAY_MS = 200
const PARALLEL_CHUNKS = 3
const MAX_RETRIES_PER_CHUNK = 3
const FETCH_RETRY_DELAY_MS = 2000

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY
const openaiApiKey = process.env.OPENAI_API_KEY

if (!supabaseUrl || !supabaseServiceKey || !openaiApiKey) {
  console.error('Missing required env vars. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, and OPENAI_API_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const openai = new OpenAI({ apiKey: openaiApiKey })

type Row = { id: string | number; text: string | null }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseLimitArg(): number | null {
  const args = process.argv.slice(2)
  const eqArg = args.find(a => a.startsWith('--limit='))
  if (eqArg) {
    const n = Number(eqArg.split('=')[1])
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  }
  const idx = args.findIndex(a => a === '--limit')
  if (idx >= 0) {
    const n = Number(args[idx + 1])
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  }
  return null
}

async function getResumeId(table: 'sermon_chunks' | 'bible_verses'): Promise<number | null> {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .is('embedding', null)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`${table} resume check failed: ${error.message}`)
  }

  if (!data?.id) return null
  const id = Number(data.id)
  return Number.isFinite(id) ? id : null
}

async function countRemaining(table: 'sermon_chunks' | 'bible_verses', fromId: number): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)
    .gte('id', fromId)
  if (error) throw new Error(`${table} remaining count failed: ${error.message}`)
  return count || 0
}

async function fetchNextNullEmbeddingRows(table: 'sermon_chunks' | 'bible_verses', fromId: number, count: number): Promise<Row[]> {
  const { data, error } = await supabase
    .from(table)
    .select('id,text')
    .is('embedding', null)
    .gte('id', fromId)
    .order('id', { ascending: true })
    .limit(count)
  if (error) throw new Error(`${table} fetch next rows failed: ${error.message}`)
  return (data || []) as Row[]
}

async function processSingleChunkWithRetry(table: 'sermon_chunks' | 'bible_verses', row: Row): Promise<{ ok: boolean; skipped: boolean }> {
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_CHUNK; attempt++) {
    try {
      const input = (row.text || '').trim()
      if (!input) {
        console.warn(`${table}: id=${row.id} has empty text, skipping`)
        return { ok: false, skipped: true }
      }

      const embeddingResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input,
      })
      const embedding = embeddingResponse.data[0]?.embedding
      if (!embedding) throw new Error('embedding missing in OpenAI response')

      const { error: updateError } = await supabase
        .from(table)
        .update({ embedding })
        .eq('id', row.id)

      if (updateError) throw new Error(`update failed: ${updateError.message}`)
      return { ok: true, skipped: false }
    } catch (error: any) {
      const msg = error?.message || String(error)
      if (attempt >= MAX_RETRIES_PER_CHUNK) {
        console.error(`${table}: SKIPPED id=${row.id} (failed after ${MAX_RETRIES_PER_CHUNK} retries). Retry later: --limit=1 or process manually. Error: ${msg}`)
        return { ok: false, skipped: true }
      }
      const delayMs = 2000 * Math.pow(2, attempt - 1)
      console.warn(`${table}: id=${row.id} attempt ${attempt} failed: ${msg}. Retrying in ${delayMs / 1000}s...`)
      await sleep(delayMs)
    }
  }
  return { ok: false, skipped: true }
}

async function processTable(table: 'sermon_chunks' | 'bible_verses', limit: number | null) {
  let totalProcessed = 0
  let successful = 0
  let skipped = 0

  const resumeId = await getResumeId(table)
  console.log(`\nStarting embeddings for ${table}...`)
  console.log(
    resumeId == null
      ? `${table}: no null-embedding rows found, already complete`
      : `${table}: resuming from first null embedding id ${resumeId}`
  )
  if (resumeId == null) return
  if (limit != null) console.log(`${table}: limit set to ${limit} chunks for this run`)

  const started = Date.now()
  let currentId = resumeId
  const initialRemaining = await countRemaining(table, currentId)
  if (initialRemaining === 0) {
    console.log(`${table}: nothing to process`)
    return
  }
  console.log(`${table}: initial remaining rows from id ${currentId}: ${initialRemaining}`)

  while (limit == null || totalProcessed < limit) {
    const toFetch = limit != null ? Math.min(PARALLEL_CHUNKS, limit - totalProcessed) : PARALLEL_CHUNKS
    let rows: Row[] = []
    try {
      rows = await fetchNextNullEmbeddingRows(table, currentId, toFetch)
    } catch (error: any) {
      console.error(`${table}: fetch error near id ${currentId}: ${error?.message || String(error)}. Waiting 2s then retrying...`)
      await sleep(FETCH_RETRY_DELAY_MS)
      continue
    }

    if (rows.length === 0) {
      console.log(`${table}: complete. Processed ${totalProcessed} rows (${successful} successful, ${skipped} skipped).`)
      break
    }

    const results = await Promise.all(rows.map(row => processSingleChunkWithRetry(table, row)))

    const batchSize = results.length
    totalProcessed += batchSize
    for (const r of results) {
      if (r.ok) successful += 1
      if (r.skipped) skipped += 1
    }
    currentId = Math.max(...rows.map(r => Number(r.id))) + 1

    if (totalProcessed % 100 === 0) {
      const elapsedMs = Date.now() - started
      const remaining = Math.max(0, initialRemaining - totalProcessed)
      const rate = totalProcessed / Math.max(1, elapsedMs / 1000)
      const etaSeconds = remaining / Math.max(0.0001, rate)
      const etaMinutes = (etaSeconds / 60).toFixed(1)
      console.log(
        `${table}: progress ${totalProcessed} processed | remaining ~${remaining} | ETA ~${etaMinutes} min | success=${successful} skipped=${skipped}`
      )
    }

    await sleep(INTER_CHUNK_DELAY_MS)
  }
}

async function main() {
  const started = Date.now()
  const limit = parseLimitArg()
  console.log('Generating embeddings with OpenAI text-embedding-3-small...')
  if (limit != null) console.log(`Per-table run limit: ${limit}`)

  await processTable('sermon_chunks', limit)
  await processTable('bible_verses', limit)

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nDone in ${seconds}s`)
}

main().catch(err => {
  console.error('Embedding generation failed:', err)
  process.exit(1)
})
