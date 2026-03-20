'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { supabase } from '@/lib/supabase'

type Message = { role: 'user' | 'assistant'; content: string; sources?: any[] }
type Folder = { id: string; name: string; color: string; created_at?: string }
type SavedQuote = { id: string; quote_text: string; source_title: string; source_date: string; folder_id: string | null }
type SearchResult = { quote_text: string; source_title: string; source_date: string; source: 'message' | 'bible' }
type SearchSource = 'both' | 'message' | 'bible'
type MainTab = 'chat' | 'folders'

const COLORS = ['#A0EEC0', '#8AE9C1', '#86CD82', '#72A276', '#666B6A', '#000000']

const theme = {
  accent: '#86CD82',
  palette: ['#A0EEC0', '#8AE9C1', '#86CD82', '#72A276', '#666B6A', '#000000'],
  light: {
    bg: '#FFFFFF',
    surface: '#F5F5F7',
    surface2: '#ECECEF',
    text: '#000000',
    text2: '#4A4A4A',
    border: 'rgba(0,0,0,0.08)',
    shadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  dark: {
    bg: '#1C1C1E',
    surface: '#2C2C2E',
    surface2: '#2F2F31',
    text: '#FFFFFF',
    text2: 'rgba(255,255,255,0.72)',
    border: 'rgba(255,255,255,0.06)',
    shadow: 'none',
  },
}

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [darkMode, setDarkMode] = useState(false)
  const [tab, setTab] = useState<MainTab>('chat')
  const [mode, setMode] = useState<'chat' | 'search'>('chat')
  const [searchSource, setSearchSource] = useState<SearchSource>('both')

  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [copied, setCopied] = useState<number | null>(null)
  const [composerFocused, setComposerFocused] = useState(false)

  const [folders, setFolders] = useState<Folder[]>([])
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState(COLORS[2])

  const [saveModal, setSaveModal] = useState<{ text: string; title: string; date: string } | null>(null)
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const taRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const t = darkMode ? theme.dark : theme.light

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
    const { error } = await supabase.from('folders').insert({
      name: newFolderName.trim(),
      color: newFolderColor,
      user_id: user.id,
    })
    if (error) {
      showToast(error.message || 'Failed to create folder')
      return
    }
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

  const folderQuotes = useMemo(() => {
    if (!activeFolder) return []
    return savedQuotes.filter(q => q.folder_id === activeFolder.id)
  }, [activeFolder, savedQuotes])

  if (authMode) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: t.bg, color: t.text, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif' }}>
        <div style={{ width: 390, background: t.surface, borderRadius: 24, padding: 28, boxShadow: t.shadow, border: `1px solid ${t.border}` }}>
          <h2 style={{ marginBottom: 6, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{authMode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <p style={{ marginBottom: 16, color: t.text2 }}>Save quotes, organize folders, and sync your search history.</p>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" style={inputStyle(t)} />
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? signIn() : signUp())} style={inputStyle(t, { marginTop: 10 })} />
          {authError && <p style={{ color: '#ff6b6b', fontSize: 12, marginTop: 10 }}>{authError}</p>}
          <button onClick={authMode === 'login' ? signIn : signUp} disabled={authLoading} style={primaryButtonStyle()}>
            {authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} style={flatTextButton(theme.accent)}>{authMode === 'login' ? 'Create account' : 'Sign in instead'}</button>
            <button onClick={() => setAuthMode(null)} style={flatTextButton(t.text2)}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: t.bg,
      color: t.text,
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif',
      fontSize: 16,
      fontWeight: 500,
      lineHeight: 1.7,
      transition: 'background 150ms ease, color 150ms ease',
    }}>
      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', background: t.surface2, color: t.text, border: `1px solid ${t.border}`, borderRadius: 999, padding: '8px 14px', fontSize: 12, zIndex: 50 }}>
          {toast}
        </div>
      )}

      {saveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', display: 'grid', placeItems: 'center', zIndex: 40 }}>
          <div style={{ width: 420, background: t.surface, borderRadius: 24, border: `1px solid ${t.border}`, boxShadow: t.shadow, padding: 20 }}>
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>Save Quote</h3>
            <p style={{ marginBottom: 14, color: t.text2, borderLeft: `3px solid ${theme.accent}`, paddingLeft: 12, fontStyle: 'italic', lineHeight: 1.6 }}>
              "{saveModal.text.slice(0, 220)}{saveModal.text.length > 220 ? '...' : ''}"
            </p>
            {folders.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: t.text2, marginBottom: 6 }}>Folder (optional)</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {folders.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setSaveFolderId(saveFolderId === f.id ? null : f.id)}
                      style={{
                        ...pillButton(t),
                        background: saveFolderId === f.id ? `${f.color}35` : t.surface2,
                        borderColor: saveFolderId === f.id ? f.color : t.border,
                        color: saveFolderId === f.id ? f.color : t.text2,
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveQuote} style={{ ...primaryButtonStyle(), marginTop: 0, flex: 1 }}>Save</button>
              <button onClick={() => { setSaveModal(null); setSaveFolderId(null) }} style={{ ...secondaryButtonStyle(t), flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <header style={{ height: 68, background: t.bg, borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 14, background: theme.accent, color: '#fff', display: 'grid', placeItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>The Message Search</div>
            <div style={{ fontSize: 12, color: t.text2 }}>Apple-inspired study workspace</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setDarkMode(v => !v)} style={secondaryButtonStyle(t)}>
            {darkMode ? 'Light' : 'Dark'}
          </button>
          {user ? (
            <button onClick={signOut} style={secondaryButtonStyle(t)}>Sign out</button>
          ) : (
            <button onClick={() => setAuthMode('login')} style={primaryButtonStyle(false)}>Sign in</button>
          )}
        </div>
      </header>

      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '16px 16px 26px', display: 'flex', gap: 14 }}>
        <aside style={{ width: 260, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 24, boxShadow: t.shadow, padding: 12, height: 'calc(100vh - 118px)', position: 'sticky', top: 84 }}>
          <button onClick={() => { setTab('chat'); setMode('chat'); setMessages([]); setSearchResults([]) }} style={{ ...primaryButtonStyle(false), width: '100%', marginBottom: 10 }}>+ New search</button>

          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            <button onClick={() => setTab('chat')} style={{ ...pillButton(t), justifyContent: 'flex-start', textAlign: 'left', background: tab === 'chat' ? `${theme.accent}28` : t.surface2, borderColor: tab === 'chat' ? theme.accent : t.border, color: tab === 'chat' ? theme.accent : t.text2 }}>Chat / Search</button>
            <button onClick={() => setTab('folders')} style={{ ...pillButton(t), justifyContent: 'flex-start', textAlign: 'left', background: tab === 'folders' ? `${theme.accent}28` : t.surface2, borderColor: tab === 'folders' ? theme.accent : t.border, color: tab === 'folders' ? theme.accent : t.text2 }}>Folders</button>
          </div>

          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: t.text2, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Folders</div>
            <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
              {folders.length === 0 ? (
                <p style={{ fontSize: 12, color: t.text2, margin: '6px 4px' }}>No folders yet</p>
              ) : folders.map(f => (
                <button key={f.id} onClick={() => { setTab('folders'); setActiveFolder(f) }} style={{ width: '100%', border: 'none', background: 'transparent', padding: '7px 8px', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: t.text }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: f.color }} />
                  <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: t.text2 }}>{savedQuotes.filter(q => q.folder_id === f.id).length}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 10, paddingTop: 10 }}>
            {!user ? (
              <>
                <p style={{ fontSize: 12, color: t.text2, marginBottom: 8 }}>Sign in to save and organize quotes.</p>
                <button onClick={() => setAuthMode('login')} style={{ ...primaryButtonStyle(false), width: '100%' }}>Sign in</button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12, color: t.text2, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
                <button onClick={signOut} style={{ ...secondaryButtonStyle(t), width: '100%' }}>Sign out</button>
              </>
            )}
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === 'chat' ? (
          <div style={{ background: t.surface, borderRadius: 24, border: `1px solid ${t.border}`, boxShadow: t.shadow, overflow: 'hidden' }}>
            <div style={{ minHeight: 420, maxHeight: '62vh', overflowY: 'auto', padding: '22px 18px' }}>
              {mode === 'search' ? (
                <>
                  {!searchResults.length && !loading && (
                    <div style={emptyCardStyle(t)}>
                      <h2 style={{ marginBottom: 6, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Search raw passages</h2>
                      <p style={{ color: t.text2 }}>Use semantic + source filters to browse direct quote matches.</p>
                    </div>
                  )}
                  {searchResults.map((r, i) => (
                    <div key={i} style={cardStyle(t)}>
                      <p style={{ margin: 0, borderLeft: `3px solid ${theme.accent}`, paddingLeft: 12, lineHeight: 1.72, fontStyle: 'italic' }}>"{r.quote_text}"</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.source_title || (r.source === 'bible' ? 'KJV Bible' : 'William Branham Sermon')}</div>
                          <div style={{ color: t.text2, fontSize: 12 }}>{r.source_date || (r.source === 'bible' ? 'KJV' : '')}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => { if (!user) return showToast('Sign in to save quotes'); setSaveModal({ text: r.quote_text, title: r.source_title, date: r.source_date }) }} style={pillButton(t)}>Save</button>
                          <span style={{ ...pillButton(t), cursor: 'default' }}>{r.source}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {!messages.length && !loading && (
                    <div style={emptyCardStyle(t)}>
                      <h1 style={{ marginBottom: 6, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>Ask anything</h1>
                      <p style={{ color: t.text2, maxWidth: 560, margin: '0 auto' }}>AI responses from William Branham sermons and the KJV Bible, with clean sources and save controls.</p>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} style={{ marginBottom: 16 }}>
                      {m.role === 'user' ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <div style={{ maxWidth: '78%', background: theme.accent, color: '#fff', borderRadius: 20, padding: '11px 14px', lineHeight: 1.6 }}>{m.content}</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 10 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 12, background: t.surface2, border: `1px solid ${t.border}`, display: 'grid', placeItems: 'center', marginTop: 2 }}>
                            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke={theme.accent} strokeWidth="1.5" strokeLinejoin="round"/></svg>
                          </div>
                          <div style={{ flex: 1, background: t.surface2, borderRadius: 20, padding: '12px 14px', border: `1px solid ${t.border}` }}>
                            <ReactMarkdown components={{
                              p: ({ children }) => <p style={{ margin: '0 0 9px', lineHeight: 1.75 }}>{children}</p>,
                              h2: ({ children }) => <h2 style={{ fontSize: 18, fontWeight: 600, margin: '10px 0 8px' }}>{children}</h2>,
                              h3: ({ children }) => <h3 style={{ fontSize: 16, fontWeight: 600, margin: '10px 0 6px' }}>{children}</h3>,
                              ul: ({ children }) => <ul style={{ paddingLeft: 18, marginBottom: 8 }}>{children}</ul>,
                              li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
                              blockquote: ({ children }) => {
                                const quoteText = getPlainTextFromNode(children).trim()
                                return (
                                  <div style={{ position: 'relative', margin: '10px 0' }}>
                                    <blockquote style={{ margin: 0, borderLeft: `3px solid ${theme.accent}`, paddingLeft: 12, paddingRight: 34, fontStyle: 'italic', lineHeight: 1.7 }}>{children}</blockquote>
                                    <button
                                      onClick={() => {
                                        if (!user) return showToast('Sign in to save quotes')
                                        if (!quoteText) return
                                        setSaveModal({ text: quoteText, title: m.sources?.[0]?.title || 'William Branham Sermon', date: m.sources?.[0]?.date || '' })
                                      }}
                                      style={{ ...pillButton(t), width: 28, height: 28, padding: 0, position: 'absolute', top: -1, right: 0, display: 'grid', placeItems: 'center' }}
                                      title="Save quote"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                                    </button>
                                  </div>
                                )
                              },
                            }}>{m.content || ''}</ReactMarkdown>

                            {m.sources && m.sources.length > 0 && (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                {m.sources.map((s: any, idx: number) => (
                                  <div key={idx} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: '8px 10px', minWidth: 160 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 600, color: theme.accent }}>{s.title || 'William Branham Sermon'}</div>
                                    <div style={{ fontSize: 11.5, color: t.text2 }}>{s.date || ''}{s.ref ? ` · #${s.ref}` : ''}</div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                              <button onClick={() => copyText(m.content, i)} style={pillButton(t)}>{copied === i ? 'Copied' : 'Copy'}</button>
                              <button onClick={() => {
                                if (!user) return showToast('Sign in to save quotes')
                                setSaveModal({
                                  text: extractSavableQuote(m.content || ''),
                                  title: m.sources?.[0]?.title || 'William Branham Sermon',
                                  date: m.sources?.[0]?.date || '',
                                })
                              }} style={pillButton(t)}>Save</button>
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

            <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${t.border}` }}>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'inline-flex', padding: 4, borderRadius: 999, background: t.surface2 }}>
                  {(['chat', 'search'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setMode(v)}
                      style={{
                        border: 'none',
                        borderRadius: 999,
                        padding: '8px 14px',
                        background: mode === v ? (v === 'chat' ? theme.accent : t.bg) : 'transparent',
                        color: mode === v ? (v === 'chat' ? '#fff' : t.text) : t.text2,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                      }}
                    >
                      {v === 'chat' ? 'Chat' : 'Search'}
                    </button>
                  ))}
                </div>

                {mode === 'search' && (
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    {(['both', 'message', 'bible'] as SearchSource[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setSearchSource(s)}
                        style={{
                          ...pillButton(t),
                          background: searchSource === s ? `${theme.accent}30` : t.surface2,
                          borderColor: searchSource === s ? theme.accent : t.border,
                          color: searchSource === s ? theme.accent : t.text2,
                        }}
                      >
                        {s === 'both' ? 'Both' : s === 'message' ? 'Message' : 'Bible'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{
                marginTop: 10,
                borderRadius: 24,
                background: t.bg,
                border: `1px solid ${composerFocused ? theme.accent : t.border}`,
                boxShadow: t.shadow,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                padding: '10px 10px 10px 14px',
                transition: 'all 150ms ease',
              }}>
                <textarea
                  ref={taRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder={mode === 'chat' ? 'Ask about The Message or the Bible...' : 'Search passages directly...'}
                  rows={1}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    background: 'transparent',
                    color: t.text,
                    fontSize: 15,
                    lineHeight: 1.45,
                    maxHeight: 140,
                  }}
                />
                <button
                  onClick={send}
                  disabled={!query.trim() || loading}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 999,
                    border: 'none',
                    background: query.trim() && !loading ? theme.accent : t.surface2,
                    color: query.trim() && !loading ? '#fff' : t.text2,
                    display: 'grid',
                    placeItems: 'center',
                    cursor: query.trim() && !loading ? 'pointer' : 'default',
                    transition: 'all 150ms ease',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
                </button>
              </div>
              <p style={{ textAlign: 'center', marginTop: 8, color: t.text2, fontSize: 11.5 }}>Sources limited to William Branham sermons and the KJV Bible.</p>
            </div>
          </div>
        ) : (
          <div style={{ background: t.surface, borderRadius: 24, border: `1px solid ${t.border}`, boxShadow: t.shadow, padding: 18 }}>
            {!user ? (
              <div style={emptyCardStyle(t)}>
                <h2 style={{ marginBottom: 6, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Folders</h2>
                <p style={{ marginBottom: 12, color: t.text2 }}>Sign in to create folders and save your quotes.</p>
                <button onClick={() => setAuthMode('login')} style={primaryButtonStyle(false)}>Sign in</button>
              </div>
            ) : activeFolder ? (
              <>
                <button onClick={() => setActiveFolder(null)} style={flatTextButton(theme.accent)}>← Back to folders</button>
                <h2 style={{ margin: '6px 0 12px' }}>{activeFolder.name}</h2>
                {!folderQuotes.length ? <p style={{ color: t.text2 }}>No quotes saved in this folder yet.</p> : (
                  folderQuotes.map(q => (
                    <div key={q.id} style={cardStyle(t)}>
                      <p style={{ margin: 0, borderLeft: `3px solid ${theme.accent}`, paddingLeft: 12, fontStyle: 'italic', lineHeight: 1.7 }}>"{q.quote_text}"</p>
                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{q.source_title}</div>
                          <div style={{ color: t.text2, fontSize: 12 }}>{q.source_date}</div>
                        </div>
                        <button onClick={() => deleteQuote(q.id)} style={pillButton(t)}>Remove</button>
                      </div>
                    </div>
                  ))
                )}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Folders</h2>
                  <button onClick={() => setShowNewFolder(v => !v)} style={pillButton(t)}>{showNewFolder ? 'Close' : '+ New folder'}</button>
                </div>

                {showNewFolder && (
                  <div style={{ ...cardStyle(t), marginBottom: 12 }}>
                    <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name" onKeyDown={e => e.key === 'Enter' && createFolder()} style={inputStyle(t, { marginBottom: 10 })} />
                    <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
                      {COLORS.map(c => (
                        <button key={c} onClick={() => setNewFolderColor(c)} style={{ width: 24, height: 24, borderRadius: 999, background: c, border: newFolderColor === c ? `2px solid ${t.text}` : '2px solid transparent', cursor: 'pointer' }} />
                      ))}
                    </div>
                    <button onClick={createFolder} style={primaryButtonStyle(false)}>Create folder</button>
                  </div>
                )}

                {!folders.length ? (
                  <p style={{ color: t.text2 }}>No folders yet.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
                    {folders.map(f => {
                      const count = savedQuotes.filter(q => q.folder_id === f.id).length
                      return (
                        <button key={f.id} onClick={() => setActiveFolder(f)} style={{ ...cardStyle(t), textAlign: 'left', cursor: 'pointer', transition: 'transform 150ms ease, box-shadow 150ms ease' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 999, background: f.color }} />
                            <strong style={{ fontSize: 14 }}>{f.name}</strong>
                          </div>
                          <p style={{ margin: 0, fontSize: 12.5, color: t.text2 }}>{count} quote{count !== 1 ? 's' : ''}</p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

function inputStyle(t: { border: string; bg: string; text: string }, extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    width: '100%',
    borderRadius: 14,
    border: `1px solid ${t.border}`,
    background: t.bg,
    color: t.text,
    fontSize: 14,
    padding: '11px 13px',
    outline: 'none',
    transition: 'all 160ms ease',
    ...extra,
  }
}

function primaryButtonStyle(block = true): React.CSSProperties {
  return {
    width: block ? '100%' : 'auto',
    marginTop: block ? 14 : 0,
    border: 'none',
    borderRadius: 14,
    background: theme.accent,
    color: '#fff',
    padding: '10px 16px',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    transition: 'all 150ms ease',
  }
}

function secondaryButtonStyle(t: { surface2: string; border: string; text2: string }): React.CSSProperties {
  return {
    border: `1px solid ${t.border}`,
    borderRadius: 14,
    background: t.surface2,
    color: t.text2,
    padding: '9px 13px',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 150ms ease',
  }
}

function flatTextButton(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    color,
    fontSize: 13,
    cursor: 'pointer',
  }
}

function pillButton(t: { surface2: string; border: string; text2: string }): React.CSSProperties {
  return {
    border: `1px solid ${t.border}`,
    borderRadius: 999,
    background: t.surface2,
    color: t.text2,
    padding: '6px 11px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 150ms ease',
  }
}

function cardStyle(t: { bg: string; border: string; shadow: string }): React.CSSProperties {
  return {
    background: t.bg,
    border: `1px solid ${t.border}`,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    boxShadow: t.shadow,
  }
}

function emptyCardStyle(t: { surface2: string; border: string }): React.CSSProperties {
  return {
    borderRadius: 22,
    padding: 28,
    textAlign: 'center',
    border: `1px solid ${t.border}`,
    background: t.surface2,
    marginBottom: 10,
  }
}
