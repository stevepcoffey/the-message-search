'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { supabase } from '@/lib/supabase'

type Message = { role: string; content: string; sources?: any[] }
type Folder = { id: string; name: string; color: string }
type SavedQuote = { id: string; quote_text: string; source_title: string; source_date: string; folder_id: string | null }

const COLORS = ['#c47a1a', '#5b8dd9', '#7c6abf', '#4aab7c', '#d97b4a', '#e05c5c']

export default function Home() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [tab, setTab] = useState<'chat' | 'folders'>('chat')
  const [user, setUser] = useState<any>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState(COLORS[0])
  const [saveModal, setSaveModal] = useState<{ text: string; title: string; date: string } | null>(null)
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => { if (user) { loadFolders(); loadQuotes() } }, [user])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => {
    if (taRef.current) { taRef.current.style.height = '24px'; taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + 'px' }
  }, [query])

  const loadFolders = async () => { const { data } = await supabase.from('folders').select('*').order('created_at'); setFolders(data || []) }
  const loadQuotes = async () => { const { data } = await supabase.from('saved_quotes').select('*').order('created_at', { ascending: false }); setSavedQuotes(data || []) }
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const signIn = async () => {
    setAuthLoading(true); setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
    else { setAuthMode(null); setEmail(''); setPassword('') }
    setAuthLoading(false)
  }

  const signUp = async () => {
    setAuthLoading(true); setAuthError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) setAuthError(error.message)
    else { setAuthMode(null); setEmail(''); setPassword(''); showToast('Account created! You can now sign in.') }
    setAuthLoading(false)
  }

  const signOut = async () => { await supabase.auth.signOut(); setFolders([]); setSavedQuotes([]); setActiveFolder(null) }

  const createFolder = async () => {
    if (!newFolderName.trim() || !user) return
    const { data } = await supabase.from('folders').insert({ name: newFolderName.trim(), color: newFolderColor, user_id: user.id }).select().single()
    if (data) { setFolders([...folders, data]); setNewFolderName(''); setShowNewFolder(false); showToast('Folder created') }
  }

  const saveQuote = async () => {
    if (!saveModal || !user) return
    const { error } = await supabase.from('saved_quotes').insert({ user_id: user.id, quote_text: saveModal.text, source_title: saveModal.title || 'William Branham Sermon', source_date: saveModal.date || '', source_type: 'message', folder_id: saveFolderId || null })
    if (!error) { loadQuotes(); setSaveModal(null); setSaveFolderId(null); showToast('Quote saved!') }
  }

  const deleteQuote = async (id: string) => { await supabase.from('saved_quotes').delete().eq('id', id); setSavedQuotes(savedQuotes.filter(q => q.id !== id)); showToast('Quote removed') }

  const send = async () => {
    if (!query.trim() || loading) return
    const q = query.trim(); setQuery(''); setLoading(true)
    const next = [...messages, { role: 'user', content: q }]; setMessages(next)
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
      const data = await res.json()
      setMessages([...next, { role: 'assistant', content: data.response, sources: data.sources }])
    } catch { setMessages([...next, { role: 'assistant', content: 'Something went wrong.', sources: [] }]) }
    setLoading(false)
  }

  const copyText = (text: string, i: number) => { navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 2000) }
  const isEmpty = !messages.length && !loading
  const amber = '#c47a1a'

  if (authMode) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f9f9f8', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ width: 380, background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.08)', padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: amber, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{authMode === 'login' ? 'Sign in' : 'Create account'}</span>
        </div>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, marginBottom: 10, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" onKeyDown={e => e.key === 'Enter' && (authMode === 'login' ? signIn() : signUp())} style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, marginBottom: 10, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        {authError && <p style={{ color: '#dc3535', fontSize: 13, marginBottom: 10 }}>{authError}</p>}
        <button onClick={authMode === 'login' ? signIn : signUp} disabled={authLoading} style={{ width: '100%', padding: 11, borderRadius: 8, background: amber, color: 'white', border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>
          {authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} style={{ background: 'none', border: 'none', color: amber, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>{authMode === 'login' ? 'Create account' : 'Sign in instead'}</button>
          <button onClick={() => setAuthMode(null)} style={{ background: 'none', border: 'none', color: '#a3a39e', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Inter, -apple-system, sans-serif', background: '#fff', color: '#0d0d0c' }}>
      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1a1a18', color: 'white', padding: '10px 20px', borderRadius: 10, fontSize: 13, zIndex: 200 }}>{toast}</div>}
      {saveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ width: 380, background: '#fff', borderRadius: 16, padding: 24 }}>
            <h3 style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Save quote</h3>
            <p style={{ fontSize: 13, color: '#5a5a56', fontStyle: 'italic', borderLeft: '2px solid ' + amber, paddingLeft: 10, marginBottom: 16, lineHeight: 1.6 }}>"{saveModal.text.slice(0, 120)}{saveModal.text.length > 120 ? '...' : ''}"</p>
            {folders.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: '#5a5a56', marginBottom: 8 }}>Add to folder (optional)</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {folders.map(f => <button key={f.id} onClick={() => setSaveFolderId(saveFolderId === f.id ? null : f.id)} style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid ' + (saveFolderId === f.id ? f.color : 'rgba(0,0,0,0.1)'), background: saveFolderId === f.id ? f.color + '20' : 'transparent', color: saveFolderId === f.id ? f.color : '#5a5a56', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{f.name}</button>)}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveQuote} style={{ flex: 1, padding: 10, borderRadius: 8, background: amber, color: 'white', border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
              <button onClick={() => { setSaveModal(null); setSaveFolderId(null) }} style={{ flex: 1, padding: 10, borderRadius: 8, background: '#f2f2f0', color: '#5a5a56', border: 'none', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 52, borderBottom: '1px solid rgba(0,0,0,0.07)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 9, background: amber, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>The Message Search</span>
        <div style={{ flex: 1 }} />
        {['chat', 'folders'].map(t => <button key={t} onClick={() => setTab(t as any)} style={{ padding: '5px 14px', borderRadius: 8, background: tab === t ? '#f2f2f0' : 'transparent', color: tab === t ? '#0d0d0c' : '#a3a39e', fontSize: 13, fontWeight: tab === t ? 500 : 400, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{t}</button>)}
        <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.1)', margin: '0 4px' }} />
        {user ? <button onClick={signOut} style={{ padding: '5px 12px', borderRadius: 8, background: 'transparent', color: '#a3a39e', fontSize: 13, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Sign out</button>
          : <button onClick={() => setAuthMode('login')} style={{ padding: '5px 14px', borderRadius: 8, background: amber, color: 'white', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Sign in</button>}
      </div>

      {tab === 'folders' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {!user ? (
              <div style={{ textAlign: 'center', paddingTop: 80 }}>
                <p style={{ color: '#5a5a56', marginBottom: 16 }}>Sign in to save quotes and create folders.</p>
                <button onClick={() => setAuthMode('login')} style={{ padding: '10px 24px', borderRadius: 8, background: amber, color: 'white', border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Sign in</button>
              </div>
            ) : activeFolder ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                  <button onClick={() => setActiveFolder(null)} style={{ background: 'none', border: 'none', color: amber, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>← Folders</button>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: activeFolder.color }} />
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{activeFolder.name}</span>
                </div>
                {savedQuotes.filter(q => q.folder_id === activeFolder.id).length === 0
                  ? <p style={{ color: '#a3a39e', fontSize: 14 }}>No quotes saved here yet.</p>
                  : savedQuotes.filter(q => q.folder_id === activeFolder.id).map(q => (
                    <div key={q.id} style={{ marginBottom: 12, padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)' }}>
                      <p style={{ fontSize: 13.5, fontStyle: 'italic', borderLeft: '2px solid ' + amber, paddingLeft: 10, marginBottom: 10, lineHeight: 1.7 }}>"{q.quote_text}"</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div><p style={{ fontSize: 12, fontWeight: 500, color: amber }}>{q.source_title}</p><p style={{ fontSize: 11, color: '#a3a39e' }}>{q.source_date}</p></div>
                        <button onClick={() => deleteQuote(q.id)} style={{ background: 'none', border: 'none', color: '#a3a39e', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Remove</button>
                      </div>
                    </div>
                  ))}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h2 style={{ fontWeight: 600, fontSize: 17 }}>Folders</h2>
                  <button onClick={() => setShowNewFolder(true)} style={{ padding: '6px 14px', borderRadius: 8, background: '#f2f2f0', border: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>+ New folder</button>
                </div>
                {showNewFolder && (
                  <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)', background: '#f9f9f8' }}>
                    <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name" onKeyDown={e => e.key === 'Enter' && createFolder()} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, marginBottom: 10, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      {COLORS.map(c => <button key={c} onClick={() => setNewFolderColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: newFolderColor === c ? '2px solid #0d0d0c' : '2px solid transparent', cursor: 'pointer' }} />)}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={createFolder} style={{ padding: '7px 16px', borderRadius: 8, background: amber, color: 'white', border: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Create</button>
                      <button onClick={() => setShowNewFolder(false)} style={{ padding: '7px 16px', borderRadius: 8, background: 'transparent', color: '#a3a39e', border: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                    </div>
                  </div>
                )}
                {folders.length === 0 ? <p style={{ color: '#a3a39e', fontSize: 14 }}>No folders yet. Create one to start saving quotes.</p> : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {folders.map(f => {
                      const count = savedQuotes.filter(q => q.folder_id === f.id).length
                      return (
                        <div key={f.id} onClick={() => setActiveFolder(f)} style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)', cursor: 'pointer' }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: f.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                            <div style={{ width: 12, height: 12, borderRadius: 3, background: f.color }} />
                          </div>
                          <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>{f.name}</p>
                          <p style={{ fontSize: 12, color: '#a3a39e' }}>{count} quote{count !== 1 ? 's' : ''}</p>
                        </div>
                      )
                    })}
                  </div>
                )}
                {savedQuotes.filter(q => !q.folder_id).length > 0 && (
                  <div style={{ marginTop: 28 }}>
                    <h3 style={{ fontSize: 12, fontWeight: 600, color: '#a3a39e', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Unsorted</h3>
                    {savedQuotes.filter(q => !q.folder_id).map(q => (
                      <div key={q.id} style={{ marginBottom: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)' }}>
                        <p style={{ fontSize: 13, fontStyle: 'italic', borderLeft: '2px solid ' + amber, paddingLeft: 10, marginBottom: 8, lineHeight: 1.65 }}>"{q.quote_text.slice(0, 100)}{q.quote_text.length > 100 ? '...' : ''}"</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <p style={{ fontSize: 11, color: '#a3a39e' }}>{q.source_title}</p>
                          <button onClick={() => deleteQuote(q.id)} style={{ background: 'none', border: 'none', color: '#a3a39e', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              {isEmpty && (
                <div style={{ paddingTop: 80, textAlign: 'center' }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, background: amber, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                    <svg width="24" height="24" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', marginBottom: 8 }}>The Message Search</h1>
                  <p style={{ color: '#5a5a56', fontSize: 14, lineHeight: 1.65, maxWidth: 400, margin: '0 auto 40px' }}>Ask questions and search William Branham's sermons and the KJV Bible.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480, margin: '0 auto', textAlign: 'left' }}>
                    {['What did Branham teach about the new birth?', 'What is the token of the blood?', 'What did Branham say about healing?'].map((q, i) => (
                      <button key={i} onClick={() => setQuery(q)} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)', background: '#f9f9f8', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: amber, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Chat</div>
                        <div style={{ fontSize: 13.5, color: '#5a5a56' }}>{q}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ paddingTop: 24, paddingBottom: 16 }}>
                {messages.map((m, i) => (
                  <div key={i} style={{ marginBottom: 24 }}>
                    {m.role === 'user' ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{ background: '#1a1a18', color: '#f2f2ef', borderRadius: 18, borderBottomRightRadius: 4, padding: '10px 16px', maxWidth: '75%', fontSize: 14.5, lineHeight: 1.55 }}>{m.content}</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: amber, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                          <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14.5, lineHeight: 1.75, color: '#0d0d0c' }}>
                            <ReactMarkdown components={{
                              p: ({children}) => <p style={{ marginBottom: 10, lineHeight: 1.75, fontWeight: 400 }}>{children}</p>,
                              h2: ({children}) => <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, marginTop: 14 }}>{children}</h2>,
                              h3: ({children}) => <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, marginTop: 12 }}>{children}</h3>,
                              blockquote: ({children}) => <blockquote style={{ borderLeft: '2.5px solid ' + amber, paddingLeft: 14, margin: '12px 0', fontStyle: 'italic', color: '#5a5a56', fontSize: 14, lineHeight: 1.75 }}>{children}</blockquote>,
                              strong: ({children}) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                              ul: ({children}) => <ul style={{ paddingLeft: 20, marginBottom: 10 }}>{children}</ul>,
                              li: ({children}) => <li style={{ marginBottom: 4, lineHeight: 1.65 }}>{children}</li>,
                            }}>{m.content || ''}</ReactMarkdown>
                          </div>
                          {m.sources && m.sources.length > 0 && (
                            <div style={{ marginTop: 14, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                              {m.sources.map((s: any, k: number) => (
                                <div key={k} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#f9f9f8', fontSize: 12 }}>
                                  <div style={{ fontWeight: 500 }}>{s.title || 'William Branham Sermon'}</div>
                                  <div style={{ color: '#a3a39e', marginTop: 1 }}>{s.date ? s.date.slice(0, 4) : ''}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                            <button onClick={() => copyText(m.content, i)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: 'transparent', color: copied === i ? amber : '#a3a39e', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                              {copied === i ? 'Copied' : 'Copy'}
                            </button>
                            <button onClick={() => { if (!user) { showToast('Sign in to save quotes'); return }; setSaveModal({ text: m.content, title: m.sources?.[0]?.title || 'William Branham Sermon', date: m.sources?.[0]?.date || '' }) }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: 'transparent', color: '#a3a39e', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {loading && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: amber, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                    </div>
                    <div style={{ display: 'flex', gap: 5, padding: '10px 0' }}>
                      {[0,1,2].map(j => <div key={j} style={{ width: 7, height: 7, borderRadius: '50%', background: amber, opacity: 0.4 }} />)}
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.07)', padding: '12px 20px 20px', flexShrink: 0 }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', background: '#f2f2f0', borderRadius: 8, padding: 3, gap: 2 }}>
                  {[{ id: 'chat', label: 'Chat' }, { id: 'search', label: 'Search' }].map(m => (
                    <button key={m.id} onClick={() => setMode(m.id)} style={{ padding: '5px 16px', borderRadius: 6, background: mode === m.id ? (m.id === 'chat' ? amber : '#fff') : 'transparent', color: mode === m.id ? (m.id === 'chat' ? 'white' : '#0d0d0c') : '#a3a39e', fontSize: 13, fontWeight: mode === m.id ? 500 : 400, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>{m.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.12)', padding: '10px 12px', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', alignItems: 'flex-end' }}>
                <textarea ref={taRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder={mode === 'chat' ? 'Ask about the Message or the Bible...' : 'Search for a quote or verse...'} rows={1} style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, lineHeight: 1.45, background: 'transparent', color: '#0d0d0c', resize: 'none', fontFamily: 'inherit', maxHeight: 120, overflow: 'auto' }} />
                <button onClick={send} disabled={!query.trim() || loading} style={{ width: 36, height: 36, borderRadius: 10, background: query.trim() && !loading ? amber : '#f2f2f0', color: query.trim() && !loading ? 'white' : '#a3a39e', border: 'none', cursor: query.trim() && !loading ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
                </button>
              </div>
              <p style={{ textAlign: 'center', fontSize: 11, color: '#a3a39e', marginTop: 7 }}>William Branham's sermons & KJV Bible only</p>
            </div>
          </div>
        </>
      )}
      <style dangerouslySetInnerHTML={{__html: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } textarea { caret-color: #c47a1a; }`}} />
    </div>
  )
}
