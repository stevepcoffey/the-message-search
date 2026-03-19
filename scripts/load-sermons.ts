import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

function clean(text: string): string {
  return text
    .replace(/[\u2028\u2029\u0085\u2000-\u206F]/g, ' ')
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function chunkText(text: string, size = 400, overlap = 50): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []
  let i = 0
  while (i < words.length) {
    const chunk = words.slice(i, i + size).join(' ')
    if (chunk.trim()) chunks.push(chunk)
    i += size - overlap
  }
  return chunks
}

async function loadSermons() {
  const dir = join(process.env.HOME!, 'Documents/Message')
  const files = readdirSync(dir).filter(f => f.endsWith('.txt'))
  console.log(`Found ${files.length} files`)

  for (const filename of files) {
    console.log(`\nProcessing ${filename}...`)
    const raw = readFileSync(join(dir, filename), 'utf-8')
    const content = clean(raw)
    const yearMatch = filename.match(/(\d{4})/)
    const year = yearMatch ? yearMatch[1] : '1900'

    const { data: sermon, error: se } = await supabase
      .from('sermons')
      .select('id')
      .eq('reference_code', filename.replace('.txt', ''))
      .single()

    let sermonId: number

    if (sermon) {
      sermonId = sermon.id
      console.log(`  Using existing sermon id ${sermonId}`)
    } else {
      const { data: newSermon, error: ie } = await supabase
        .from('sermons')
        .insert({
          title: filename.replace('.txt', ''),
          date: `${year}-01-01`,
          location: 'Unknown',
          reference_code: filename.replace('.txt', ''),
          full_text: content.slice(0, 50000),
          word_count: content.split(/\s+/).length,
          tags: []
        })
        .select()
        .single()

      if (ie || !newSermon) {
        console.error(`  Error inserting sermon:`, ie?.message)
        continue
      }
      sermonId = newSermon.id
    }

    const chunks = chunkText(content)
    console.log(`  ${chunks.length} chunks`)

    for (let i = 0; i < chunks.length; i += 50) {
      const batch = chunks.slice(i, i + 50).map((text, j) => ({
        sermon_id: sermonId,
        chunk_index: i + j,
        text: clean(text),
        char_start: 0,
        char_end: text.length
      }))

      const { error } = await supabase.from('sermon_chunks').insert(batch)
      if (error) console.error(`  Chunk error:`, error.message)
    }

    console.log(`  Done: ${filename}`)
  }

  console.log('\nAll done!')
}

loadSermons().catch(console.error)
