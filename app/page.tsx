'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { supabase } from '@/lib/supabase'

type Message = { role: 'user' | 'assistant'; content: string; sources?: any[] }
type Folder = { id: string; name: string; color: string; created_at?: string }
type SavedQuote = { id: string; quote_text: string; source_title: string; source_date: string; folder_id: string | null }
type SearchResult = { quote_text: string; source_title: string; source_date: string; source: 'message' | 'bible' }
type SearchSource = 'both' | 'message' | 'bible'
type View = 'chat' | 'sermons' | 'reader' | 'bookmarks' | 'bible' | 'settings'
type HistoryItem = { id: string; text: string; mode: 'chat' | 'search' }

const ACCENT = '#86CD82'
const COLORS = ['#A0EEC0', '#8AE9C1', '#86CD82', '#72A276', '#666B6A', '#000000']

const ui = {
  light: { bg: '#FFFFFF', bg2: '#F5F5F7', bg3: '#ECECEF', text: '#000000', text2: '#4A4A4A', text3: '#7A7A7A', border: 'rgba(0,0,0,0.08)', shadow: '0 1px 3px rgba(0,0,0,0.08)' },
  dark: { bg: '#1C1C1E', bg2: '#2C2C2E', bg3: '#2F2F31', text: '#FFFFFF', text2: 'rgba(255,255,255,0.75)', text3: 'rgba(255,255,255,0.55)', border: 'rgba(255,255,255,0.06)', shadow: 'none' },
}

const SERMONS = [
  { id: '1', title: 'What Is The New Birth?', date: 'Jan 8, 1961', location: 'Jeffersonville, IN', ref: '61-0108', preview: 'A foundational message on true conversion by the Holy Spirit.' },
  { id: '2', title: 'The Spoken Word Is The Original Seed', date: 'Mar 18, 1962', location: 'Jeffersonville, IN', ref: '62-0318', preview: 'How the original seed of God produces after its kind.' },
  { id: '3', title: 'Shalom', date: 'Jan 12, 1964', location: 'Phoenix, AZ', ref: '64-0112', preview: 'A message of peace and hope in a troubled hour.' },
]

const SERMON_PARAS = [
  'The new birth is not joining a church. It is a spiritual birth from above.',
  'Except a man be born again, he cannot see the kingdom of God. The Spirit must quicken the Word seed in the believer.',
  'When a man is truly born again, old things pass away and a new life appears.',
]

const BIBLE_VERSES = [
  { ref: 'John 3:3', text: 'Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.' },
  { ref: 'John 3:5', text: 'Except a man be born of water and of the Spirit, he cannot enter into the kingdom of God.' },
  { ref: 'Romans 8:16', text: 'The Spirit itself beareth witness with our spirit, that we are the children of God.' },
]

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
  const [query, setQuery] = useState('')
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

  const [currentSermon, setCurrentSermon] = useState(SERMONS[0])

  const taRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const t = darkMode ? ui.dark : ui.light
  const headingTone = darkMode ? '#D7F5D6' : '#1F1F1F'

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
      taRef.current.style.height = '24px'
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 140) + 'px'
    }
  }, [query])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, searchResults, loading])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const loadFolders = async () => {
    const { data } = await supabase.from('folders').select('*').order('created_at')
    setFolders(data || [])
  }

  const loadQuotes = async () => {
    const { data } = await supabase.from('saved_quotes').select('*').order('created_at', { ascending: false })
    setSavedQuotes(data || [])
  }

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
      setHistory(prev => [{ id: `${Date.now()}`, text: q, mode: 'search' as const }, ...prev].slice(0, 20))
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, source: searchSource }),
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

  if (authMode) {
    return (
      <div style={{ minHeight: '100vh', background: t.bg, color: t.text, display: 'grid', placeItems: 'center', fontFamily: fontStack, fontSize, fontWeight: 500, lineHeight: 1.7 }}>
        <div style={{ width: 400, background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24, boxShadow: t.shadow }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{authMode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <p style={{ color: t.text2, marginBottom: 12 }}>Access folders, bookmarks, and history.</p>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email" style={inputStyle(t)} />
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? signIn() : signUp())} style={inputStyle(t, { marginTop: 8 })} />
          {authError && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 8 }}>{authError}</p>}
          <button onClick={authMode === 'login' ? signIn : signUp} style={primaryBtn()}>{authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} style={flatBtn(ACCENT)}>{authMode === 'login' ? 'Create account' : 'Sign in instead'}</button>
            <button onClick={() => setAuthMode(null)} style={flatBtn(t.text2)}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.text, fontFamily: fontStack, fontSize, fontWeight: 500, lineHeight: 1.7, transition: 'background 0.15s ease, color 0.15s ease', overflow: 'hidden' }}>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: t.bg3, color: t.text, border: `1px solid ${t.border}`, borderRadius: 999, padding: '7px 12px', fontSize: 12, zIndex: 200 }}>{toast}</div>}

      {saveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 180, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 430, background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 16, padding: 18, boxShadow: t.shadow }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Save Quote</h3>
            <p style={{ borderLeft: `3px solid ${ACCENT}`, paddingLeft: 10, fontStyle: 'italic', marginBottom: 12 }}>"{saveModal.text.slice(0, 220)}{saveModal.text.length > 220 ? '...' : ''}"</p>
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

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <aside style={{ width: sidebarOpen ? 245 : 0, minWidth: sidebarOpen ? 245 : 0, overflow: 'hidden', transition: 'all 0.15s ease', background: t.bg2, borderRight: `1px solid ${t.border}` }}>
          <div style={{ width: 245, height: '100vh', display: 'flex', flexDirection: 'column', padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: ACCENT, color: '#fff', display: 'grid', placeItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <strong style={{ fontSize: 14 }}>Message</strong>
              </div>
              <button onClick={() => setSidebarOpen(false)} style={iconBtn(t)}>✕</button>
            </div>

            <button onClick={() => { setView('chat'); setMode('chat'); setMessages([]); setSearchResults([]) }} style={{ ...primaryBtn(false), width: '100%', marginBottom: 8, background: '#111111', color: '#ffffff' }}>+ New search</button>

            {[
              ['chat', 'Chat'],
              ['sermons', 'Sermon Library'],
              ['bookmarks', 'Saved Quotes'],
              ['bible', 'Bible (KJV)'],
              ['settings', 'Settings'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setView(id as View)} style={{ ...navBtn(t, view === id), marginBottom: 2, ...(id === 'chat' && view === 'chat' ? { background: '#111111', color: '#ffffff' } : {}) }}>{label}</button>
            ))}

            <div style={{ marginTop: 10, borderTop: `1px solid ${t.border}`, paddingTop: 8, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 10.5, color: t.text3, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 6px 4px' }}>Folders</div>
              {folders.length === 0 ? (
                <p style={{ color: t.text2, fontSize: 12, padding: '0 6px' }}>No folders yet</p>
              ) : folders.map(f => (
                <button key={f.id} onClick={() => { setView('bookmarks'); setActiveFolder(f) }} style={{ ...folderRowBtn(t) }}>
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
                  }}
                  style={{ ...folderRowBtn(t), padding: '7px 8px' }}
                  title={item.text}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: item.mode === 'chat' ? ACCENT : t.text3 }} />
                  <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
                </button>
              ))}
            </div>

            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 8 }}>
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

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <header style={{ height: 52, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', background: t.bg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} style={iconBtn(t)}>☰</button>}
              <span style={{ fontSize: 13, color: t.text2 }}>{viewTitle(view, currentSermon.title)}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setFontSize(v => Math.max(14, v - 1))} style={iconBtn(t)}>A-</button>
              <button onClick={() => setFontSize(v => Math.min(20, v + 1))} style={iconBtn(t)}>A+</button>
              <button onClick={() => setDarkMode(v => !v)} style={iconBtn(t)}>{darkMode ? '☀' : '☾'}</button>
            </div>
          </header>

          {view === 'chat' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '18px 18px 0' }}>
                <div style={{ maxWidth: 760, margin: '0 auto' }}>
                  {mode === 'search' ? (
                    <>
                      {!searchResults.length && !loading && <div style={emptyCard(t)}><h1 style={h1}>Search the Message & Bible</h1><p style={{ color: t.text2 }}>Exact raw passages from sermons and KJV Bible.</p></div>}
                      {searchResults.map((r, i) => (
                        <div key={i} style={{ ...card(t), overflow: 'hidden' }}>
                          <p style={{ margin: 0, borderLeft: `3px solid ${ACCENT}`, paddingLeft: 12, fontStyle: 'italic', overflowWrap: 'anywhere' }}>"{r.quote_text}"</p>
                          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontWeight: 600, color: headingTone, fontSize: 13 }}>{r.source_title || (r.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')}</div>
                              <div style={{ color: t.text2, fontSize: 12 }}>{r.source_date || (r.source === 'bible' ? 'KJV' : '')}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => { if (!user) return showToast('Sign in to save quotes'); setSaveModal({ text: r.quote_text, title: r.source_title, date: r.source_date }) }} style={pillBtn(t)}>Save</button>
                              <span style={{ ...pillBtn(t), cursor: 'default' }}>{r.source}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      {!messages.length && !loading && <div style={emptyCard(t)}><h1 style={h1}>Search the Message & Bible</h1><p style={{ color: t.text2 }}>Chat for AI answers, or search exact passages.</p></div>}
                      {messages.map((m, i) => (
                        <div key={i} style={{ marginBottom: 16 }}>
                          {m.role === 'user' ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <div style={{ maxWidth: '75%', background: ACCENT, color: '#fff', borderRadius: 18, padding: '10px 14px' }}>{m.content}</div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 10, border: `1px solid ${t.border}`, background: t.bg3, display: 'grid', placeItems: 'center' }}>
                                <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke={ACCENT} strokeWidth="1.5" strokeLinejoin="round"/></svg>
                              </div>
                              <div style={{ flex: 1, background: t.bg2, borderRadius: 14, border: `1px solid ${t.border}`, padding: '10px 12px', overflow: 'hidden' }}>
                                <ReactMarkdown components={{
                                  p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
                                  h2: ({ children }) => <h2 style={h2}>{children}</h2>,
                                  h3: ({ children }) => <h3 style={{ ...h2, fontSize: 16 }}>{children}</h3>,
                                  blockquote: ({ children }) => {
                                    const quoteText = getPlainTextFromNode(children).trim()
                                    return (
                                      <div style={{ position: 'relative', margin: '9px 0' }}>
                                        <blockquote style={{ margin: 0, borderLeft: `3px solid ${ACCENT}`, paddingLeft: 12, paddingRight: 34, fontStyle: 'italic' }}>{children}</blockquote>
                                        <button onClick={() => { if (!user) return showToast('Sign in to save quotes'); if (!quoteText) return; setSaveModal({ text: quoteText, title: m.sources?.[0]?.title || 'William Branham Sermon', date: m.sources?.[0]?.date || '' }) }} style={{ ...pillBtn(t), position: 'absolute', top: -1, right: 0, width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center' }}>
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                                        </button>
                                      </div>
                                    )
                                  },
                                }}>{m.content || ''}</ReactMarkdown>

                                {m.sources && m.sources.length > 0 && (
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                    {m.sources.map((s: any, idx: number) => (
                                      <div key={idx} style={{ background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: '8px 10px', minWidth: 150, maxWidth: '100%' }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 600, color: headingTone, overflowWrap: 'anywhere' }}>{s.title || 'William Branham Sermon'}</div>
                                        <div style={{ fontSize: 11.5, color: t.text2 }}>{s.date || ''}{s.ref ? ` · #${s.ref}` : ''}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                                  <button onClick={() => copyText(m.content, i)} style={pillBtn(t)}>{copied === i ? 'Copied' : 'Copy'}</button>
                                  <button onClick={() => { if (!user) return showToast('Sign in to save quotes'); setSaveModal({ text: extractSavableQuote(m.content || ''), title: m.sources?.[0]?.title || 'William Branham Sermon', date: m.sources?.[0]?.date || '' }) }} style={pillBtn(t)}>Save</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                  {loading && <p style={{ color: t.text2, fontSize: 13 }}>Loading...</p>}
                  <div ref={endRef} />
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${t.border}`, padding: '10px 14px 14px' }}>
                <div style={{ maxWidth: 760, margin: '0 auto' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'inline-flex', gap: 2, background: t.bg3, borderRadius: 999, padding: 4 }}>
                      {(['chat', 'search'] as const).map(v => (
                        <button key={v} onClick={() => setMode(v)} style={{ border: 'none', borderRadius: 999, padding: '7px 14px', background: mode === v ? (v === 'chat' ? ACCENT : t.bg) : 'transparent', color: mode === v ? (v === 'chat' ? '#fff' : t.text) : t.text2, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease' }}>{v === 'chat' ? 'Chat' : 'Search'}</button>
                      ))}
                    </div>
                    {mode === 'search' && (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {(['both', 'message', 'bible'] as SearchSource[]).map(s => (
                          <button key={s} onClick={() => setSearchSource(s)} style={{ ...pillBtn(t), background: searchSource === s ? '#111111' : t.bg3, borderColor: searchSource === s ? '#111111' : t.border, color: searchSource === s ? '#ffffff' : t.text2 }}>
                            {s === 'both' ? 'Both' : s === 'message' ? 'Message' : 'Bible'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ borderRadius: 24, background: t.bg, border: `1px solid ${composerFocused ? ACCENT : t.border}`, boxShadow: t.shadow, display: 'flex', gap: 8, alignItems: 'center', minHeight: 56, padding: '8px 10px 8px 14px', transition: 'all 0.15s ease' }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', minHeight: 36 }}>
                      <textarea ref={taRef} value={query} onChange={e => setQuery(e.target.value)} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder={mode === 'chat' ? 'Ask about The Message or the Bible...' : 'Search passages directly...'} rows={1} style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', background: 'transparent', color: t.text, fontSize: 16, fontWeight: 500, lineHeight: '24px', height: 24, padding: 0, margin: 0, maxHeight: 140 }} />
                    </div>
                    <button onClick={send} disabled={!query.trim() || loading} style={{ width: 38, height: 38, borderRadius: 999, border: 'none', background: query.trim() && !loading ? '#111111' : t.bg3, color: query.trim() && !loading ? '#fff' : t.text2, display: 'grid', placeItems: 'center', cursor: query.trim() && !loading ? 'pointer' : 'default', transition: 'all 0.15s ease' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
                    </button>
                  </div>
                  <p style={{ textAlign: 'center', marginTop: 7, color: t.text2, fontSize: 11.5 }}>Sources limited to William Branham sermons and the KJV Bible.</p>
                </div>
              </div>
            </div>
          )}

          {view === 'sermons' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <h2 style={h2}>Sermon Library</h2>
                {SERMONS.map(s => (
                  <button key={s.id} onClick={() => { setCurrentSermon(s); setView('reader') }} style={{ ...card(t), textAlign: 'left', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong style={{ color: t.text }}>{s.title}</strong>
                      <span style={{ color: t.text2, fontSize: 12 }}>{s.date}</span>
                    </div>
                    <p style={{ margin: 0, color: t.text2 }}>{s.preview}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === 'reader' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <button onClick={() => setView('sermons')} style={flatBtn(ACCENT)}>← Back to library</button>
                <h2 style={{ ...h2, marginTop: 8 }}>{currentSermon.title}</h2>
                <p style={{ color: t.text2, marginBottom: 12 }}>{currentSermon.date} · {currentSermon.location} · #{currentSermon.ref}</p>
                {SERMON_PARAS.map((p, i) => (
                  <div key={i} style={card(t)}>
                    <p style={{ margin: 0 }}>{p}</p>
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => { if (!user) return showToast('Sign in to save quotes'); setSaveModal({ text: p, title: currentSermon.title, date: currentSermon.date }) }} style={pillBtn(t)}>Save quote</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'bookmarks' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <h2 style={h2}>Saved Quotes</h2>
                {!user ? (
                  <div style={emptyCard(t)}><p style={{ color: t.text2, marginBottom: 8 }}>Sign in to manage saved quotes.</p><button onClick={() => setAuthMode('login')} style={primaryBtn(false)}>Sign in</button></div>
                ) : activeFolder ? (
                  <>
                    <button onClick={() => setActiveFolder(null)} style={flatBtn(ACCENT)}>← Back to all quotes</button>
                    <h3 style={{ ...h2, fontSize: 16, marginTop: 8 }}>{activeFolder.name}</h3>
                    {folderQuotes.length === 0 ? <p style={{ color: t.text2 }}>No quotes in this folder.</p> : folderQuotes.map(q => (
                      <div key={q.id} style={card(t)}>
                        <p style={{ margin: 0, borderLeft: `3px solid ${ACCENT}`, paddingLeft: 10, fontStyle: 'italic' }}>"{q.quote_text}"</p>
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
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <h3 style={{ ...h2, fontSize: 16 }}>Folders</h3>
                      <button onClick={() => setShowNewFolder(v => !v)} style={pillBtn(t)}>{showNewFolder ? 'Close' : '+ New folder'}</button>
                    </div>

                    {showNewFolder && (
                      <div style={card(t)}>
                        <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFolder()} placeholder="Folder name" style={inputStyle(t, { marginBottom: 8 })} />
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>{COLORS.map(c => <button key={c} onClick={() => setNewFolderColor(c)} style={{ width: 22, height: 22, borderRadius: 999, background: c, border: newFolderColor === c ? `2px solid ${t.text}` : '2px solid transparent', cursor: 'pointer' }} />)}</div>
                        <button onClick={createFolder} style={primaryBtn(false)}>Create folder</button>
                      </div>
                    )}

                    {savedQuotes.length === 0 ? <p style={{ color: t.text2 }}>No quotes saved yet.</p> : savedQuotes.map(q => (
                      <div key={q.id} style={card(t)}>
                        <p style={{ margin: 0, borderLeft: `3px solid ${ACCENT}`, paddingLeft: 10, fontStyle: 'italic' }}>"{q.quote_text}"</p>
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
                )}
              </div>
            </div>
          )}

          {view === 'bible' && (
            <div style={panelWrap}>
              <div style={panelInner}>
                <h2 style={h2}>Bible (KJV)</h2>
                {BIBLE_VERSES.map(v => (
                  <div key={v.ref} style={card(t)}>
                    <div style={{ fontSize: 12, color: t.text2, marginBottom: 6 }}>{v.ref}</div>
                    <p style={{ margin: 0, borderLeft: `3px solid ${ACCENT}`, paddingLeft: 10, fontStyle: 'italic' }}>{v.text}</p>
                    <div style={{ marginTop: 8 }}><button onClick={() => { if (!user) return showToast('Sign in to save quotes'); setSaveModal({ text: v.text, title: v.ref, date: 'KJV' }) }} style={pillBtn(t)}>Save verse</button></div>
                  </div>
                ))}
              </div>
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
const h1: React.CSSProperties = { fontSize: 24, fontWeight: 700, margin: '0 0 6px', lineHeight: 1.2 }
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 600, margin: '0 0 10px', lineHeight: 1.3 }
const panelWrap: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: 16 }
const panelInner: React.CSSProperties = { maxWidth: 860, margin: '0 auto' }

function viewTitle(view: View, sermonTitle: string) {
  if (view === 'chat') return 'Chat'
  if (view === 'sermons') return 'Sermon Library'
  if (view === 'reader') return sermonTitle
  if (view === 'bookmarks') return 'Saved Quotes'
  if (view === 'bible') return 'Bible (KJV)'
  return 'Settings'
}

function inputStyle(t: { border: string; bg: string; text: string }, extra: React.CSSProperties = {}): React.CSSProperties {
  return { width: '100%', borderRadius: 12, border: `1px solid ${t.border}`, background: t.bg, color: t.text, fontSize: 14, fontWeight: 500, padding: '10px 12px', outline: 'none', transition: 'all 0.15s ease', ...extra }
}
function primaryBtn(block = true): React.CSSProperties {
  return { width: block ? '100%' : 'auto', border: 'none', borderRadius: 12, background: ACCENT, color: '#fff', padding: '9px 14px', fontWeight: 600, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s ease' }
}
function secondaryBtn(t: { bg3: string; border: string; text2: string }): React.CSSProperties {
  return { border: `1px solid ${t.border}`, borderRadius: 12, background: t.bg3, color: t.text2, padding: '8px 12px', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s ease' }
}
function flatBtn(color: string): React.CSSProperties {
  return { border: 'none', background: 'none', color, fontSize: 13, cursor: 'pointer' }
}
function pillBtn(t: { bg3: string; border: string; text2: string }): React.CSSProperties {
  return { border: `1px solid ${t.border}`, borderRadius: 999, background: t.bg3, color: t.text2, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease' }
}
function iconBtn(t: { bg3: string; border: string; text2: string }): React.CSSProperties {
  return { width: 30, height: 30, borderRadius: 12, border: `1px solid ${t.border}`, background: t.bg3, color: t.text2, cursor: 'pointer', transition: 'all 0.15s ease' }
}
function navBtn(t: { bg3: string; border: string; text2: string; text: string }, active: boolean): React.CSSProperties {
  return { width: '100%', borderRadius: 12, border: 'none', textAlign: 'left', padding: '8px 10px', background: active ? `${ACCENT}2a` : 'transparent', color: active ? ACCENT : t.text2, fontWeight: active ? 600 : 500, cursor: 'pointer', transition: 'all 0.15s ease' }
}
function folderRowBtn(t: { text: string; text2: string }): React.CSSProperties {
  return { width: '100%', border: 'none', background: 'transparent', padding: '6px 8px', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: t.text, fontSize: 12.5 }
}
function card(t: { bg2: string; border: string; shadow: string }): React.CSSProperties {
  return { background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 14, padding: 12, marginBottom: 10, boxShadow: t.shadow }
}
function emptyCard(t: { bg2: string; border: string }): React.CSSProperties {
  return { background: t.bg2, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 10 }
}
