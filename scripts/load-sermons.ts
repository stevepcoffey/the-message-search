import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

function chunkText(text: string, chunkSize: number = 400, overlap: number = 50): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []
  let i = 0
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ')
    if (chunk.trim()) chunks.push(chunk)
    i += chunkSize - overlap
  }
  return chunks
}

function parseSermonFile(filename: string, content: string) {
  const yearMatch = filename.match(/(\d{4})/)
  const year = yearMatch ? yearMatch[1] : 'Unknown'
  
  const sermonBlocks = content.split(/\n(?=\d{2}-\d{4}|\d{4}-\d{2}-\d{2}|[A-Z]{3} \d{1,2},?\s+\d{4})/g)
  
  if (sermonBlocks.length <= 1) {
    return [{
      title: filename.replace('.txt', ''),
      date: `${year}-01-01`,
      location: 'Unknown',
      reference_code: year,
      full_text: content,
      word_count: content.split(/\s+/).length
    }]
  }

  return sermonBlocks.map(block => ({
    title: block.split('\n')[0]?.trim().slice(0, 200) || filename,
    date: `${year}-01-01`,
    location: 'Unknown',
    reference_code: year,
    full_text: block,
    word_count: block.split(/\s+/).length
  }))
}

async function loadSermons() {
  const messageDir = join(process.env.HOME!, 'Documents/Message')
  const files = readdirSync(messageDir).filter(f => f.endsWith('.txt'))
  
  console.log(`Found ${files.length} files in Documents/Message`)

  for (const filename of files) {
    console.log(`\nProcessing ${filename}...`)
    const content = readFileSync(join(messageDir, filename), 'utf-8')
    const sermons = parseSermonFile(filename, content)
    
    console.log(`  Found ${sermons.length} sermon(s)`)

    for (const sermon of sermons) {
      const { data: sermonData, error: sermonError } = await supabase
        .from('sermons')
        .insert({
          title: sermon.title,
          date: sermon.date,
          location: sermon.location,
          reference_code: sermon.reference_code,
          full_text: sermon.full_text,
          word_count: sermon.word_count,
          tags: []
        })
        .select()
        .single()

      if (sermonError) {
        console.error(`  Error inserting sermon:`, sermonError.message)
        continue
      }

      const chunks = chunkText(sermon.full_text)
      console.log(`  Splitting into ${chunks.length} chunks...`)

      for (let i = 0; i < chunks.length; i += 50) {
        const batch = chunks.slice(i, i + 50).map((text, j) => ({
          sermon_id: sermonData.id,
          chunk_index: i + j,
          text,
          char_start: 0,
          char_end: text.length
        }))

        const { error: chunkError } = await supabase
          .from('sermon_chunks')
          .insert(batch)

        if (chunkError) {
          console.error(`  Error inserting chunks:`, chunkError.message)
        }
      }

      console.log(`  ✓ Loaded: ${sermon.title}`)
    }
  }

  console.log('\nDone! All sermons loaded.')
}

loadSermons().catch(console.error)
