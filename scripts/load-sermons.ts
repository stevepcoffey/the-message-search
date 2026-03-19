import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

function clean(text: string): string {
  return text
    .replace(/[\u2028\u2029\u0085]/g, ' ')
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

function parseRefCode(code: string): string {
  // Format: YY-MMDD e.g. 47-0412 = April 12, 1947
  const match = code.match(/^(\d{2})-(\d{2})(\d{2})$/)
  if (!match) return `19${code.slice(0, 2)}-01-01`
  const year = parseInt(match[1]) > 24 ? `19${match[1]}` : `20${match[1]}`
  const month = match[2]
  const day = match[3]
  return `${year}-${month}-${day}`
}

function parseSermons(content: string, filename: string): Array<{title: string, date: string, reference_code: string, full_text: string}> {
  const sermons = []
  const lines = content.split('\n')
  
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    
    // Look for reference code pattern: YY-MMDD or YY-MMDDX
    if (/^\d{2}-\d{4,6}[A-Z]?$/.test(line)) {
      const refCode = line
      const title = i > 0 ? lines[i - 1].trim() : refCode
      
      // Collect text until next sermon
      let textLines = []
      let j = i + 1
      while (j < lines.length) {
        const nextLine = lines[j].trim()
        // Check if this is a new sermon reference code
        if (/^\d{2}-\d{4,6}[A-Z]?$/.test(nextLine) && j > i + 2) {
          break
        }
        textLines.push(lines[j])
        j++
      }
      
      const sermonText = textLines.join('\n')
      
      if (sermonText.trim().length > 100) {
        sermons.push({
          title: clean(title || refCode),
          date: parseRefCode(refCode),
          reference_code: refCode,
          full_text: clean(sermonText)
        })
      }
      
      i = j
    } else {
      i++
    }
  }
  
  // If no sermons found, treat whole file as one
  if (sermons.length === 0) {
    const yearMatch = filename.match(/(\d{4})/)
    const year = yearMatch ? yearMatch[1] : '1950'
    sermons.push({
      title: filename.replace('.txt', ''),
      date: `${year}-01-01`,
      reference_code: filename.replace('.txt', ''),
      full_text: clean(content)
    })
  }
  
  return sermons
}

async function loadSermons() {
  const dir = join(process.env.HOME!, 'Documents/Message')
  const files = readdirSync(dir).filter(f => f.endsWith('.txt'))
  console.log(`Found ${files.length} files`)

  let totalSermons = 0
  let totalChunks = 0

  for (const filename of files) {
    console.log(`\nProcessing ${filename}...`)
    const raw = readFileSync(join(dir, filename), 'utf-8')
    const sermons = parseSermons(raw, filename)
    console.log(`  Found ${sermons.length} sermons`)

    for (const sermon of sermons) {
      const { data: newSermon, error } = await supabase
        .from('sermons')
        .insert({
          title: sermon.title,
          date: sermon.date,
          location: 'Unknown',
          reference_code: sermon.reference_code,
          full_text: sermon.full_text.slice(0, 50000),
          word_count: sermon.full_text.split(/\s+/).length,
          tags: []
        })
        .select()
        .single()

      if (error || !newSermon) {
        console.error(`  Error inserting sermon ${sermon.title}:`, error?.message)
        continue
      }

      const chunks = chunkText(sermon.full_text)

      for (let i = 0; i < chunks.length; i += 50) {
        const batch = chunks.slice(i, i + 50).map((text, j) => ({
          sermon_id: newSermon.id,
          chunk_index: i + j,
          text: clean(text),
          char_start: 0,
          char_end: text.length
        }))

        const { error: ce } = await supabase.from('sermon_chunks').insert(batch)
        if (ce) console.error(`  Chunk error:`, ce.message)
      }

      totalChunks += chunks.length
      totalSermons++
      console.log(`  ✓ ${sermon.title} (${sermon.date}) - ${chunks.length} chunks`)
    }
  }

  console.log(`\nDone! ${totalSermons} sermons, ${totalChunks} chunks loaded.`)
}

loadSermons().catch(console.error)
