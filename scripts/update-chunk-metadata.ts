import { createClient } from '@supabase/supabase-js'

type SermonRow = {
  id: string
  title: string | null
  date: string | null
  reference_code: string | null
}

const BATCH_SIZE = 500

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function fetchAllSermons(): Promise<SermonRow[]> {
  const sermons: SermonRow[] = []
  let from = 0

  while (true) {
    const to = from + BATCH_SIZE - 1
    const { data, error } = await supabase
      .from('sermons')
      .select('id,title,date,reference_code')
      .order('id', { ascending: true })
      .range(from, to)

    if (error) throw new Error(`Failed fetching sermons ${from}-${to}: ${error.message}`)
    const rows = (data || []) as SermonRow[]
    if (!rows.length) break

    sermons.push(...rows)
    from += rows.length
    console.log(`Fetched ${sermons.length} sermons...`)
  }

  return sermons
}

async function updateChunkMetadataForSermon(sermon: SermonRow): Promise<number> {
  const payload = {
    sermon_title: sermon.title || '',
    sermon_date: sermon.date || '',
    sermon_reference_code: sermon.reference_code || '',
  }

  const { data, error } = await supabase
    .from('sermon_chunks')
    .update(payload)
    .eq('sermon_id', sermon.id)
    .select('id')

  if (error) throw new Error(`Failed updating chunks for sermon ${sermon.id}: ${error.message}`)
  return (data || []).length
}

async function main() {
  const started = Date.now()
  console.log('Starting sermon chunk metadata backfill...')

  const sermons = await fetchAllSermons()
  console.log(`Total sermons to process: ${sermons.length}`)

  let totalUpdated = 0
  for (let i = 0; i < sermons.length; i += BATCH_SIZE) {
    const batch = sermons.slice(i, i + BATCH_SIZE)
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1}: sermons ${i + 1}-${i + batch.length}`)

    for (const sermon of batch) {
      try {
        const updated = await updateChunkMetadataForSermon(sermon)
        totalUpdated += updated
      } catch (err: any) {
        console.error(`Error on sermon_id=${sermon.id}: ${err?.message || String(err)}`)
      }
    }

    console.log(`Batch complete. Running total updated chunks: ${totalUpdated}`)
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nDone in ${seconds}s. Updated ${totalUpdated} sermon_chunks rows.`)
}

main().catch(err => {
  console.error('update-chunk-metadata failed:', err)
  process.exit(1)
})
