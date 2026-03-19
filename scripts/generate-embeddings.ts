import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const BATCH_SIZE = 100
const EMBEDDING_MODEL = 'text-embedding-3-small'

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

async function processTable(table: 'sermon_chunks' | 'bible_verses') {
  let totalProcessed = 0
  let batchNumber = 0

  console.log(`\nStarting embeddings for ${table}...`)

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('id,text')
      .is('embedding', null)
      .limit(BATCH_SIZE)

    if (error) {
      throw new Error(`${table} fetch failed: ${error.message}`)
    }

    const rows = (data || []) as Row[]
    if (!rows.length) {
      console.log(`${table}: complete. Processed ${totalProcessed} rows.`)
      break
    }

    batchNumber += 1
    console.log(`${table}: batch ${batchNumber} -> ${rows.length} rows`)

    const inputs = rows.map(row => (row.text || '').trim())
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: inputs,
    })

    await Promise.all(
      rows.map(async (row, index) => {
        const embedding = embeddingResponse.data[index]?.embedding
        if (!embedding) return

        const { error: updateError } = await supabase
          .from(table)
          .update({ embedding })
          .eq('id', row.id)

        if (updateError) {
          throw new Error(`${table} update failed for id=${row.id}: ${updateError.message}`)
        }
      })
    )

    totalProcessed += rows.length
    console.log(`${table}: processed ${totalProcessed} total rows`)
  }
}

async function main() {
  const started = Date.now()
  console.log('Generating embeddings with OpenAI text-embedding-3-small...')

  await processTable('sermon_chunks')
  await processTable('bible_verses')

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nDone in ${seconds}s`)
}

main().catch(err => {
  console.error('Embedding generation failed:', err)
  process.exit(1)
})
