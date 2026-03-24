import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

type ParsedParagraph = {
  paragraph_number: number
  text: string
  normalized_text: string
  word_count: number
}

type ParsedSermon = {
  title: string
  date: string
  reference_code: string
  /** Defaults to 'Unknown' when omitted (standard transcripts). */
  location?: string
  paragraphs: ParsedParagraph[]
}

/** Church Age Book (CAB.txt) — no YY-MMDD reference codes; one synthetic sermon. */
const CHURCH_AGE_BOOK = {
  filename: 'cab.txt',
  title: 'An Exposition Of The Seven Church Ages',
  reference_code: 'CAB',
  date: '1965-01-01',
  location: 'Jeffersonville',
} as const

const REF_CODE_RE = /^\s*(\d{2})-(\d{4})\s*$/
const PARAGRAPH_RE = /^\s*(\d{1,5})\s+(.*\S)?\s*$/
const MIN_WORDS = 20

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function cleanText(input: string): string {
  return input
    .replace(/\r/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wordCount(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length
}

function refCodeToDate(refCode: string): string {
  const m = refCode.match(/^(\d{2})-(\d{2})(\d{2})$/)
  if (!m) return ''
  const yy = Number(m[1])
  const year = yy >= 30 ? 1900 + yy : 2000 + yy
  let month = Number(m[2])
  let day = Number(m[3])

  // Some transcript ref codes use 00 placeholders; default to first valid date.
  if (month < 1 || month > 12) month = 1
  if (day < 1) day = 1
  const maxDay = new Date(year, month, 0).getDate()
  if (day > maxDay) day = 1

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function lastNonEmptyLine(lines: string[], fromIndex: number): string {
  for (let i = fromIndex; i >= 0; i--) {
    const line = lines[i].trim()
    if (line) return line
  }
  return ''
}

function parseParagraphs(lines: string[], stopOnRefCode = true): ParsedParagraph[] {
  const paragraphs: ParsedParagraph[] = []
  let currentNum: number | null = null
  let buffer: string[] = []

  const flush = () => {
    if (currentNum == null) return
    const text = cleanText(buffer.join(' ').trim())
    if (!text) {
      currentNum = null
      buffer = []
      return
    }
    const wc = wordCount(text)
    if (wc >= MIN_WORDS) {
      paragraphs.push({
        paragraph_number: currentNum,
        text,
        normalized_text: normalizeText(text),
        word_count: wc,
      })
    }
    currentNum = null
    buffer = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (stopOnRefCode && REF_CODE_RE.test(line)) {
      flush()
      break
    }
    const pm = line.match(PARAGRAPH_RE)
    if (pm) {
      flush()
      currentNum = Number(pm[1])
      if (pm[2]) buffer.push(pm[2])
    } else if (currentNum != null) {
      buffer.push(line)
    }
  }
  flush()
  return paragraphs
}

/** Entire CAB.txt as one sermon; numbered paragraphs only (no ref-code boundaries). */
function parseChurchAgeBook(content: string): ParsedSermon | null {
  const lines = content.replace(/\r/g, '').split('\n')
  const paragraphs = parseParagraphs(lines, false)
  if (!paragraphs.length) return null
  return {
    title: CHURCH_AGE_BOOK.title,
    date: CHURCH_AGE_BOOK.date,
    reference_code: CHURCH_AGE_BOOK.reference_code,
    location: CHURCH_AGE_BOOK.location,
    paragraphs,
  }
}

function parseSermonsInFile(content: string): ParsedSermon[] {
  const lines = content.replace(/\r/g, '').split('\n')
  const sermons: ParsedSermon[] = []

  const refIndexes: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (REF_CODE_RE.test(lines[i])) refIndexes.push(i)
  }

  for (let idx = 0; idx < refIndexes.length; idx++) {
    const refIndex = refIndexes[idx]
    const nextRefIndex = idx + 1 < refIndexes.length ? refIndexes[idx + 1] : lines.length

    const refCode = lines[refIndex].trim()
    const title = cleanText(lastNonEmptyLine(lines, refIndex - 1) || refCode)
    const date = refCodeToDate(refCode)
    const bodyLines = lines.slice(refIndex + 1, nextRefIndex)
    const paragraphs = parseParagraphs(bodyLines)

    if (!paragraphs.length) continue
    sermons.push({ title, date, reference_code: refCode, paragraphs })
  }

  return sermons
}

/** Insert sermon + chunks only when reference_code is new. Skip entirely if it already exists (no update, no chunk delete). */
async function insertSermonIfNew(sermon: ParsedSermon): Promise<string | 'skipped' | null> {
  const wc = sermon.paragraphs.reduce((n, p) => n + p.word_count, 0)

  const { data: existing, error: existingErr } = await supabase
    .from('sermons')
    .select('id')
    .eq('reference_code', sermon.reference_code)
    .maybeSingle()

  if (existingErr) {
    console.error(`Failed checking existing sermon ${sermon.reference_code}: ${existingErr.message}`)
    return null
  }

  const location = sermon.location ?? 'Unknown'

  if (existing?.id) {
    console.log(`  ⊘ skip (already exists): ${sermon.reference_code}`)
    return 'skipped'
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('sermons')
    .insert({
      title: sermon.title,
      date: sermon.date || null,
      location,
      reference_code: sermon.reference_code,
      word_count: wc,
    })
    .select('id')
    .single()

  if (insertErr || !inserted?.id) {
    console.error(`Failed inserting sermon ${sermon.reference_code}: ${insertErr?.message || 'unknown error'}`)
    return null
  }

  return String(inserted.id)
}

async function insertParagraphChunks(sermonId: string, paragraphs: ParsedParagraph[]): Promise<number> {
  let inserted = 0
  const batchSize = 200
  for (let i = 0; i < paragraphs.length; i += batchSize) {
    const batch = paragraphs.slice(i, i + batchSize).map(p => ({
      sermon_id: sermonId,
      paragraph_number: p.paragraph_number,
      chunk_index: p.paragraph_number,
      text: p.text,
      normalized_text: p.normalized_text,
      // search_vector is expected to be populated in DB via to_tsvector('english', text)
      // (typically by generated column or trigger).
    }))

    const { error } = await supabase.from('sermon_chunks').insert(batch)
    if (error) {
      console.error(`Chunk insert error for sermon_id=${sermonId}: ${error.message}`)
      continue
    }
    inserted += batch.length
  }
  return inserted
}

async function loadSermons() {
  const baseDir = join(process.env.HOME || '', 'Documents', 'Message')
  const files = readdirSync(baseDir).filter(f => f.toLowerCase().endsWith('.txt')).sort()
  console.log(`Found ${files.length} transcript files in ${baseDir}`)

  let totalSermons = 0
  let totalParagraphs = 0

  for (const filename of files) {
    const path = join(baseDir, filename)
    const raw = readFileSync(path, 'utf8')
    const sermons: ParsedSermon[] =
      filename.toLowerCase() === CHURCH_AGE_BOOK.filename
        ? (() => {
            const cab = parseChurchAgeBook(raw)
            return cab ? [cab] : []
          })()
        : parseSermonsInFile(raw)
    if (!sermons.length) {
      console.log(
        filename.toLowerCase() === CHURCH_AGE_BOOK.filename
          ? `- ${filename}: no numbered paragraphs found`
          : `- ${filename}: no sermon reference codes found`
      )
      continue
    }

    for (const sermon of sermons) {
      const sermonId = await insertSermonIfNew(sermon)
      if (sermonId === null || sermonId === 'skipped') continue

      const insertedParagraphs = await insertParagraphChunks(sermonId, sermon.paragraphs)
      totalSermons += 1
      totalParagraphs += insertedParagraphs
      console.log(`✓ ${sermon.title} (${sermon.reference_code}) - ${insertedParagraphs} paragraphs`)
    }
  }

  console.log(`\nDone! Loaded ${totalSermons} sermons and ${totalParagraphs} paragraphs.`)
}

loadSermons().catch(err => {
  console.error('load-sermons failed:', err)
  process.exit(1)
})
