import 'server-only'

const THEOLOGICAL_SYNONYMS: Record<string, string[]> = {
  'holy ghost': ['holy spirit', 'spirit of god', 'comforter', 'spirit of christ'],
  'holy spirit': ['holy ghost', 'spirit of god', 'comforter'],
  'new birth': ['born again', 'regeneration', 'spirit filled', 'converted', 'saved'],
  'serpent seed': ['cain', 'beast', 'eve', 'garden', 'perversion', 'devil seed'],
  godhead: ['oneness', 'trinity', 'jesus name', 'father son holy ghost', 'one god'],
  rapture: ['translation', 'catching away', 'bride taken', 'escape'],
  bride: ['elected', 'called', 'chosen', 'wife of lamb', 'predestinated'],
  'seven seals': ['revelation seals', 'lamb book', 'mystery revealed'],
  'seven church ages': ['ephesus', 'laodicea', 'smyrna', 'pergamos', 'thyatira', 'sardis', 'philadelphia'],
  'mark of beast': ['666', 'antichrist', 'church system', 'organized religion'],
  token: ['seal', 'blood applied', 'holy ghost evidence'],
  vindicated: ['confirmed', 'proven', 'bore record', 'testified'],
  temperance: ['self control', 'moderation', 'soberness'],
  immodest: ['sexy', 'shorts', 'slacks', 'filthy dress', 'unclean apparel', 'worldly dress', 'painted face'],
  'thus saith the lord': ['word of god', 'scripture declares', 'bible says', 'it is written'],
  predestination: ['elected', 'foreknown', 'chosen before foundation', 'ordained'],
  'divine healing': ['faith healing', 'miracle healing', 'prayed for sick', 'gifts of healing'],
  'water baptism': ['baptized', 'immersion', 'jesus name baptism'],
  'second coming': ['return of christ', 'coming of lord', 'rapture'],
  faith: ['belief', 'trust', 'confidence', 'substance', 'evidence'],
  grace: ['unmerited favor', 'mercy', 'pardon', 'forgiveness'],
  holiness: ['sanctification', 'separation', 'set apart', 'clean living'],
  prayer: ['intercession', 'supplication', 'petition'],
  repentance: ['turn from sin', 'conviction', 'sorrow for sin', 'change of mind'],

  // Branham-specific vocabulary and doctrines
  'pillar of fire': ['supernatural light', 'exodus angel', 'god vindicating sign'],
  'third pull': ['spoken word', 'creative word', 'secret pull'],
  shout: ['midnight cry', 'message call'],
  voice: ['voice of archangel', 'living voice'],
  trump: ['trumpet of god', 'last trump'],
  squeeze: ['end-time persecution', 'pressure time'],
  jubilee: ['year of jubilee', 'release', 'liberty'],
  'kinsman redeemer': ['boaz', 'redeemer', 'blood relative redeemer'],
  'bosom of abraham': ['comfort side', 'old testament paradise'],
  paradise: ['eden restored', 'abraham bosom'],
  'outer darkness': ['weeping gnashing teeth', 'excluded from kingdom'],
  'foolish virgin': ['sleeping virgin', 'left behind church'],
  'foolish virgins': ['sleeping virgins', 'tribulation saints'],
  'wise virgin': ['prepared bride', 'oil in lamp'],
  justified: ['justification', 'declared righteous'],
  sanctified: ['separated', 'cleansed life'],
  'church age messengers': ['ephesian messenger', 'laodicean messenger'],
  'luther wesley branham': ['three reformers', 'justification sanctification holy ghost'],
  'irenaeus martin columba': ['church age stars', 'messenger lineage'],
  'original sin': ['fall in eden', 'adamic fall'],
  'fallen angels': ['watchers', 'rebellious angels'],
  nephilim: ['giants', 'sons of god'],
  giants: ['nephilim', 'antediluvian giants'],
  'constellation of angels': ['angelic host', 'heavenly signs'],
  'opening of the seals': ['seal revelation', '1963 seals'],
  'mysteries revealed': ['hidden truth opened', 'end-time mystery'],
  'elijah ministry': ['spirit of elijah', 'restoring prophet'],
  forerunner: ['forerunning message', 'prepare the way'],
  'malachi 4': ['elijah to children', 'restoration prophecy'],
  restoration: ['back to word', 'apostolic restoration'],
  'former latter rain': ['latter rain', 'double rain', 'rain revival'],
  'word bride': ['spoken word bride', 'elect lady'],
  supernatural: ['miraculous', 'divine intervention'],
  vision: ['seer gift', 'prophetic vision'],
  discernment: ['spirit discernment', 'revealing secrets'],
  'gifts of the spirit': ['nine gifts', 'spiritual gifts'],
  'speaking in tongues': ['tongues', 'unknown language'],
  interpretation: ['interpretation of tongues', 'spiritual interpretation'],
  prophecy: ['prophetic utterance', 'thus saith the lord'],
  'laying on of hands': ['impartation', 'prayer line'],
  anointing: ['unction', 'holy ghost power'],
  'power of god': ['dunamis', 'resurrection power'],
  resurrection: ['raising of dead', 'quickening'],
  'eternal life': ['zoe life', 'everlasting life'],
  immortality: ['incorruptible life', 'death swallowed up'],
  'glorified body': ['changed body', 'theophany body'],
  millennium: ['thousand years', 'millennial reign'],
  'great tribulation': ['jacobs trouble', 'tribulation period'],
  '144000': ['hundred forty four thousand', 'sealed israel'],
  oil: ['holy spirit oil', 'anointing oil'],
  lamp: ['lampstand', 'light vessel'],
  'wedding supper': ['marriage supper', 'supper of the lamb'],
  'white throne judgment': ['great white throne', 'final judgment'],
  'lake of fire': ['second death', 'eternal punishment'],
  'new jerusalem': ['holy city', 'bride city'],
  'tree of life': ['eden tree', 'life tree'],
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function uniqueTerms(items: string[]): string[] {
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

export function expandQuery(query: string): string[] {
  const base = query.trim()
  if (!base) return []

  const normalizedQuery = normalize(base)
  const tokens = normalizedQuery.split(' ').filter(w => w.length >= 3)
  const expanded: string[] = [base, ...tokens]

  for (const [term, synonyms] of Object.entries(THEOLOGICAL_SYNONYMS)) {
    const normalizedTerm = normalize(term)
    if (normalizedQuery.includes(normalizedTerm)) {
      expanded.push(term, ...synonyms)
    }
  }

  // Also allow single-token triggers (ex: "tribulation", "messengers", "elijah")
  for (const token of tokens) {
    if (THEOLOGICAL_SYNONYMS[token]) {
      expanded.push(token, ...THEOLOGICAL_SYNONYMS[token])
    }
  }

  return uniqueTerms(expanded)
}
