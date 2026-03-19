'use client'

import { useState } from 'react'

export default function Home() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('chat')
  const [submode, setSubmode] = useState('semantic')
  const [source, setSource] = useState('both')
  const [messages, setMessages] = useState<any[]>([])
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('all')

  const send = async () => {
    if (!query.trim() || loading) return

    const q = query.trim()
    setQuery('')
    setLoading(true)

    try {
      if (mode === 'chat') {
        setResults([])

        const next = [...messages, { role: 'user', content: q }]
        setMessages(next)

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q })
        })

        // ✅ HANDLE API FAILURE
        if (!res.ok) {
          const text = await res.text()
          console.error('API error:', text)
          setLoading(false)
          return
        }

        // ✅ SAFE JSON PARSE
        let data
        try {
          data = await res.json()
        } catch (e) {
          console.error('Invalid JSON response')
          const text = await res.text()
          console.error('Raw response:', text)
          setLoading(false)
          return
        }

        setMessages([
          ...next,
          {
            role: 'assistant',
            content: data.response,
            sources: data.sources
          }
        ])
      } else {
        setMessages([])

        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, mode: submode, source })
        })

        if (!res.ok) {
          const text = await res.text()
          console.error('Search API error:', text)
          setLoading(false)
          return
        }

        let data
        try {
          data = await res.json()
        } catch (e) {
          console.error('Invalid search JSON')
          setLoading(false)
          return
        }

        setResults(data.results || [])
        setSourceFilter('all')
      }
    } catch (err) {
      console.error('Request failed:', err)
    }

    setLoading(false)
  }

  const filtered = sourceFilter === 'all'
    ? results
    : results.filter(r => r.source === sourceFilter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Inter, sans-serif', background: '#ffffff' }}>

      <div style={{ padding: '12px 24px', borderBottom: '1px solid #e5e5e3', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#c47a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>M</div>
        <span style={{ fontWeight: 600, fontSize: 15 }}>The Message Search</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>

        {!messages.length && !results.length && !loading && (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <div style={{ fontSize: 22, fontWeight: 600 }}>Search the Message & Bible</div>
            <p style={{ color: '#5a5a56', fontSize: 14 }}>
              Chat for AI answers or search for exact quotes.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            {m.role === 'user' ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ background: '#1a1a18', color: 'white', borderRadius: 16, padding: '10px 16px' }}>
                  {m.content}
                </div>
              </div>
            ) : (
              <div>
                <p>{m.content}</p>
              </div>
            )}
          </div>
        ))}

        {loading && <p>Loading...</p>}
      </div>

      <div style={{ padding: 20 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask something..."
          style={{ width: '80%', padding: 10 }}
        />
        <button onClick={send}>Send</button>
      </div>
    </div>
  )
}