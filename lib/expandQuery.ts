import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const THEOLOGY_EXPANSIONS: Record<string, string[]> = {
  faith: ['belief', 'trust', 'substance', 'assurance'],
  grace: ['favor', 'mercy', 'unmerited favor'],
  trinity: ['godhead', 'Jesus name', 'Father Son Holy Ghost', 'oneness'],
  obedience: ['submit', 'yield', 'keep commandments'],
  healing: ['divine healing', 'restoration', 'deliverance'],
  'new birth': ['born again', 'regeneration', 'spiritual birth'],
  'holy spirit': ['Holy Ghost', 'baptism Spirit', 'Spirit of God'],
  'holy ghost': ['holy spirit', 'spirit baptism', 'anointing'],
  'seven church ages': ['Ephesus', 'Laodicea', 'Revelation church'],
  'serpent seed': ['Eve', 'garden', 'devil', 'seed', 'Cain', 'beast'],
  godhead: ['oneness', 'trinity', 'Jesus name', 'Father', 'Son'],
  'seven seals': ['Revelation', 'seals', 'Lamb', 'book'],
  rapture: ['translation', 'catching away', 'bride'],
  bride: ['elected', 'called', 'chosen', 'wife', 'Lamb'],
  'mark of beast': ['666', 'antichrist', 'church system'],
  vindication: ['pillar fire', 'angel', 'prophet', 'sign'],
  baptism: ['water baptism', 'name of jesus christ', 'immersion'],
  love: ['charity', 'brotherly kindness', 'agape'],
  fear: ['reverence', 'anxiety', 'perfect love casteth out fear'],
  prayer: ['intercession', 'supplication', 'ask and receive'],
  repentance: ['turning', 'confession', 'godly sorrow'],
  salvation: ['redemption', 'atonement', 'eternal life'],
}

function uniqueNormalized(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const t = raw.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

function fromHardcodedMap(query: string): string[] {
  const lower = query.toLowerCase()
  const out: string[] = []
  for (const [term, expansions] of Object.entries(THEOLOGY_EXPANSIONS)) {
    if (lower.includes(term)) out.push(...expansions)
  }
  return uniqueNormalized(out)
}

async function fromClaude(query: string): Promise<string[]> {
  try {
    const ai = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 120,
      system: 'Return only 3-4 short theological search terms separated by commas. No prose.',
      messages: [{ role: 'user', content: `Query: ${query}` }],
    })
    const text = ai?.content?.[0]?.type === 'text' ? ai.content[0].text : ''
    const parts = text
      .replace(/[\n;|]/g, ',')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 6)
    return uniqueNormalized(parts)
  } catch {
    return []
  }
}

export async function expandQuery(query: string): Promise<string> {
  const base = query.trim()
  if (!base) return ''

  const baseTokens = uniqueNormalized(base.split(/\s+/).filter(Boolean))
  const mapped = fromHardcodedMap(base)
  const suggested = await fromClaude(base)
  // Keep the original query and words first so expansions only supplement.
  const merged = uniqueNormalized([base, ...baseTokens, ...mapped, ...suggested])
  return merged.join(' ')
}
