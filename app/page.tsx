'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { supabase } from '@/lib/supabase'
import BibleReader from '@/components/BibleReader'

type Message = { role: 'user' | 'assistant'; content: string; sources?: any[] }
type Folder = { id: string; name: string; color: string; created_at?: string }
type SavedQuote = { id: string; quote_text: string; source_title: string; source_date: string; folder_id: string | null }
type SearchResult = { quote_text: string; source_title: string; source_date: string; source: 'message' | 'bible' }
type SearchSource = 'both' | 'message' | 'bible'
type SearchMatchType = 'exact_phrase' | 'all_words'
type SermonSort = 'newest' | 'oldest'
type SermonDecade = 'all' | '1947-49' | '1950s' | '1960s'
type SermonItem = {
  id: string
  title: string
  date: string | null
  location: string | null
  reference_code: string | null
  full_text: string | null
  word_count: number | null
}
type View = 'chat' | 'sermons' | 'reader' | 'bookmarks' | 'bible' | 'settings'
type HistoryItem = { id: string; text: string; mode: 'chat' | 'search' }

/** Primary actions / filled buttons */
const CTA = '#72A276'
/** Light mint — highlights, dark-mode titles, subtle accents */
const MINT = '#A0EEC0'
const CTA_MUTED_BG = 'rgba(114, 162, 118, 0.18)'

/** Selected nav / tab: darker green + high-contrast (white) label — no green-on-green text. */
function navSelectedStyle(darkMode: boolean): { background: string; color: string } {
  return darkMode
    ? { background: '#3d5c45', color: '#ffffff' }
    : { background: '#4a6b52', color: '#ffffff' }
}

const LANDING_EXAMPLES: { mode: 'chat' | 'search'; label: string; q: string }[] = [
  { mode: 'chat', label: 'Chat', q: 'What does Branham say about the Bride?' },
  { mode: 'chat', label: 'Chat', q: 'Explain the seven church ages' },
  { mode: 'search', label: 'Exact phrase', q: '"The holy ghost is"' },
  { mode: 'search', label: 'Exact phrase', q: '"born again"' },
]

const COLORS = ['#A0EEC0', '#72A276', '#525252', '#404040', '#262626', '#000000']

const ui = {
  light: {
    bg: '#F3F3F0',
    bg2: '#E7E7E3',
    bg3: '#D6D6D1',
    text: '#000000',
    text2: '#353539',
    text3: '#66666E',
    border: 'rgba(0,0,0,0.13)',
    shadow: '0 1px 3px rgba(0,0,0,0.07)',
  },
  dark: {
    bg: '#0C0C0E',
    bg2: '#18181B',
    bg3: '#27272A',
    text: '#FFFFFF',
    text2: 'rgba(255,255,255,0.78)',
    text3: 'rgba(255,255,255,0.52)',
    border: 'rgba(255,255,255,0.08)',
    shadow: 'none',
  },
}

const SERMON_PAGE_SIZE = 50

function fmtSermonDate(dateStr?: string | null): string {
  if (!dateStr) return 'Unknown date'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function HomeLanding({
  t,
  onPick,
}: {
  t: (typeof ui)['light']
  onPick: (mode: 'chat' | 'search', q: string) => void
}) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '8px 0 28px', textAlign: 'center' }}>
      <div
        style={{
          width: 48,
          height: 48,
          margin: '0 auto 18px',
          borderRadius: 12,
          background: CTA,
          display: 'grid',
          placeItems: 'center',
        }}
        aria-hidden
      >
        <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
          <path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 style={{ ...h1, fontSize: 'clamp(1.35rem, 4vw, 1.85rem)', fontWeight: 700, marginBottom: 14, letterSpacing: '-0.02em' }}>Search the Message &amp; Bible</h1>
      <p
        style={{
          color: t.text2,
          fontSize: 'clamp(0.95rem, 2.5vw, 1.05rem)',
          lineHeight: 1.65,
          margin: '0 auto 28px',
          maxWidth: 520,
          textAlign: 'center',
        }}
      >
        Chat for AI answers, or search for exact quotes from William Branham&apos;s sermons and the KJV Bible. Results from both sources appear together.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
          gap: 12,
          textAlign: 'left',
        }}
      >
        {LANDING_EXAMPLES.map((ex, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(ex.mode, ex.q)}
            style={{
              ...card(t),
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: 0,
              padding: 14,
              transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: '0.1em', color: '#525252', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase' }}>{ex.label}</div>
            <div style={{ color: t.text, fontWeight: 500, lineHeight: 1.5, fontSize: '0.95em' }}>{ex.q}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const [view, setView] = useState<View>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [fontSize, setFontSize] = useState(16)

  const [user, setUser] = useState<any>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  const [mode, setMode] = useState<'chat' | 'search'>('chat')
  const [searchSource, setSearchSource] = useState<SearchSource>('both')
  const [searchMatchType, setSearchMatchType] = useState<SearchMatchType>('exact_phrase')
  const [query, setQuery] = useState('')
  const [lastSearchQuery, setLastSearchQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  const [folders, setFolders] = useState<Folder[]>([])
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState(COLORS[2])

  const [saveModal, setSaveModal] = useState<{ text: string; title: string; date: string } | null>(null)
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const [currentSermon, setCurrentSermon] = useState<SermonItem | null>(null)
  const [sermonSearch, setSermonSearch] = useState('')
  const [sermonSort, setSermonSort] = useState<SermonSort>('newest')
  const [sermonDecade, setSermonDecade] = useState<SermonDecade>('all')
  const [sermonRows, setSermonRows] = useState<SermonItem[]>([])
  const [sermonTotal, setSermonTotal] = useState(0)
  const [sermonGrandTotal, setSermonGrandTotal] = useState(0)
  const [sermonPage, setSermonPage] = useState(0)
  const [sermonHasMore, setSermonHasMore] = useState(true)
  const [sermonLoading, setSermonLoading] = useState(false)
  const [bibleLoc, setBibleLoc] = useState({ book: 'Genesis', chapter: 1 })
  /** From sidebar "Folders": show only folder list (newest first), not all saved quotes. */
  const [foldersListOnly, setFoldersListOnly] = useState(false)

  const onBibleBookChapter = useCallback((b: string, c: number) => {
    setBibleLoc({ book: b, chapter: c })
  }, [])

  const taRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const t = darkMode ? ui.dark : ui.light
  const headingTone = darkMode ? MINT : '#27272A'

  useEffect(() => {
    const saved = window.localStorage.getItem('apple-dark-mode')
    if (saved === 'true') setDarkMode(true)
  }, [])

  useEffect(() => {
    window.localStorage.setItem('apple-dark-mode', String(darkMode))
  }, [darkMode])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) {
      loadFolders()
      loadQuotes()
    }
  }, [user])

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.style.height = Math.min(Math.max(taRef.current.scrollHeight, 48), 160) + 'px'
    }
  }, [query])

  useEffect(() => {
    if (mode === 'search') {
      scrollAreaRef.current?.scrollTo({ top: 0, behavior: searchResults.length ? 'smooth' : 'auto' })
    }
  }, [searchResults, mode])

  useEffect(() => {
    if (mode === 'chat') {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading, mode])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }, [])

  const loadFolders = async () => {
    const { data } = await supabase.from('folders').select('*').order('created_at')
    setFolders(data || [])
  }

  const loadQuotes = async () => {
    const { data } = await supabase.from('saved_quotes').select('*').order('created_at', { ascending: false })
    setSavedQuotes(data || [])
  }

  const loadSermons = useCallback(async (page: number, append: boolean) => {
    setSermonLoading(true)
    const q = sermonSearch.trim()
    const from = page * SERMON_PAGE_SIZE
    const to = from + SERMON_PAGE_SIZE - 1

    let queryBuilder = supabase
      .from('sermons')
      .select('id,title,date,location,reference_code,full_text,word_count', { count: 'exact' })

    if (q) {
      queryBuilder = queryBuilder.or(`title.ilike.%${q}%,reference_code.ilike.%${q}%`)
    }

    if (sermonDecade === '1947-49') queryBuilder = queryBuilder.gte('date', '1947-01-01').lt('date', '1950-01-01')
    if (sermonDecade === '1950s') queryBuilder = queryBuilder.gte('date', '1950-01-01').lt('date', '1960-01-01')
    if (sermonDecade === '1960s') queryBuilder = queryBuilder.gte('date', '1960-01-01').lt('date', '1970-01-01')

    const { data, count, error } = await queryBuilder
      .order('date', { ascending: sermonSort === 'oldest', nullsFirst: false })
      .range(from, to)

    if (error) {
      showToast(error.message || 'Failed to load sermons')
      setSermonLoading(false)
      return
    }

    let rows = (data || []) as SermonItem[]
    if (q) {
      const lq = q.toLowerCase()
      rows = rows.filter(r =>
        (r.title || '').toLowerCase().includes(lq) ||
        (r.reference_code || '').toLowerCase().includes(lq) ||
        fmtSermonDate(r.date).toLowerCase().includes(lq)
      )
    }

    setSermonTotal(count || 0)
    setSermonHasMore(from + rows.length < (count || 0))
    setSermonRows(prev => (append ? [...prev, ...rows] : rows))
    setSermonPage(page)
    setSermonLoading(false)
  }, [sermonSearch, sermonDecade, sermonSort, showToast])

  const loadSermonGrandTotal = useCallback(async () => {
    const { count } = await supabase.from('sermons').select('id', { count: 'exact', head: true })
    setSermonGrandTotal(count || 0)
  }, [])

  useEffect(() => {
    loadSermonGrandTotal()
  }, [loadSermonGrandTotal])

  useEffect(() => {
    const id = window.setTimeout(() => {
      loadSermons(0, false)
    }, 220)
    return () => window.clearTimeout(id)
  }, [loadSermons])

  const signIn = async () => {
    setAuthLoading(true)
    setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
    else { setAuthMode(null); setEmail(''); setPassword('') }
    setAuthLoading(false)
  }

  const signUp = async () => {
    setAuthLoading(true)
    setAuthError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setAuthError(error.message)
    else { setAuthMode(null); setEmail(''); setPassword(''); showToast('Account created') }
    setAuthLoading(false)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setFolders([])
    setSavedQuotes([])
    setActiveFolder(null)
  }

  const createFolder = async () => {
    if (!newFolderName.trim() || !user) return
    const { error } = await supabase.from('folders').insert({ name: newFolderName.trim(), color: newFolderColor, user_id: user.id })
    if (error) return showToast(error.message || 'Failed to create folder')
    setNewFolderName('')
    setShowNewFolder(false)
    await loadFolders()
    showToast('Folder created')
  }

  const saveQuote = async () => {
    if (!saveModal || !user) return
    const { error } = await supabase.from('saved_quotes').insert({
      user_id: user.id,
      quote_text: saveModal.text,
      source_title: saveModal.title || 'William Branham Sermon',
      source_date: saveModal.date || '',
      source_type: 'message',
      folder_id: saveFolderId || null,
    })
    if (!error) {
      await loadQuotes()
      setSaveModal(null)
      setSaveFolderId(null)
      showToast('Quote saved')
    }
  }

  const deleteQuote = async (id: string) => {
    await supabase.from('saved_quotes').delete().eq('id', id)
    setSavedQuotes(prev => prev.filter(q => q.id !== id))
    showToast('Quote removed')
  }

  const deleteFolder = async (folderId: string) => {
    if (!folderId) return
    const ok = window.confirm('Delete this folder? Quotes will be kept and moved out of this folder.')
    if (!ok) return

    const { error: detachError } = await supabase
      .from('saved_quotes')
      .update({ folder_id: null })
      .eq('folder_id', folderId)

    if (detachError) {
      showToast(detachError.message || 'Failed to remove quotes from folder')
      return
    }

    let deleteQuery = supabase.from('folders').delete().eq('id', folderId)
    if (user?.id) deleteQuery = deleteQuery.eq('user_id', user.id)
    const { error: deleteError } = await deleteQuery
    if (deleteError) {
      showToast(deleteError.message || 'Failed to delete folder')
      return
    }

    setFolders(prev => prev.filter(f => f.id !== folderId))
    setSavedQuotes(prev => prev.map(q => (q.folder_id === folderId ? { ...q, folder_id: null } : q)))
    if (activeFolder?.id === folderId) setActiveFolder(null)
    showToast('Folder deleted')
  }

  const getPlainTextFromNode = (node: any): string => {
    if (node == null) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(getPlainTextFromNode).join('')
    if (node.props?.children) return getPlainTextFromNode(node.props.children)
    return ''
  }

  const extractSavableQuote = (content: string) => {
    const lines = content.split('\n')
    const firstQuoteLine = lines.findIndex(line => /^\s*>\s?/.test(line))
    if (firstQuoteLine !== -1) {
      const quoteLines: string[] = []
      for (let i = firstQuoteLine; i < lines.length; i++) {
        if (!/^\s*>\s?/.test(lines[i])) break
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''))
      }
      const quote = quoteLines.join('\n').trim()
      if (quote) return quote
    }
    return content.replace(/\s+/g, ' ').trim().slice(0, 200)
  }

  const getSearchHighlightTerms = (raw: string, matchType: SearchMatchType): string[] => {
    const q = raw.trim()
    if (!q) return []
    if (matchType === 'exact_phrase') {
      const phrase = q.replace(/^"+|"+$/g, '').trim()
      return phrase ? [phrase] : []
    }
    const exactPhrases = [...q.matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean)
    if (exactPhrases.length) return [...new Set(exactPhrases)]
    return [...new Set(q.split(/\s+/).map(s => s.trim()).filter(s => s.length >= 2))]
  }

  const highlightMatches = (text: string, rawQuery: string, matchType: SearchMatchType) => {
    const terms = getSearchHighlightTerms(rawQuery, matchType)
    if (!terms.length || !text) return [text]
    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`(${escaped.join('|')})`, 'ig')
    return text.split(re).map((part, idx) =>
      idx % 2 === 1
        ? <mark key={`hl-${idx}`} style={{ background: '#A0EEC0', color: '#1F2937', padding: '0 2px', borderRadius: 3 }}>{part}</mark>
        : part
    )
  }

  const copyText = (text: string, i: number) => {
    navigator.clipboard.writeText(text)
    setCopied(i)
    setTimeout(() => setCopied(null), 1500)
  }

  const send = async () => {
    if (!query.trim() || loading) return
    const q = query.trim()
    setQuery('')
    setLoading(true)

    if (mode === 'search') {
      setSearchResults([])
      setLastSearchQuery(q)
      setHistory(prev => [{ id: `${Date.now()}`, text: q, mode: 'search' as const }, ...prev].slice(0, 20))
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, source: searchSource, match_type: searchMatchType }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Search failed')
        setSearchResults(data.results || [])
      } catch (error: any) {
        setSearchResults([])
        showToast(error?.message || 'Search failed')
      }
      setLoading(false)
      return
    }

    setHistory(prev => [{ id: `${Date.now()}`, text: q, mode: 'chat' as const }, ...prev].slice(0, 20))
    const next = [...messages, { role: 'user', content: q } as Message]
    setMessages(next)
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
      const data = await res.json()
      setMessages([...next, { role: 'assistant', content: data.response, sources: data.sources }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong.', sources: [] }])
    }
    setLoading(false)
  }

  const folderQuotes = useMemo(() => activeFolder ? savedQuotes.filter(q => q.folder_id === activeFolder.id) : [], [activeFolder, savedQuotes])

  const foldersSorted = useMemo(() => {
    return [...folders].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
  }, [folders])

  if (authMode) {
    return (
      <div style={{ minHeight: '100vh', background: t.bg, color: t.text, display: 'grid', placeItems: 'center', fontFamily: fontStack, fontSize, fontWeight: 500, lineHeight: 1.7 }}>
        <div style={{ width: 'min(400px, calc(100vw - 32px))', maxWidth: '100%', boxSizing: 'border-box', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24, boxShadow: t.shadow }}>
          <h2 style={{ fontSize: '1.125em', fontWeight: 600, marginBottom: 6, overflowWrap: 'anywhere' }}>{authMode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <p style={{ color: t.text2, marginBottom: 12, fontSize: '0.9375em' }}>Access folders, bookmarks, and history.</p>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email" style={inputStyle(t)} />
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? signIn() : signUp())} style={inputStyle(t, { marginTop: 8 })} />
          {authError && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 8 }}>{authError}</p>}
          <button onClick={authMode === 'login' ? signIn : signUp} style={primaryBtn()}>{authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} style={flatBtn(CTA)}>{authMode === 'login' ? 'Create account' : 'Sign in instead'}</button>
            <button onClick={() => setAuthMode(null)} style={flatBtn(t.text2)}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', background: t.bg, color: t.text, fontFamily: fontStack, fontSize, fontWeight: 500, lineHeight: 1.7, transition: 'background 0.15s ease, color 0.15s ease', overflow: 'hidden' }}>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: t.bg3, color: t.text, border: `1px solid ${t.border}`, borderRadius: 999, padding: '7px 12px', fontSize: 12, zIndex: 200 }}>{toast}</div>}

      {saveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 180, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 'min(430px, calc(100vw - 32px))', maxWidth: '100%', boxSizing: 'border-box', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 16, padding: 18, boxShadow: t.shadow }}>
            <h3 style={{ fontSize: '1.125em', fontWeight: 600, marginBottom: 8, overflowWrap: 'anywhere' }}>Save Quote</h3>
            <p style={{ borderLeft: `3px solid ${CTA}`, paddingLeft: 10, fontStyle: 'italic', marginBottom: 12 }}>"{saveModal.text.slice(0, 220)}{saveModal.text.length > 220 ? '...' : ''}"</p>
            {folders.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: t.text2, marginBottom: 6 }}>Folder (optional)</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {folders.map(f => (
                    <button key={f.id} onClick={() => setSaveFolderId(saveFolderId === f.id ? null : f.id)} style={{ ...pillBtn(t), background: saveFolderId === f.id ? `${f.color}2a` : t.bg3, borderColor: saveFolderId === f.id ? f.color : t.border, color: saveFolderId === f.id ? f.color : t.text2 }}>{f.name}</button>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveQuote} style={{ ...primaryBtn(false), flex: 1 }}>Save</button>
              <button onClick={() => { setSaveModal(null); setSaveFolderId(null) }} style={{ ...secondaryBtn(t), flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', height: '100%' }}>
        <aside style={{ width: sidebarOpen ? 245 : 0, minWidth: sidebarOpen ? 245 : 0, overflow: 'hidden', transition: 'all 0.15s ease', background: t.bg2, borderRight: `1px solid ${t.border}` }}>
          <div style={{ width: 245, height: '100vh', display: 'flex', flexDirection: 'column', padding: 10, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px', flexShrink: 0 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: CTA, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-label="App logo">
                <svg width="22" height="22" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <button type="button" onClick={() => setSidebarOpen(false)} style={iconBtn(t)} aria-label="Close sidebar">✕</button>
            </div>

            <button
              type="button"
              onClick={() => {
                setView('chat')
                setMode('chat')
                setMessages([])
                setSearchResults([])
                setFoldersListOnly(false)
              }}
              style={{ ...primaryBtn(false), width: '100%', marginBottom: 8, flexShrink: 0 }}
            >
              + New search
            </button>

            {(
              [
                {
                  key: 'chat',
                  label: 'Chat',
                  active: view === 'chat' && mode === 'chat',
                  onClick: () => {
                    setView('chat')
                    setMode('chat')
                    setFoldersListOnly(false)
                  },
                },
                {
                  key: 'search',
                  label: 'Search',
                  active: view === 'chat' && mode === 'search',
                  onClick: () => {
                    setView('chat')
                    setMode('search')
                    setFoldersListOnly(false)
                  },
                },
                {
                  key: 'folders',
                  label: 'Folders',
                  active: view === 'bookmarks',
                  onClick: () => {
                    setView('bookmarks')
                    setActiveFolder(null)
                    setFoldersListOnly(true)
                  },
                },
                {
                  key: 'bible',
                  label: 'Bible',
                  active: view === 'bible',
                  onClick: () => {
                    setView('bible')
                    setFoldersListOnly(false)
                  },
                },
                {
                  key: 'sermons',
                  label: 'Sermon Library',
                  active: view === 'sermons' || view === 'reader',
                  onClick: () => {
                    setView('sermons')
                    setFoldersListOnly(false)
                  },
                },
              ] as const
            ).map(item => (
              <button
                type="button"
                key={item.key}
                onClick={item.onClick}
                style={{ ...navBtn(t, item.active, darkMode), marginBottom: 2, flexShrink: 0 }}
              >
                {item.label}
              </button>
            ))}

            <div style={{ marginTop: 10, borderTop: `1px solid ${t.border}`, paddingTop: 8, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <div style={{ fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 6px 4px' }}>Folders</div>
              {user && (
                <button
                  type="button"
                  onClick={() => {
                    setView('bookmarks')
                    setActiveFolder(null)
                    setFoldersListOnly(false)
                  }}
                  style={{ ...folderRowBtn(t), marginBottom: 4 }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: t.text3, opacity: 0.5 }} />
                  <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>All saved quotes</span>
                </button>
              )}
              {folders.length === 0 ? (
                <p style={{ color: t.text2, fontSize: '0.8125em', padding: '0 6px' }}>No folders yet</p>
              ) : folders.map(f => (
                <button
                  key={f.id}
                  onClick={() => {
                    setView('bookmarks')
                    setActiveFolder(f)
                    setFoldersListOnly(false)
                  }}
                  style={{ ...folderRowBtn(t) }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: f.color }} />
                  <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: t.text3 }}>{savedQuotes.filter(q => q.folder_id === f.id).length}</span>
                </button>
              ))}

              <div style={{ fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '12px 6px 4px' }}>History</div>
              {history.length === 0 ? (
                <p style={{ color: t.text2, fontSize: 12, padding: '0 6px' }}>No recent searches yet</p>
              ) : history.map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    setView('chat')
                    setMode(item.mode)
                    setQuery(item.text)
                    setFoldersListOnly(false)
                  }}
                  style={{ ...folderRowBtn(t), padding: '7px 8px' }}
                  title={item.text}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: item.mode === 'chat' ? CTA : t.text3 }} />
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: 'auto', flexShrink: 0, borderTop: `1px solid ${t.border}`, paddingTop: 8 }}>
              <button type="button" onClick={() => setView('settings')} style={{ ...navBtn(t, view === 'settings', darkMode), width: '100%', marginBottom: 8 }}>Settings</button>
            </div>

            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 8, flexShrink: 0 }}>
              {!user ? (
                <>
                  <p style={{ fontSize: 12, color: t.text2, marginBottom: 8 }}>Sign in to save quotes and folders.</p>
                  <button onClick={() => setAuthMode('login')} style={{ ...primaryBtn(false), width: '100%' }}>Sign in</button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: t.text2, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
                  <button onClick={signOut} style={{ ...secondaryBtn(t), width: '100%' }}>Sign out</button>
                </>
              )}
            </div>
          </div>
        </aside>

        <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <header style={{ minHeight: 52, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 14px', background: t.bg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              {!sidebarOpen && (
                <button type="button" onClick={() => setSidebarOpen(true)} style={iconBtn(t)}>
                  ☰
                </button>
              )}
              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 999, padding: 4 }}>
                {([
                  { id: 'chat', label: 'Chat', onClick: () => { setView('chat'); setMode('chat') }, active: view === 'chat' && mode === 'chat' },
                  { id: 'search', label: 'Search', onClick: () => { setView('chat'); setMode('search') }, active: view === 'chat' && mode === 'search' },
                  { id: 'bible', label: 'Bible', onClick: () => setView('bible'), active: view === 'bible' },
                  { id: 'folders', label: 'Folders', onClick: () => { setView('bookmarks'); setActiveFolder(null); setFoldersListOnly(true) }, active: view === 'bookmarks' },
                  { id: 'sermons', label: 'Sermon Library', onClick: () => setView('sermons'), active: view === 'sermons' || view === 'reader' },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={tab.onClick}
                    style={{ border: 'none', borderRadius: 999, padding: '6px 10px', background: tab.active ? '#86CD82' : 'transparent', color: tab.active ? '#17351f' : t.text2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: '0.9375em', color: t.text, overflowWrap: 'anywhere', fontWeight: 600 }}>
                {view === 'bible'
                  ? `${bibleLoc.book} · Chapter ${bibleLoc.chapter}`
                  : view === 'reader'
                    ? (currentSermon?.title || 'Sermon')
                    : viewTitle(view, currentSermon?.title || 'Sermon')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button type="button" onClick={() => setFontSize(v => Math.max(14, v - 1))} style={iconBtn(t)}>A-</button>
              <button type="button" onClick={() => setFontSize(v => Math.min(20, v + 1))} style={iconBtn(t)}>A+</button>
              <button type="button" onClick={() => setDarkMode(v => !v)} style={iconBtn(t)}>{darkMode ? '☀' : '☾'}</button>
            </div>
          </header>

          {view === 'chat' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div ref={scrollAreaRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '18px 18px 0', WebkitOverflowScrolling: 'touch' }}>
                <div style={{ maxWidth: 760, margin: '0 auto', minWidth: 0 }}>
                  {mode === 'search' ? (
                    <>
                      {!searchResults.length && !loading && (
                        <HomeLanding t={t} onPick={(m, q) => { setMode(m); setQuery(q); setTimeout(() => taRef.current?.focus(), 0) }} />
                      )}
                      {searchResults.map((r, i) => (
                        <div key={i} style={{ borderBottom: `1px solid ${t.border}`, padding: '12px 4px', minWidth: 0 }}>
                          <p style={{ margin: 0, borderLeft: `3px solid ${CTA}`, paddingLeft: 12, fontStyle: 'italic', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                            "{highlightMatches(r.quote_text, lastSearchQuery, searchMatchType)}"
                          </p>
                          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                            <div style={{ minWidth: 0, flex: '1 1 140px' }}>
                              <div style={{ fontWeight: 600, color: headingTone, fontSize: '0.875em', overflowWrap: 'anywhere' }}>{r.source_title || (r.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')}</div>
                              <div style={{ color: t.text2, fontSize: '0.8125em' }}>{r.source_date || (r.source === 'bible' ? 'KJV' : '')}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0, justifyContent: 'flex-end' }}>
                              <button type="button" onClick={() => copyText(r.quote_text, i)} style={pillBtn(t)}>{copied === i ? 'Copied' : 'Copy'}</button>
                              <button type="button" onClick={() => { if (!user) return showToast('Sign in to save quotes'); setSaveModal({ text: r.quote_text, title: r.source_title, date: r.source_date }) }} style={pillBtn(t)}>Save</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      {!messages.length && !loading && (
                        <HomeLanding t={t} onPick={(m, q) => { setMode(m); setQuery(q); setTimeout(() => taRef.current?.focus(), 0) }} />
                      )}
                      {messages.map((m, i) => (
                        <div key={i} style={{ marginBottom: 16 }}>
                          {m.role === 'user' ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
                              <div style={{ maxWidth: 'min(75%, 100%)' }}>
                                <div style={{ background: CTA, color: '#fff', borderRadius: 18, padding: '10px 14px', overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{m.content}</div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg3, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke={CTA} strokeWidth="1.5" strokeLinejoin="round"/></svg>
                              </div>
                              <div style={{ flex: 1, minWidth: 0, background: t.bg2, borderRadius: 14, border: `1px solid ${t.border}`, padding: '10px 12px', overflow: 'hidden' }}>
                                <ReactMarkdown components={{
                                  p: ({ children }) => <p style={{ margin: '0 0 8px', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</p>,
                                  h2: ({ children }) => <h2 style={{ ...h2, marginTop: 12 }}>{children}</h2>,
                                  h3: ({ children }) => <h3 style={{ ...h2, fontSize: '1.05em', marginTop: 10 }}>{children}</h3>,
                                  blockquote: ({ children }) => {
                                    const quoteText = getPlainTextFromNode(children).trim()
                                    return (
                                      <div style={{ position: 'relative', margin: '9px 0' }}>
                                        <blockquote style={{ margin: 0, borderLeft: `3px solid ${CTA}`, paddingLeft: 12, paddingRight: 34, fontStyle: 'italic', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</blockquote>
                                        <button onClick={() => { if (!user) return showToast('Sign in to save quotes'); if (!quoteText) return; setSaveModal({ text: quoteText, title: m.sources?.[0]?.title || 'William Branham Sermon', date: m.sources?.[0]?.date || '' }) }} style={{ ...pillBtn(t), position: 'absolute', top: -1, right: 0, width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center' }}>
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                                        </button>
                                      </div>
                                    )
                                  },
                                }}>{m.content || ''}</ReactMarkdown>

                                {m.sources && m.sources.length > 0 && (
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, minWidth: 0 }}>
                                    {m.sources.map((s: any, idx: number) => (
                                      <div key={idx} style={{ background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: '8px 10px', minWidth: 0, maxWidth: '100%', flex: '1 1 140px' }}>
                                        <div style={{ fontSize: '0.875em', fontWeight: 600, color: headingTone, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{s.title || 'William Branham Sermon'}</div>
                                        <div style={{ fontSize: '0.8125em', color: t.text2, overflowWrap: 'anywhere' }}>{s.date || ''}{s.ref ? ` · #${s.ref}` : ''}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap', minWidth: 0 }}>
                                  <button type="button" onClick={() => copyText(m.content, i)} style={pillBtn(t)}>{copied === i ? 'Copied' : 'Copy'}</button>
                                  <button type="button" onClick={() => { if (!user) return showToast('Sign in to save quotes'); setSaveModal({ text: extractSavableQuote(m.content || ''), title: m.sources?.[0]?.title || 'William Branham Sermon', date: m.sources?.[0]?.date || '' }) }} style={pillBtn(t)}>Save</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                  {loading && <p style={{ color: t.text2, fontSize: '0.875em' }}>Loading...</p>}
                  {mode === 'chat' && <div ref={endRef} />}
                </div>
              </div>

              <div style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, padding: '12px 14px 16px', background: t.bg }}>
                <div style={{ maxWidth: 760, margin: '0 auto', minWidth: 0 }}>
                  <div
                    style={{
                      borderRadius: 22,
                      background: t.bg,
                      border: `1px solid ${composerFocused ? CTA : t.border}`,
                      boxShadow: t.shadow,
                      padding: '14px 14px 12px',
                      transition: 'border-color 0.15s ease',
                      minWidth: 0,
                    }}
                  >
                    <textarea
                      ref={taRef}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onFocus={() => setComposerFocused(true)}
                      onBlur={() => setComposerFocused(false)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          send()
                        }
                      }}
                      placeholder={
                        mode === 'chat'
                          ? 'Ask anything about the Message or the Bible…'
                          : 'Describe a concept or search exact phrases in sermons and the KJV…'
                      }
                      rows={2}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        minHeight: 48,
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        background: 'transparent',
                        color: t.text,
                        fontSize: '1em',
                        fontWeight: 500,
                        lineHeight: 1.5,
                        padding: 0,
                        margin: '0 0 12px',
                        maxHeight: 160,
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        display: 'block',
                      }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'inline-flex', gap: 2, background: t.bg3, borderRadius: 999, padding: 4, alignItems: 'center' }}>
                          {(['chat', 'search'] as const).map(v => {
                            const active = mode === v
                            const ns = active ? navSelectedStyle(darkMode) : null
                            return (
                              <button
                                type="button"
                                key={v}
                                onClick={() => setMode(v)}
                                style={{
                                  border: 'none',
                                  borderRadius: 999,
                                  padding: '7px 12px',
                                  background: ns ? ns.background : 'transparent',
                                  color: ns ? ns.color : t.text2,
                                  fontWeight: 600,
                                  fontSize: '0.875em',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                {v === 'chat' ? (
                                  <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                    Chat
                                  </>
                                ) : (
                                  <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                                    Search
                                  </>
                                )}
                              </button>
                            )
                          })}
                        </div>
                        {mode === 'search' && (
                          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {(['both', 'message', 'bible'] as SearchSource[]).map(s => {
                              const active = searchSource === s
                              const ns = active ? navSelectedStyle(darkMode) : null
                              return (
                                <button
                                  type="button"
                                  key={s}
                                  onClick={() => setSearchSource(s)}
                                  style={{
                                    ...pillBtn(t),
                                    background: ns ? ns.background : 'transparent',
                                    borderColor: active ? t.text : t.border,
                                    color: ns ? ns.color : t.text2,
                                    fontWeight: active ? 700 : 600,
                                  }}
                                >
                                  {s === 'both' ? 'Both' : s === 'message' ? 'Message' : 'Bible'}
                                </button>
                              )
                            })}
                            <div style={{ display: 'inline-flex', gap: 6, marginLeft: 4, flexWrap: 'wrap' }}>
                              {([
                                { id: 'exact_phrase', label: 'Exact phrase' },
                                { id: 'all_words', label: 'All words' },
                              ] as const).map(opt => {
                                const active = searchMatchType === opt.id
                                const ns = active ? navSelectedStyle(darkMode) : null
                                return (
                                  <button
                                    type="button"
                                    key={opt.id}
                                    onClick={() => setSearchMatchType(opt.id)}
                                    style={{
                                      ...pillBtn(t),
                                      background: ns ? ns.background : 'transparent',
                                      borderColor: active ? t.text : t.border,
                                      color: ns ? ns.color : t.text2,
                                      fontWeight: active ? 700 : 600,
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                        <span style={{ fontSize: 12, fontStyle: 'italic', color: t.text3, lineHeight: 1.35 }}>
                          {mode === 'chat'
                            ? 'AI synthesized answer with sources'
                            : searchMatchType === 'exact_phrase'
                              ? 'Exact phrase match in sermons & KJV'
                              : 'Contains all entered words (any order)'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={send}
                        disabled={!query.trim() || loading}
                        style={{
                          flexShrink: 0,
                          width: 42,
                          height: 42,
                          borderRadius: 12,
                          border: `1px solid ${t.border}`,
                          background: t.bg3,
                          color: query.trim() && !loading ? t.text : t.text3,
                          display: 'grid',
                          placeItems: 'center',
                          cursor: query.trim() && !loading ? 'pointer' : 'default',
                          transition: 'all 0.15s ease',
                        }}
                        aria-label="Send"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
                      </button>
                    </div>
                  </div>
                  <p style={{ textAlign: 'center', marginTop: 10, color: t.text2, fontSize: '0.8125em', padding: '0 4px', overflowWrap: 'anywhere' }}>Sources limited to William Branham&apos;s sermons and the KJV Bible.</p>
                </div>
              </div>
            </div>
          )}

          {view === 'sermons' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <h2 style={h2}>Sermon Library</h2>
                <div style={{ ...card(t), marginBottom: 12 }}>
                  <input
                    value={sermonSearch}
                    onChange={e => setSermonSearch(e.target.value)}
                    placeholder="Search by title, topic, or date..."
                    style={inputStyle(t, { marginBottom: 10 })}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'inline-flex', gap: 4, background: t.bg3, borderRadius: 999, padding: 4 }}>
                      {([
                        ['newest', 'Newest first'],
                        ['oldest', 'Oldest first'],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSermonSort(id)}
                          style={{
                            border: 'none',
                            borderRadius: 999,
                            padding: '7px 12px',
                            background: sermonSort === id ? '#86CD82' : 'transparent',
                            color: sermonSort === id ? '#17351f' : t.text2,
                            fontWeight: 600,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span style={{ fontSize: 12, color: t.text2 }}>
                      Showing {sermonTotal.toLocaleString()} of {sermonGrandTotal.toLocaleString()} sermons
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                    {(['all', '1947-49', '1950s', '1960s'] as SermonDecade[]).map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setSermonDecade(d)}
                        style={{ ...pillBtn(t), whiteSpace: 'nowrap', background: sermonDecade === d ? '#86CD82' : t.bg, color: sermonDecade === d ? '#17351f' : t.text2, borderColor: sermonDecade === d ? '#86CD82' : t.border }}
                      >
                        {d === 'all' ? 'All' : d}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: `1px solid ${t.border}` }}>
                  {sermonRows.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setCurrentSermon(s); setView('reader') }}
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '13px 6px', borderBottom: `1px solid ${t.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: t.text, marginBottom: 2, overflowWrap: 'anywhere' }}>{s.title || 'Untitled sermon'}</div>
                        <div style={{ fontSize: 13, color: t.text2 }}>
                          {fmtSermonDate(s.date)}{s.location ? ` · ${s.location}` : ''}
                        </div>
                        <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{s.reference_code ? `#${s.reference_code}` : ''}</div>
                      </div>
                      <span style={{ color: t.text3, fontSize: 18, flexShrink: 0 }}>→</span>
                    </button>
                  ))}
                </div>

                {!sermonLoading && sermonRows.length === 0 && (
                  <p style={{ color: t.text2, marginTop: 12 }}>No sermons found for those filters.</p>
                )}
                {sermonLoading && <p style={{ color: t.text2, marginTop: 12 }}>Loading sermons...</p>}
                {!sermonLoading && sermonHasMore && (
                  <button type="button" onClick={() => loadSermons(sermonPage + 1, true)} style={{ ...secondaryBtn(t), marginTop: 12 }}>
                    Load 50 more
                  </button>
                )}
              </div>
            </div>
          )}

          {view === 'reader' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <button type="button" onClick={() => setView('sermons')} style={flatBtn(CTA)}>← Back to library</button>
                <h2 style={{ ...h2, marginTop: 8 }}>{currentSermon?.title || 'Sermon'}</h2>
                <p style={{ color: t.text2, marginBottom: 12 }}>
                  {fmtSermonDate(currentSermon?.date)}{currentSermon?.location ? ` · ${currentSermon.location}` : ''}{currentSermon?.reference_code ? ` · #${currentSermon.reference_code}` : ''}
                </p>
                <div style={{ ...card(t), maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', fontFamily: 'var(--font-merriweather), Georgia, serif', lineHeight: 1.9 }}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {currentSermon?.full_text || 'No sermon text available.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setView('chat')
                    setMode('chat')
                    setQuery(`Let us discuss this sermon: ${currentSermon?.title || 'Unknown sermon'}${currentSermon?.reference_code ? ` (#${currentSermon.reference_code})` : ''}.`)
                    setTimeout(() => taRef.current?.focus(), 0)
                  }}
                  style={{ ...primaryBtn(false), marginTop: 12 }}
                >
                  Chat about this sermon
                </button>
              </div>
            </div>
          )}

          {view === 'bookmarks' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <h2 style={h2}>Folders</h2>
                {!user ? (
                  <div style={emptyCard(t)}><p style={{ color: t.text2, marginBottom: 8 }}>Sign in to manage saved quotes.</p><button onClick={() => setAuthMode('login')} style={primaryBtn(false)}>Sign in</button></div>
                ) : activeFolder ? (
                  <>
                    <button type="button" onClick={() => setActiveFolder(null)} style={flatBtn(CTA)}>← Back</button>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
                      <h3 style={{ ...h2, fontSize: 16, margin: 0 }}>{activeFolder.name}</h3>
                      <button type="button" onClick={() => deleteFolder(activeFolder.id)} style={secondaryBtn(t)}>Delete folder</button>
                    </div>
                    {folderQuotes.length === 0 ? <p style={{ color: t.text2 }}>No quotes in this folder.</p> : folderQuotes.map(q => (
                      <div key={q.id} style={card(t)}>
                        <p style={{ margin: 0, borderLeft: `3px solid ${CTA}`, paddingLeft: 10, fontStyle: 'italic' }}>"{q.quote_text}"</p>
                        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, color: headingTone, fontSize: 13 }}>{q.source_title}</div>
                            <div style={{ color: t.text2, fontSize: 12 }}>{q.source_date}</div>
                          </div>
                          <button onClick={() => deleteQuote(q.id)} style={pillBtn(t)}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : foldersListOnly ? (
                  <>
                    <p style={{ color: t.text2, marginBottom: 14, fontSize: '0.9375em' }}>
                      Your folders, newest first. Open one to see saved quotes.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap', minWidth: 0 }}>
                      <h3 style={{ ...h2, fontSize: '1em', marginBottom: 0 }}>Folders</h3>
                      <button type="button" onClick={() => setShowNewFolder(v => !v)} style={pillBtn(t)}>{showNewFolder ? 'Close' : '+ New folder'}</button>
                    </div>
                    {showNewFolder && (
                      <div style={card(t)}>
                        <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFolder()} placeholder="Folder name" style={inputStyle(t, { marginBottom: 8 })} />
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>{COLORS.map(c => <button key={c} type="button" onClick={() => setNewFolderColor(c)} style={{ width: 22, height: 22, borderRadius: 999, background: c, border: newFolderColor === c ? `2px solid ${t.text}` : '2px solid transparent', cursor: 'pointer' }} />)}</div>
                        <button type="button" onClick={createFolder} style={primaryBtn(false)}>Create folder</button>
                      </div>
                    )}
                    {foldersSorted.length === 0 ? (
                      <p style={{ color: t.text2 }}>No folders yet. Create one above.</p>
                    ) : (
                      foldersSorted.map(f => (
                        <div
                          key={f.id}
                          style={{ ...card(t), width: '100%', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveFolder(f)}
                            style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, cursor: 'pointer', minWidth: 0, flex: 1, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}
                          >
                            <span style={{ width: 10, height: 10, borderRadius: 999, background: f.color, flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                          </button>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <span style={{ fontSize: 13, color: t.text3 }}>{savedQuotes.filter(q => q.folder_id === f.id).length}</span>
                            <button
                              type="button"
                              onClick={() => deleteFolder(f.id)}
                              style={{ ...iconBtn(t), width: 24, height: 24, borderRadius: 8, fontSize: 11 }}
                              aria-label={`Delete ${f.name}`}
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                      ))
                    )}
                    <button type="button" onClick={() => setFoldersListOnly(false)} style={{ ...flatBtn(CTA), marginTop: 14, display: 'block' }}>
                      Browse all saved quotes
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap', minWidth: 0 }}>
                      <h3 style={{ ...h2, fontSize: '1em', marginBottom: 0 }}>Your folders</h3>
                      <button type="button" onClick={() => setShowNewFolder(v => !v)} style={pillBtn(t)}>{showNewFolder ? 'Close' : '+ New folder'}</button>
                    </div>

                    {showNewFolder && (
                      <div style={card(t)}>
                        <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFolder()} placeholder="Folder name" style={inputStyle(t, { marginBottom: 8 })} />
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>{COLORS.map(c => <button key={c} type="button" onClick={() => setNewFolderColor(c)} style={{ width: 22, height: 22, borderRadius: 999, background: c, border: newFolderColor === c ? `2px solid ${t.text}` : '2px solid transparent', cursor: 'pointer' }} />)}</div>
                        <button type="button" onClick={createFolder} style={primaryBtn(false)}>Create folder</button>
                      </div>
                    )}

                    {savedQuotes.length === 0 ? <p style={{ color: t.text2 }}>No quotes saved yet.</p> : savedQuotes.map(q => (
                      <div key={q.id} style={card(t)}>
                        <p style={{ margin: 0, borderLeft: `3px solid ${CTA}`, paddingLeft: 10, fontStyle: 'italic' }}>"{q.quote_text}"</p>
                        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, color: headingTone, fontSize: 13 }}>{q.source_title}</div>
                            <div style={{ color: t.text2, fontSize: 12 }}>{q.source_date}</div>
                          </div>
                          <button type="button" onClick={() => deleteQuote(q.id)} style={pillBtn(t)}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {view === 'bible' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <BibleReader
                t={t}
                darkMode={darkMode}
                fontSize={fontSize}
                user={user}
                showToast={showToast}
                setSaveModal={setSaveModal}
                onBookChapterChange={onBibleBookChapter}
              />
            </div>
          )}

          {view === 'settings' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <h2 style={h2}>Settings</h2>
                <div style={card(t)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Dark mode</div>
                      <div style={{ color: t.text2, fontSize: 13 }}>Use calm flat dark appearance.</div>
                    </div>
                    <button onClick={() => setDarkMode(v => !v)} style={pillBtn(t)}>{darkMode ? 'On' : 'Off'}</button>
                  </div>
                </div>
                <div style={card(t)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Reading size</div>
                      <div style={{ color: t.text2, fontSize: 13 }}>Adjust text size for reading views.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setFontSize(v => Math.max(14, v - 1))} style={pillBtn(t)}>A-</button>
                      <button onClick={() => setFontSize(v => Math.min(20, v + 1))} style={pillBtn(t)}>A+</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

const fontStack = 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif'
const h1: React.CSSProperties = { fontSize: '1.5em', fontWeight: 700, margin: '0 0 6px', lineHeight: 1.2, overflowWrap: 'anywhere', wordBreak: 'break-word' }
const h2: React.CSSProperties = { fontSize: '1.125em', fontWeight: 600, margin: '0 0 10px', lineHeight: 1.3, overflowWrap: 'anywhere', wordBreak: 'break-word' }
const panelWrap: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }
const panelInner: React.CSSProperties = { maxWidth: 860, margin: '0 auto', minWidth: 0 }

function viewTitle(view: View, sermonTitle: string) {
  if (view === 'chat') return 'Chat'
  if (view === 'sermons') return 'Sermon Library'
  if (view === 'reader') return sermonTitle
  if (view === 'bookmarks') return 'Folders'
  if (view === 'bible') return 'Bible'
  return 'Settings'
}

function inputStyle(t: { border: string; bg: string; text: string }, extra: React.CSSProperties = {}): React.CSSProperties {
  return { width: '100%', minWidth: 0, boxSizing: 'border-box', borderRadius: 12, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: '0.9375em', fontWeight: 500, padding: '10px 12px', outline: 'none', transition: 'all 0.15s ease', overflowWrap: 'anywhere', wordBreak: 'break-word', ...extra }
}
function primaryBtn(block = true): React.CSSProperties {
  return { width: block ? '100%' : 'auto', maxWidth: '100%', boxSizing: 'border-box', border: 'none', borderRadius: 12, background: CTA, color: '#fff', padding: '10px 14px', fontWeight: 600, fontSize: '0.9375em', lineHeight: 1.35, cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', textAlign: 'center' }
}
function secondaryBtn(t: { bg3: string; border: string; text2: string }): React.CSSProperties {
  return { maxWidth: '100%', boxSizing: 'border-box', border: `1px solid ${t.border}`, borderRadius: 12, background: t.bg3, color: t.text2, padding: '9px 12px', fontWeight: 600, fontSize: '0.875em', lineHeight: 1.35, cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', textAlign: 'center' }
}
function flatBtn(color: string): React.CSSProperties {
  return { border: 'none', background: 'none', color, fontSize: '0.875em', fontWeight: 500, cursor: 'pointer', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', textAlign: 'left', maxWidth: '100%' }
}
function pillBtn(t: { bg3: string; border: string; text2: string }): React.CSSProperties {
  return { border: `1px solid ${t.border}`, borderRadius: 999, background: t.bg3, color: t.text2, padding: '7px 12px', fontSize: '0.875em', fontWeight: 600, lineHeight: 1.3, cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', textAlign: 'center', maxWidth: '100%', boxSizing: 'border-box' }
}
function iconBtn(t: { bg3: string; border: string; text2: string }): React.CSSProperties {
  return { width: 32, height: 32, borderRadius: 12, border: `1px solid ${t.border}`, background: t.bg3, color: t.text2, fontSize: '0.875em', cursor: 'pointer', transition: 'all 0.15s ease', flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0 }
}
function navBtn(t: { bg3: string; border: string; text2: string; text: string }, active: boolean, darkMode: boolean): React.CSSProperties {
  const ns = active ? navSelectedStyle(darkMode) : null
  return {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    borderRadius: 12,
    border: 'none',
    textAlign: 'left',
    padding: '9px 10px',
    background: ns ? ns.background : 'transparent',
    color: ns ? ns.color : t.text,
    fontWeight: active ? 600 : 500,
    fontSize: '0.9375em',
    lineHeight: 1.35,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  }
}
function folderRowBtn(t: { text: string; text2: string }): React.CSSProperties {
  return { width: '100%', minWidth: 0, border: 'none', background: 'transparent', padding: '6px 8px', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: t.text, fontSize: '0.875em', textAlign: 'left', boxSizing: 'border-box' }
}
function card(t: { bg2: string; border: string; shadow: string }): React.CSSProperties {
  return { background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 14, padding: 12, marginBottom: 10, boxShadow: t.shadow, minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' }
}
function emptyCard(t: { bg2: string; border: string }): React.CSSProperties {
  return { background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 10, minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' }
}
