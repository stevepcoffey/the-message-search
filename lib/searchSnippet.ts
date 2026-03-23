/**
 * Shorten search hit text to a few sentences and pick the strongest matching phrase for emphasis.
 */

export type SearchMatchTypeForSnippet = 'relevant' | 'exact_phrase' | 'all_words'

const SNIPPET_MAX_SENTENCES = 3
const SNIPPET_MAX_CHARS = 520

const STOP = new Set([
  'what', 'is', 'the', 'are', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'about', 'how',
  'do', 'does', 'did', 'be', 'was', 'were', 'this', 'that', 'these', 'those', 'please', 'show', 'me',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'where', 'you', 'your', 'his', 'her',
])

function stripOuterQuotes(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1).trim()
  return t
}

/** Terms used to score sentences and build the "best phrase" window (aligned with UI highlight terms). */
export function queryTermsForSnippet(rawQuery: string, matchType: SearchMatchTypeForSnippet): { tokens: string[]; phrase: string | null } {
  const q = rawQuery.trim()
  if (!q) return { tokens: [], phrase: null }
  if (matchType === 'exact_phrase') {
    const phrase = stripOuterQuotes(q).toLowerCase()
    const tokens = phrase
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/gi, ''))
      .filter(w => w.length >= 3 && !STOP.has(w))
    return { tokens: [...new Set(tokens)], phrase: phrase || null }
  }
  const exactPhrases = [...q.matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean)
  if (exactPhrases.length) {
    const phrase = exactPhrases[0].toLowerCase()
    const tokens = phrase
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/gi, ''))
      .filter(w => w.length >= 3 && !STOP.has(w))
    return { tokens: [...new Set(tokens)], phrase }
  }
  const tokens = [
    ...new Set(
      q
        .split(/\s+/)
        .map(s => s.replace(/[^a-z0-9]/gi, '').trim())
        .filter(s => s.length >= 3 && !STOP.has(s.toLowerCase()))
        .map(s => s.toLowerCase())
    ),
  ]
  return { tokens, phrase: null }
}

function splitSentences(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return []
  const parts = t.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  if (parts.length > 1) return parts
  // Long block with weak punctuation — split into ~3 sentence-sized word windows for scoring
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length <= 55) return [t]
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += 45) {
    chunks.push(words.slice(i, i + 45).join(' '))
  }
  return chunks
}

function scoreSentence(s: string, tokens: string[], phrase: string | null): number {
  const lower = s.toLowerCase()
  let score = 0
  if (phrase && phrase.length >= 4 && lower.includes(phrase)) score += 120
  for (const tok of tokens) {
    if (tok.length < 3) continue
    if (lower.includes(tok)) score += Math.min(24, tok.length * 1.4)
  }
  return score
}

function pickSnippetSentences(sentences: string[], tokens: string[], phrase: string | null): string {
  if (sentences.length === 0) return ''
  const joinedLen = sentences.join(' ').length
  if (sentences.length <= SNIPPET_MAX_SENTENCES && joinedLen <= SNIPPET_MAX_CHARS) {
    return sentences.join(' ')
  }

  let bestIdx = 0
  let bestScore = -1
  for (let i = 0; i < sentences.length; i++) {
    const sc = scoreSentence(sentences[i], tokens, phrase)
    if (sc > bestScore) {
      bestScore = sc
      bestIdx = i
    }
  }

  if (bestScore <= 0) {
    let acc = ''
    for (const s of sentences) {
      const next = acc ? `${acc} ${s}` : s
      if (next.length > SNIPPET_MAX_CHARS && acc) break
      acc = next
      if (acc.length >= SNIPPET_MAX_CHARS * 0.5) break
    }
    return acc.slice(0, SNIPPET_MAX_CHARS).trim()
  }

  const max = SNIPPET_MAX_SENTENCES
  let start = Math.max(0, bestIdx - 1)
  let end = Math.min(sentences.length, start + max)
  if (end - start < max) start = Math.max(0, end - max)
  let snippet = sentences.slice(start, end).join(' ')
  if (snippet.length > SNIPPET_MAX_CHARS) {
    snippet = snippet.slice(0, SNIPPET_MAX_CHARS).trim()
    const cut = snippet.lastIndexOf(' ')
    if (cut > SNIPPET_MAX_CHARS * 0.6) snippet = snippet.slice(0, cut) + '…'
    else snippet += '…'
  }
  return snippet
}

/** Longest contiguous word span in snippet that best matches query tokens / phrase. */
export function extractBestPhrase(snippet: string, tokens: string[], phrase: string | null): string {
  if (!snippet.trim()) return ''
  const lower = snippet.toLowerCase()
  if (phrase && phrase.length >= 4) {
    const idx = lower.indexOf(phrase)
    if (idx !== -1) return snippet.slice(idx, idx + phrase.length)
  }

  const words = snippet.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const maxW = Math.min(16, words.length)
  const minW = Math.min(5, words.length)

  let best = ''
  let bestScore = 0
  for (let w = maxW; w >= minW; w--) {
    for (let i = 0; i + w <= words.length; i++) {
      const window = words.slice(i, i + w).join(' ')
      const wl = window.toLowerCase()
      let score = 0
      for (const tok of tokens) {
        if (tok.length < 3) continue
        if (wl.includes(tok)) score += tok.length * 2
      }
      if (score > bestScore) {
        bestScore = score
        best = window
      }
    }
    if (bestScore > 0) break
  }

  if (best) return best
  // Fallback: first ~8 words
  return words.slice(0, Math.min(8, words.length)).join(' ')
}

export function searchSnippetAndBestPhrase(
  fullText: string,
  rawQuery: string,
  matchType: SearchMatchTypeForSnippet
): { snippet: string; bestPhrase: string; truncated: boolean } {
  const { tokens, phrase } = queryTermsForSnippet(rawQuery, matchType)
  const raw = String(fullText || '').trim()
  if (!raw) return { snippet: '', bestPhrase: '', truncated: false }

  const sentences = splitSentences(raw)
  const snippet = pickSnippetSentences(sentences, tokens, phrase)
  const bestPhrase = extractBestPhrase(snippet, tokens, phrase)
  const truncated = snippet.length < raw.length
  return { snippet, bestPhrase, truncated }
}
