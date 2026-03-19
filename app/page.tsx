'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { supabase } from '@/lib/supabase'

type Message = { role: 'user' | 'assistant'; content: string; sources?: any[] }
type Folder = { id: string; name: string; color: string; created_at?: string }
type SavedQuote = { id: string; quote_text: string; source_title: string; source_date: string; folder_id: string | null }
type SearchResult = { quote_text: string; source_title: string; source_date: string; source: 'message' | 'bible' }
type SearchSource = 'both' | 'message' | 'bible'
type View = 'chat' | 'folders' | 'sermons' | 'bible' | 'settings'

const COLORS = ['#c47a1a', '#5b8dd9', '#7c6abf', '#4aab7c', '#d97b4a', '#e05c5c']
const HISTORY = [
  { label: 'Today', items: ['New birth quotes', 'Holy Ghost references'] },
  { label: 'Yesterday', items: ['Bride passages', 'Healing scriptures'] },
]

const SERMONS = [
  { id: '1', title: 'What Is The New Birth?', date: 'Jan 8, 1961', location: 'Jeffersonville, IN', preview: 'A foundational message on true conversion by the Holy Spirit.' },
  { id: '2', title: 'The Spoken Word Is The Original Seed', date: 'Mar 18, 1962', location: 'Jeffersonville, IN', preview: 'How the original seed of God produces after its kind.' },
  { id: '3', title: 'Shalom', date: 'Jan 12, 1964', location: 'Phoenix, AZ', preview: 'A message of peace and hope in a troubled hour.' },
]

const SERMON_PARAS = [
  'The new birth is not joining a church. It is a spiritual birth from above.',
  'Except a man be born again, he cannot see the kingdom of God. The Spirit must quicken the Word seed in the believer.',
  'When a man is truly born again, old things pass away and a new life appears.'
]

const BIBLE_VERSES = [
  { verse: 'John 3:3', text: 'Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.' },
  { verse: 'John 3:5', text: 'Except a man be born of water and of the Spirit, he cannot enter into the kingdom of God.' },
  { verse: 'Romans 8:16', text: 'The Spirit itself beareth witness with our spirit, that we are the children of God.' },
]

const shell = {
  bg: '#ffffff',
  bg2: '#f9f9f8',
  bg3: '#f2f2f0',
  sidebar: '#f7f7f5',
  text: '#0d0d0c',
  text2: '#5a5a56',
  text3: '#a3a39e',
  border: 'rgba(0,0,0,0.08)',
  borderSoft: 'rgba(0,0,0,0.06)',
  amber: '#c47a1a',
}

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [view, setView] = useState<View>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mode, setMode] = useState<'chat' | 'search'>('chat')
  const [searchSource, setSearchSource] = useState<SearchSource>('both')
  const [fontSize, setFontSize] = useState(14)
  const [sidebarTab, setSidebarTab] = useState<'folders' | 'history'>('folders')
  const [composerFocused, setComposerFocused] = useState(false)

  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [copied, setCopied] = useState<number | null>(null)

  const [folders, setFolders] = useState<Folder[]>([])
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState(COLORS[0])
  const [saveModal, setSaveModal] = useState<{ text: string; title: string; date: string } | null>(null)
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const taRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

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
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + 'px'
    }
  }, [query])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, searchResults, loading])

  const loadFolders = async () => {
    const { data } = await supabase.from('folders').select('*').order('created_at')
    setFolders(data || [])
  }

  const loadQuotes = async () => {
    const { data } = await supabase.from('saved_quotes').select('*').order('created_at', { ascending: false })
    setSavedQuotes(data || [])
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const signIn = async () => {
    setAuthLoading(true)
    setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
    else {
      setAuthMode(null)
      setEmail('')
      setPassword('')
    }
    setAuthLoading(false)
  }

  const signUp = async () => {
    setAuthLoading(true)
    setAuthError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setAuthError(error.message)
    else {
      setAuthMode(null)
      setEmail('')
      setPassword('')
      showToast('Account created')
    }
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
    if (error) {
      showToast(error.message || 'Failed to create folder')
      return
    }
    setNewFolderName('')
    setShowNewFolder(false)
    showToast('Folder created')
    await loadFolders()
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
    setSavedQuotes(savedQuotes.filter(q => q.id !== id))
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
        const line = lines[i]
        if (!/^\s*>\s?/.test(line)) break
        quoteLines.push(line.replace(/^\s*>\s?/, ''))
      }
      const quote = quoteLines.join('\n').trim()
      if (quote) return quote
    }
    return content.replace(/\s+/g, ' ').trim().slice(0, 200)
  }

  const copyText = (text: string, i: number) => {
    navigator.clipboard.writeText(text)
    setCopied(i)
    setTimeout(() => setCopied(null), 2000)
  }

  const send = async () => {
    if (!query.trim() || loading) return
    const q = query.trim()
    setQuery('')
    setLoading(true)

    if (mode === 'search') {
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

    const next = [...messages, { role: 'user', content: q } as Message]
    setMessages(next)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const data = await res.json()
      setMessages([...next, { role: 'assistant', content: data.response, sources: data.sources }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong.', sources: [] }])
    }
    setLoading(false)
  }

  const filteredFolderQuotes = useMemo(
    () => savedQuotes.filter(q => q.folder_id === activeFolder?.id),
    [savedQuotes, activeFolder]
  )

  if (authMode) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: shell.bg2, fontFamily: 'Inter, -apple-system, sans-serif' }}>
        <div style={{ width: 380, background: shell.bg, borderRadius: 16, border: `1px solid ${shell.border}`, padding: 28, boxShadow: '0 6px 30px rgba(0,0,0,0.12)' }}>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>{authMode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <p style={{ color: shell.text2, fontSize: 13, marginBottom: 16 }}>Access folders, saved quotes, and personalized history.</p>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" style={inputStyle()} />
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? signIn() : signUp())} style={inputStyle({ marginTop: 10 })} />
          {authError && <p style={{ color: '#c53939', fontSize: 12, marginTop: 10 }}>{authError}</p>}
          <button onClick={authMode === 'login' ? signIn : signUp} disabled={authLoading} style={primaryBtn({ width: '100%', marginTop: 14 })}>
            {authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} style={textBtn(shell.amber)}>{authMode === 'login' ? 'Create account' : 'Sign in instead'}</button>
            <button onClick={() => setAuthMode(null)} style={textBtn(shell.text3)}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', background: shell.bg, color: shell.text, fontFamily: 'Inter, -apple-system, sans-serif', display: 'flex' }}>
      {toast && <div style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', background: '#1a1a18', color: 'white', padding: '9px 16px', borderRadius: 10, fontSize: 12, zIndex: 60 }}>{toast}</div>}

      {saveModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
          <div style={{ width: 400, background: shell.bg, borderRadius: 14, border: `1px solid ${shell.border}`, padding: 18 }}>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Save quote</h3>
            <p style={{ fontSize: 12.5, color: shell.text2, borderLeft: `2px solid ${shell.amber}`, paddingLeft: 10, fontStyle: 'italic', marginBottom: 14 }}>
              "{saveModal.text.slice(0, 180)}{saveModal.text.length > 180 ? '...' : ''}"
            </p>
            {folders.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 11, color: shell.text3, marginBottom: 8 }}>Save to folder (optional)</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {folders.map(f => (
                    <button key={f.id} onClick={() => setSaveFolderId(saveFolderId === f.id ? null : f.id)} style={{
                      padding: '5px 10px',
                      borderRadius: 999,
                      fontSize: 11.5,
                      border: `1px solid ${saveFolderId === f.id ? f.color : shell.border}`,
                      background: saveFolderId === f.id ? `${f.color}22` : 'transparent',
                      color: saveFolderId === f.id ? f.color : shell.text2,
                      cursor: 'pointer',
                    }}>{f.name}</button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveQuote} style={primaryBtn({ flex: 1 })}>Save</button>
              <button onClick={() => { setSaveModal(null); setSaveFolderId(null) }} style={secondaryBtn({ flex: 1 })}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <aside style={{
        width: sidebarOpen ? 250 : 0,
        minWidth: sidebarOpen ? 250 : 0,
        transition: 'all .2s',
        overflow: 'hidden',
        background: shell.sidebar,
        borderRight: `1px solid ${shell.borderSoft}`,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ width: 250, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 27, height: 27, borderRadius: 8, background: shell.amber, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 12 }}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <strong style={{ fontSize: 14 }}>Message</strong>
            </div>
            <button onClick={() => setSidebarOpen(false)} style={iconBtn()}>✕</button>
          </div>

          <div style={{ padding: '0 10px 10px' }}>
            <button onClick={() => { setView('chat'); setMessages([]); setSearchResults([]) }} style={secondaryBtn({ width: '100%', justifyContent: 'center' })}>+ New search</button>
          </div>

          <div style={{ padding: '0 10px 8px', display: 'flex', gap: 2 }}>
            {[
              ['folders', 'Folders'],
              ['history', 'History']
            ].map(([id, label]) => (
              <button key={id} onClick={() => setSidebarTab(id as 'folders' | 'history')} style={{
                ...secondaryBtn({ flex: 1, height: 28, padding: 0, fontSize: 12 }),
                background: sidebarTab === id ? shell.bg : 'transparent',
                border: sidebarTab === id ? `1px solid ${shell.border}` : '1px solid transparent',
              }}>{label}</button>
            ))}
          </div>

          <div style={{ padding: '0 6px', display: 'grid', gap: 2 }}>
            {[
              ['chat', 'Chat'],
              ['folders', 'Folders'],
              ['sermons', 'Sermon Library'],
              ['bible', 'Bible Reader'],
              ['settings', 'Settings'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setView(id as View)} style={{
                ...navBtn(),
                background: view === id ? shell.bg : 'transparent',
                color: view === id ? shell.text : shell.text2,
              }}>{label}</button>
            ))}
          </div>

          <div style={{ padding: '8px 8px', flex: 1, overflowY: 'auto' }}>
            {sidebarTab === 'folders' ? (
              <>
                {folders.map(f => (
                  <button key={f.id} onClick={() => { setView('folders'); setActiveFolder(f) }} style={{ ...navBtn(), display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: f.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize: 10.5, color: shell.text3 }}>{savedQuotes.filter(q => q.folder_id === f.id).length}</span>
                  </button>
                ))}
              </>
            ) : (
              <>
                {HISTORY.map(group => (
                  <div key={group.label} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10.5, color: shell.text3, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 8px 3px' }}>{group.label}</div>
                    {group.items.map(item => (
                      <button key={item} onClick={() => setView('chat')} style={{ ...navBtn(), marginBottom: 2 }}>{item}</button>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>

          <div style={{ marginTop: 'auto', borderTop: `1px solid ${shell.borderSoft}`, padding: 10 }}>
            {!user ? (
              <>
                <p style={{ fontSize: 11.5, color: shell.text3, marginBottom: 8, lineHeight: 1.5 }}>
                  Sign in to save quotes, organize folders, and persist your history.
                </p>
                <button onClick={() => setAuthMode('login')} style={primaryBtn({ width: '100%', marginBottom: 6, fontSize: 12 })}>Sign in</button>
                <button onClick={() => setAuthMode('signup')} style={secondaryBtn({ width: '100%', fontSize: 12 })}>Create account</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: shell.text2, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
                <button onClick={signOut} style={secondaryBtn({ width: '100%' })}>Sign out</button>
              </>
            )}
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ height: 50, borderBottom: `1px solid ${shell.borderSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} style={iconBtn()}>☰</button>}
            <div style={{ fontSize: 13, color: shell.text2 }}>{viewTitle(view)}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setFontSize(v => Math.max(13, v - 1))} style={iconBtn()}>A-</button>
            <button onClick={() => setFontSize(v => Math.min(20, v + 1))} style={iconBtn()}>A+</button>
          </div>
        </div>

        {view === 'chat' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
              <div style={{ maxWidth: 760, margin: '0 auto' }}>
                {mode === 'search' ? (
                  <>
                    {searchResults.length === 0 && !loading && (
                      <div style={emptyCard()}>
                        <h2 style={{ marginBottom: 6 }}>Search quotes directly</h2>
                        <p style={{ color: shell.text2, fontSize: 13 }}>Use Search mode for exact raw results from sermon and Bible tables.</p>
                      </div>
                    )}
                    {searchResults.map((r, i) => (
                      <div key={i} style={resultCard()}>
                        <p style={{ borderLeft: `2px solid ${shell.amber}`, paddingLeft: 12, fontStyle: 'italic', color: shell.text2, lineHeight: 1.7, fontSize: 13 + (fontSize - 14), fontFamily: 'Merriweather, Georgia, serif' }}>
                          "{r.quote_text}"
                        </p>
                        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{r.source_title || (r.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')}</div>
                            <div style={{ fontSize: 11, color: shell.text3 }}>{r.source_date || (r.source === 'bible' ? 'King James Version' : '')}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { if (!user) { showToast('Sign in to save quotes'); return }; setSaveModal({ text: r.quote_text, title: r.source_title, date: r.source_date || '' }) }} style={secondaryBtn({ fontSize: 11, padding: '5px 8px' })}>Save</button>
                            <span style={{ fontSize: 10.5, color: shell.text2, background: shell.bg3, borderRadius: 999, padding: '4px 8px', textTransform: 'capitalize' }}>{r.source}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    {!messages.length && !loading && (
                      <div style={emptyCard()}>
                        <h1 style={{ fontSize: 24, marginBottom: 8 }}>The Message Search</h1>
                        <p style={{ color: shell.text2, fontSize: 14 }}>Chat for synthesized answers, or switch to Search for raw quotes from sermons and Scripture.</p>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i} style={{ marginBottom: 22 }}>
                        {m.role === 'user' ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <div style={{ maxWidth: '76%', background: '#1a1a18', color: '#f6f6f4', borderRadius: 16, borderBottomRightRadius: 4, padding: '10px 14px', lineHeight: 1.6, fontSize }}>
                              {m.content}
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, background: shell.amber, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize, lineHeight: 1.75 }}>
                                <ReactMarkdown components={{
                                  p: ({ children }) => <p style={{ marginBottom: 10 }}>{children}</p>,
                                  h2: ({ children }) => <h2 style={{ fontSize: 16, marginTop: 14, marginBottom: 8 }}>{children}</h2>,
                                  h3: ({ children }) => <h3 style={{ fontSize: 14, marginTop: 12, marginBottom: 6 }}>{children}</h3>,
                                  ul: ({ children }) => <ul style={{ paddingLeft: 20, marginBottom: 10 }}>{children}</ul>,
                                  li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
                                  blockquote: ({ children }) => {
                                    const quoteText = getPlainTextFromNode(children).trim()
                                    return (
                                      <div style={{ position: 'relative', margin: '12px 0' }}>
                                        <blockquote style={{ margin: 0, borderLeft: `2.5px solid ${shell.amber}`, paddingLeft: 14, paddingRight: 30, color: shell.text2, fontStyle: 'italic', fontFamily: 'Merriweather, Georgia, serif' }}>
                                          {children}
                                        </blockquote>
                                        <button
                                          onClick={() => {
                                            if (!user) { showToast('Sign in to save quotes'); return }
                                            if (!quoteText) return
                                            setSaveModal({
                                              text: quoteText,
                                              title: m.sources?.[0]?.title || 'William Branham Sermon',
                                              date: m.sources?.[0]?.date || '',
                                            })
                                          }}
                                          style={{ ...iconBtn(), position: 'absolute', right: 0, top: 0, width: 24, height: 24 }}
                                          title="Save this quote"
                                        >
                                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                                        </button>
                                      </div>
                                    )
                                  },
                                }}>{m.content || ''}</ReactMarkdown>
                              </div>

                              {m.sources && m.sources.length > 0 && (
                                <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                                  {m.sources.map((s: any, k: number) => (
                                    <div key={k} style={{ padding: '6px 10px', borderRadius: 9, border: `1px solid ${shell.border}`, background: shell.bg2 }}>
                                      <div style={{ fontSize: 12, fontWeight: 500 }}>{s.title || 'William Branham Sermon'}</div>
                                      <div style={{ fontSize: 11, color: shell.text3 }}>{s.date || ''}</div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                                <button onClick={() => copyText(m.content, i)} style={secondaryBtn({ fontSize: 11.5, padding: '5px 10px' })}>{copied === i ? 'Copied' : 'Copy'}</button>
                                <button onClick={() => {
                                  if (!user) { showToast('Sign in to save quotes'); return }
                                  setSaveModal({
                                    text: extractSavableQuote(m.content || ''),
                                    title: m.sources?.[0]?.title || 'William Branham Sermon',
                                    date: m.sources?.[0]?.date || '',
                                  })
                                }} style={secondaryBtn({ fontSize: 11.5, padding: '5px 10px' })}>Save</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
                {loading && <p style={{ color: shell.text3, fontSize: 13 }}>Loading...</p>}
                <div ref={endRef} />
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${shell.borderSoft}`, padding: '12px 20px 18px' }}>
              <div style={{ maxWidth: 760, margin: '0 auto' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', background: shell.bg3, borderRadius: 9, padding: 3, gap: 2 }}>
                    {[{ id: 'chat', label: 'Chat' }, { id: 'search', label: 'Search' }].map(m => (
                      <button key={m.id} onClick={() => setMode(m.id as 'chat' | 'search')} style={{
                        padding: '5px 14px',
                        borderRadius: 7,
                        border: 'none',
                        cursor: 'pointer',
                        background: mode === m.id ? (m.id === 'chat' ? shell.amber : shell.bg) : 'transparent',
                        color: mode === m.id ? (m.id === 'chat' ? 'white' : shell.text) : shell.text3,
                        fontSize: 12.5,
                        fontWeight: 500,
                      }}>{m.label}</button>
                    ))}
                  </div>
                  {mode === 'search' && (
                    <div style={{ display: 'flex', gap: 5 }}>
                      {[{ id: 'both', label: 'Both' }, { id: 'message', label: 'Message' }, { id: 'bible', label: 'Bible' }].map(s => (
                        <button key={s.id} onClick={() => setSearchSource(s.id as SearchSource)} style={{
                          border: `1px solid ${searchSource === s.id ? shell.amber : shell.border}`,
                          background: searchSource === s.id ? '#fdf4e7' : shell.bg,
                          color: searchSource === s.id ? '#a36214' : shell.text2,
                          borderRadius: 999,
                          padding: '4px 10px',
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}>{s.label}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, border: `1px solid ${composerFocused ? 'rgba(0,0,0,0.13)' : shell.border}`, borderRadius: 16, padding: '10px 12px', boxShadow: composerFocused ? '0 2px 18px rgba(0,0,0,0.12)' : '0 2px 14px rgba(0,0,0,0.06)', transition: 'all .18s' }}>
                  <textarea
                    ref={taRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onFocus={() => setComposerFocused(true)}
                    onBlur={() => setComposerFocused(false)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder={mode === 'chat' ? 'Ask about the Message or the Bible...' : 'Search exact quotes...'}
                    rows={1}
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, lineHeight: 1.45, resize: 'none', maxHeight: 120 }}
                  />
                  <button onClick={send} disabled={!query.trim() || loading} title={mode === 'chat' ? 'Send message' : 'Search'} style={{
                    width: 36, height: 36, borderRadius: 10, border: 'none',
                    background: query.trim() && !loading ? shell.amber : shell.bg3,
                    color: query.trim() && !loading ? 'white' : shell.text3,
                    cursor: query.trim() && !loading ? 'pointer' : 'default',
                  }}>
                    {mode === 'chat' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    )}
                  </button>
                </div>
                <p style={{ textAlign: 'center', fontSize: 11, color: shell.text3, marginTop: 7 }}>Sources limited to William Branham sermons and the KJV Bible</p>
              </div>
            </div>
          </>
        )}

        {view === 'folders' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 20px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              {!user ? (
                <div style={emptyCard()}>
                  <h2 style={{ marginBottom: 6 }}>Folders & Saved Quotes</h2>
                  <p style={{ color: shell.text2, fontSize: 13, marginBottom: 14 }}>Sign in to create folders and organize your saved passages.</p>
                  <button onClick={() => setAuthMode('login')} style={primaryBtn()}>Sign in</button>
                </div>
              ) : activeFolder ? (
                <>
                  <button onClick={() => setActiveFolder(null)} style={textBtn(shell.amber)}>← Back to folders</button>
                  <h2 style={{ marginTop: 8, marginBottom: 14 }}>{activeFolder.name}</h2>
                  {filteredFolderQuotes.length === 0 ? <p style={{ color: shell.text3 }}>No quotes in this folder yet.</p> : filteredFolderQuotes.map(q => (
                    <div key={q.id} style={resultCard()}>
                      <p style={{ borderLeft: `2px solid ${shell.amber}`, paddingLeft: 12, fontStyle: 'italic', color: shell.text2, fontFamily: 'Merriweather, Georgia, serif' }}>"{q.quote_text}"</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{q.source_title}</div>
                          <div style={{ fontSize: 11, color: shell.text3 }}>{q.source_date}</div>
                        </div>
                        <button onClick={() => deleteQuote(q.id)} style={secondaryBtn({ fontSize: 11, padding: '5px 8px' })}>Remove</button>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                    <h2>Folders</h2>
                    <button onClick={() => setShowNewFolder(v => !v)} style={secondaryBtn()}>{showNewFolder ? 'Close' : '+ New folder'}</button>
                  </div>
                  {showNewFolder && (
                    <div style={{ ...resultCard(), marginBottom: 12 }}>
                      <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFolder()} placeholder="Folder name" style={inputStyle({ marginBottom: 10 })} />
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        {COLORS.map(c => (
                          <button key={c} onClick={() => setNewFolderColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', border: newFolderColor === c ? `2px solid ${shell.text}` : '2px solid transparent', background: c, cursor: 'pointer' }} />
                        ))}
                      </div>
                      <button onClick={createFolder} style={primaryBtn()}>Create folder</button>
                    </div>
                  )}
                  {!folders.length ? (
                    <p style={{ color: shell.text3 }}>No folders yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                      {folders.map(f => {
                        const count = savedQuotes.filter(q => q.folder_id === f.id).length
                        return (
                          <button key={f.id} onClick={() => setActiveFolder(f)} style={{ ...resultCard(), textAlign: 'left', cursor: 'pointer' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <div style={{ width: 12, height: 12, borderRadius: 4, background: f.color }} />
                              <strong style={{ fontSize: 13 }}>{f.name}</strong>
                            </div>
                            <p style={{ fontSize: 12, color: shell.text3 }}>{count} quote{count !== 1 ? 's' : ''}</p>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {view === 'sermons' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 20px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <h2 style={{ marginBottom: 12 }}>Sermon Reader</h2>
              {SERMONS.map(s => (
                <div key={s.id} style={{ ...resultCard(), marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong>{s.title}</strong>
                    <span style={{ fontSize: 11.5, color: shell.text3 }}>{s.date}</span>
                  </div>
                  <p style={{ color: shell.text2, fontSize: 13, marginBottom: 8 }}>{s.preview}</p>
                  <p style={{ fontSize: 11.5, color: shell.text3 }}>{s.location}</p>
                </div>
              ))}
              <div style={resultCard()}>
                <h3 style={{ marginBottom: 8 }}>Sample Passage</h3>
                {SERMON_PARAS.map((p, i) => (
                  <p key={i} style={{ marginBottom: 10, lineHeight: 1.75, fontSize }}>{p}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === 'bible' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 20px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <h2 style={{ marginBottom: 12 }}>Bible Reader (KJV)</h2>
              {BIBLE_VERSES.map(v => (
                <div key={v.verse} style={{ ...resultCard(), marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: shell.text3, marginBottom: 6 }}>{v.verse}</div>
                  <p style={{ borderLeft: `2px solid ${shell.amber}`, paddingLeft: 12, fontStyle: 'italic', lineHeight: 1.7, fontSize, fontFamily: 'Merriweather, Georgia, serif' }}>{v.text}</p>
                  <div style={{ marginTop: 10 }}>
                    <button onClick={() => { if (!user) { showToast('Sign in to save quotes'); return }; setSaveModal({ text: v.text, title: v.verse, date: 'KJV' }) }} style={secondaryBtn({ fontSize: 11.5, padding: '5px 9px' })}>Save verse</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'settings' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 20px' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <h2 style={{ marginBottom: 12 }}>Settings</h2>
              <div style={resultCard()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: 14, marginBottom: 4 }}>Reading Font Size</h3>
                    <p style={{ color: shell.text2, fontSize: 12.5 }}>Adjust chat, quote, and reader text size.</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => setFontSize(v => Math.max(13, v - 1))} style={iconBtn()}>-</button>
                    <span style={{ fontSize: 13, minWidth: 24, textAlign: 'center' }}>{fontSize}</span>
                    <button onClick={() => setFontSize(v => Math.min(20, v + 1))} style={iconBtn()}>+</button>
                  </div>
                </div>
              </div>
              <div style={{ ...resultCard(), marginTop: 10 }}>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>Account</h3>
                {!user ? (
                  <>
                    <p style={{ fontSize: 12.5, color: shell.text2, marginBottom: 8 }}>You are browsing as guest.</p>
                    <button onClick={() => setAuthMode('login')} style={primaryBtn()}>Sign in</button>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 12.5, color: shell.text2, marginBottom: 8 }}>{user.email}</p>
                    <button onClick={signOut} style={secondaryBtn()}>Sign out</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'); *{box-sizing:border-box} body{margin:0}` }} />
    </div>
  )
}

function viewTitle(view: View) {
  if (view === 'chat') return 'Chat & Search'
  if (view === 'folders') return 'Folders'
  if (view === 'sermons') return 'Sermon Reader'
  if (view === 'bible') return 'Bible Reader'
  return 'Settings'
}

function inputStyle(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 9,
    border: '1px solid rgba(0,0,0,0.11)',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    ...extra,
  }
}

function primaryBtn(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: '#c47a1a',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    ...extra,
  }
}

function secondaryBtn(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: '#f2f2f0',
    color: '#5a5a56',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 8,
    padding: '7px 10px',
    fontSize: 12.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
    ...extra,
  }
}

function textBtn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    color,
    cursor: 'pointer',
    fontSize: 12.5,
    fontFamily: 'inherit',
  }
}

function iconBtn(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,0.08)',
    background: 'white',
    color: '#5a5a56',
    cursor: 'pointer',
    fontSize: 12,
    ...extra,
  }
}

function navBtn(): React.CSSProperties {
  return {
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: '#5a5a56',
    textAlign: 'left',
    borderRadius: 8,
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12.5,
    fontFamily: 'inherit',
  }
}

function resultCard(): React.CSSProperties {
  return {
    border: '1px solid rgba(0,0,0,0.07)',
    borderRadius: 12,
    background: 'white',
    padding: '14px 16px',
  }
}

function emptyCard(): React.CSSProperties {
  return {
    border: '1px solid rgba(0,0,0,0.06)',
    background: '#f9f9f8',
    borderRadius: 14,
    padding: 22,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 20,
  }
}
