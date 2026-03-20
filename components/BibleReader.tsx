'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BIBLE_BOOKS, BIBLE_SERIF_FONT, BIBLE_VERSE_SELECTED_BG, BIBLE_VERSE_SELECTED_BG_DARK } from '@/lib/bible-books'

type Theme = {
  bg: string
  bg2: string
  bg3: string
  text: string
  text2: string
  text3: string
  border: string
  shadow: string
}

export type BibleVerseRow = {
  id?: number
  verse: number
  text: string
  sermon_ref_count: number | null
}

type SermonRefRow = { id: string; title: string; date: string; reference_code: string }

type BibleReaderProps = {
  t: Theme
  darkMode: boolean
  fontSize: number
  user: any
  showToast: (msg: string) => void
  setSaveModal: (m: { text: string; title: string; date: string } | null) => void
  onBookChapterChange: (book: string, chapter: number) => void
}

function cacheKey(book: string, chapter: number) {
  return `${book}\0${chapter}`
}

function sanitizeSearch(q: string) {
  return q.replace(/%/g, '').replace(/_/g, ' ').trim()
}

export default function BibleReader({
  t,
  darkMode,
  fontSize,
  user,
  showToast,
  setSaveModal,
  onBookChapterChange,
}: BibleReaderProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [book, setBook] = useState(BIBLE_BOOKS[0].name)
  const [chapter, setChapter] = useState(1)
  const [verses, setVerses] = useState<BibleVerseRow[]>([])
  const chapterCacheRef = useRef<Record<string, BibleVerseRow[]>>({})
  const fetchReqId = useRef(0)
  const [chapterLoading, setChapterLoading] = useState(false)

  const [bibleSearch, setBibleSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<
    { book: string; chapter: number; verse: number; text: string }[]
  >([])

  const [selected, setSelected] = useState<{
    verse: number
    text: string
    sermon_ref_count: number
  } | null>(null)

  const [refPanel, setRefPanel] = useState<{
    verse: number
    count: number
  } | null>(null)
  const [refSermons, setRefSermons] = useState<SermonRefRow[]>([])
  const [refLoading, setRefLoading] = useState(false)
  /** Accordion: which book shows chapter grid (inline below the book row). */
  const [expandedBook, setExpandedBook] = useState<string | null>(BIBLE_BOOKS[0].name)

  const longPressRef = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const verseElRef = useRef<Record<number, HTMLDivElement | null>>({})
  const pendingScrollVerse = useRef<number | null>(null)

  const ot = useMemo(() => BIBLE_BOOKS.filter(b => b.testament === 'ot'), [])
  const nt = useMemo(() => BIBLE_BOOKS.filter(b => b.testament === 'nt'), [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const fn = () => setIsMobile(mq.matches)
    fn()
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(bibleSearch), 380)
    return () => window.clearTimeout(id)
  }, [bibleSearch])

  useEffect(() => {
    onBookChapterChange(book, chapter)
  }, [book, chapter, onBookChapterChange])

  useEffect(() => {
    const key = cacheKey(book, chapter)
    const cached = chapterCacheRef.current[key]
    if (cached) {
      setVerses(cached)
      setChapterLoading(false)
      return
    }
    const reqId = ++fetchReqId.current
    setChapterLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('bible_verses')
        .select('id, verse, text, sermon_ref_count')
        .eq('book', book)
        .eq('chapter', chapter)
        .order('verse', { ascending: true })

      if (fetchReqId.current !== reqId) return
      if (error) {
        showToast(error.message)
        setVerses([])
      } else {
        const rows = (data || []) as BibleVerseRow[]
        chapterCacheRef.current[key] = rows
        setVerses(rows)
      }
      if (fetchReqId.current === reqId) setChapterLoading(false)
    })()
  }, [book, chapter, showToast])

  useEffect(() => {
    const q = sanitizeSearch(debouncedSearch)
    if (q.length < 2) {
      setSearchResults([])
      return
    }
    let cancelled = false
    ;(async () => {
      setSearchLoading(true)
      const { data, error } = await supabase
        .from('bible_verses')
        .select('book, chapter, verse, text')
        .ilike('text', `%${q}%`)
        .limit(100)
      if (!cancelled) {
        if (error) showToast(error.message)
        else setSearchResults((data || []) as any[])
        setSearchLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, showToast])

  useEffect(() => {
    const v = pendingScrollVerse.current
    if (v == null || !verses.length) return
    const el = verseElRef.current[v]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      pendingScrollVerse.current = null
    }
  }, [verses])

  const selectVerse = (verse: number, text: string, sermon_ref_count: number) => {
    setSelected(s => (s?.verse === verse ? null : { verse, text, sermon_ref_count }))
  }

  const openRefPanel = async (verse: number, count: number) => {
    setRefPanel({ verse, count })
    setRefLoading(true)
    setRefSermons([])
    try {
      const res = await fetch('/api/bible/sermon-refs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book, chapter, verse }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed')
      setRefSermons(json.sermons || [])
    } catch (e: any) {
      showToast(e?.message || 'Could not load sermons')
    } finally {
      setRefLoading(false)
    }
  }

  const onVersePointerDown = (verse: number, text: string, count: number) => {
    longPressFired.current = false
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null
      longPressFired.current = true
      setSelected({ verse, text, sermon_ref_count: count })
    }, 480)
  }

  const onVersePointerUp = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  const goToResult = (b: string, ch: number, v: number, text: string) => {
    setBook(b)
    setChapter(ch)
    setExpandedBook(b)
    setBibleSearch('')
    setSearchResults([])
    pendingScrollVerse.current = v
    setSelected({ verse: v, text, sermon_ref_count: 0 })
  }

  const selectedBg = darkMode ? BIBLE_VERSE_SELECTED_BG_DARK : BIBLE_VERSE_SELECTED_BG

  const verseNumColor = darkMode ? 'rgba(255,255,255,0.5)' : '#525252'

  const verseNumStyle: React.CSSProperties = {
    fontFamily: BIBLE_SERIF_FONT,
    color: verseNumColor,
    fontSize: Math.max(13, fontSize * 0.88),
    fontWeight: 600,
    flexShrink: 0,
    minWidth: 32,
    lineHeight: 1.6,
  }

  const verseTextStyle: React.CSSProperties = {
    fontFamily: BIBLE_SERIF_FONT,
    color: t.text,
    fontSize,
    lineHeight: 1.85,
    flex: 1,
    minWidth: 0,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  }

  const renderBookAccordion = (books: typeof ot, sectionTitle: string) => (
    <>
      <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: sectionTitle === 'New Testament' ? 12 : 0 }}>{sectionTitle}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {books.map(b => {
          const isReading = book === b.name
          const isOpen = expandedBook === b.name
          return (
            <div key={b.name}>
              <button
                type="button"
                onClick={() => {
                  if (isOpen) {
                    setExpandedBook(null)
                  } else {
                    setExpandedBook(b.name)
                    setBook(b.name)
                    if (chapter > b.chapters) setChapter(1)
                  }
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: 'none',
                  background: isReading ? (darkMode ? 'rgba(255,255,255,0.07)' : t.bg3) : 'transparent',
                  color: t.text,
                  fontWeight: isReading ? 600 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {b.name}
              </button>
              {isOpen && (
                <div
                  style={{
                    padding: '6px 8px 10px 12px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))',
                    gap: 6,
                  }}
                >
                  {Array.from({ length: b.chapters }, (_, i) => i + 1).map(c => {
                    const active = isReading && chapter === c
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setBook(b.name)
                          setChapter(c)
                        }}
                        style={{
                          padding: '7px 0',
                          borderRadius: 8,
                          border: `1px solid ${active ? t.text2 : t.border}`,
                          background: active ? (darkMode ? 'rgba(255,255,255,0.1)' : t.bg2) : t.bg,
                          color: t.text2,
                          fontWeight: active ? 700 : 500,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  const bookList = (
    <div style={{ paddingRight: 0 }}>
      {renderBookAccordion(ot, 'Old Testament')}
      {renderBookAccordion(nt, 'New Testament')}
    </div>
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: t.bg,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: '12px 16px',
          borderBottom: `1px solid ${t.border}`,
          background: t.bg,
        }}
      >
        <input
          type="search"
          value={bibleSearch}
          onChange={e => setBibleSearch(e.target.value)}
          placeholder="Search words in the Bible (KJV)…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '11px 14px',
            borderRadius: 14,
            border: `1px solid ${t.border}`,
            background: t.bg2,
            color: t.text,
            fontSize: '0.9375em',
            outline: 'none',
          }}
        />
        {(searchLoading || searchResults.length > 0) && (
          <div
            style={{
              marginTop: 10,
              maxHeight: 220,
              overflowY: 'auto',
              borderRadius: 12,
              border: `1px solid ${t.border}`,
              background: t.bg2,
            }}
          >
            {searchLoading && <p style={{ padding: 12, color: t.text2, margin: 0 }}>Searching…</p>}
            {!searchLoading &&
              searchResults.map((r, i) => (
                <button
                  key={`${r.book}-${r.chapter}-${r.verse}-${i}`}
                  type="button"
                  onClick={() => goToResult(r.book, r.chapter, r.verse, r.text)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: 'none',
                    borderBottom: `1px solid ${t.border}`,
                    background: 'transparent',
                    cursor: 'pointer',
                    color: t.text,
                  }}
                >
                  <div style={{ fontWeight: 600, color: t.text2, fontSize: 13, marginBottom: 4 }}>
                    {r.book} {r.chapter}:{r.verse}
                  </div>
                  <div style={{ fontFamily: BIBLE_SERIF_FONT, fontSize: 14, color: t.text2, lineHeight: 1.5 }}>{r.text}</div>
                </button>
              ))}
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          overflow: 'hidden',
        }}
      >
        <aside
          style={{
            width: isMobile ? '100%' : 280,
            maxHeight: isMobile ? 320 : 'none',
            flexShrink: 0,
            borderRight: isMobile ? 'none' : `1px solid ${t.border}`,
            borderBottom: isMobile ? `1px solid ${t.border}` : 'none',
            overflowY: 'auto',
            padding: 12,
            background: t.bg2,
          }}
        >
          {bookList}
        </aside>

        <section
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            padding: '16px 20px 32px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {chapterLoading && <p style={{ color: t.text2 }}>Loading chapter…</p>}
          {!chapterLoading && verses.length === 0 && (
            <p style={{ color: t.text2 }}>
              No verses found for <strong>{book}</strong> chapter {chapter}. Check that book names in the database match this app (see <code style={{ fontSize: 12 }}>lib/bible-books.ts</code>).
            </p>
          )}
          {!chapterLoading &&
            verses.map(row => {
              const v = row.verse
              const count = row.sermon_ref_count ?? 0
              const isSel = selected?.verse === v
              return (
                <div
                  key={row.id ?? v}
                  ref={el => {
                    verseElRef.current[v] = el
                  }}
                  onClick={() => {
                    if (longPressFired.current) {
                      longPressFired.current = false
                      return
                    }
                    selectVerse(v, row.text, count)
                  }}
                  onPointerDown={() => onVersePointerDown(v, row.text, count)}
                  onPointerUp={onVersePointerUp}
                  onPointerLeave={onVersePointerUp}
                  style={{
                    padding: '14px 12px',
                    marginBottom: 6,
                    borderRadius: 12,
                    background: isSel ? selectedBg : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.12s ease',
                  }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexShrink: 0 }}>
                      {count > 0 && (
                        <button
                          type="button"
                          title="Brother Branham cited this verse"
                          onClick={e => {
                            e.stopPropagation()
                            openRefPanel(v, count)
                          }}
                          style={{
                            width: 10,
                            height: 10,
                            marginTop: 6,
                            borderRadius: 999,
                            border: 'none',
                            padding: 0,
                            background: t.text3,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span style={verseNumStyle}>{v}</span>
                    </div>
                    <p style={{ ...verseTextStyle, margin: 0 }}>{row.text}</p>
                  </div>
                  {isSel && (
                    <div
                      style={{
                        marginTop: 12,
                        marginLeft: 44,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(`${book} ${chapter}:${v} ${row.text}`)
                          showToast('Copied verse')
                        }}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 999,
                          border: `1px solid ${t.border}`,
                          background: t.bg3,
                          color: t.text,
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          if (!user) {
                            showToast('Sign in to save verses')
                            return
                          }
                          setSaveModal({
                            text: row.text,
                            title: `${book} ${chapter}:${v}`,
                            date: 'KJV',
                          })
                        }}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 999,
                          border: 'none',
                          background: '#4a6b52',
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Save to folder
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
        </section>
      </div>

      {refPanel && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 200,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
          onClick={() => setRefPanel(null)}
        >
          <div
            style={{
              width: 'min(420px, 100%)',
              maxHeight: 'min(80vh, 560px)',
              overflowY: 'auto',
              background: t.bg2,
              border: `1px solid ${t.border}`,
              borderRadius: 16,
              padding: 18,
              boxShadow: t.shadow,
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: t.text }}>Brother Branham &amp; this verse</h3>
            <p style={{ margin: '0 0 14px', color: t.text2, fontSize: 14, lineHeight: 1.5 }}>
              Brother Branham referenced <strong>{book} {chapter}:{refPanel.verse}</strong> in approximately{' '}
              <strong style={{ color: t.text }}>{refPanel.count}</strong> sermon
              {refPanel.count === 1 ? '' : 's'} (per <code>sermon_ref_count</code>).
            </p>
            {refLoading && <p style={{ color: t.text2 }}>Loading matching sermons…</p>}
            {!refLoading && refSermons.length === 0 && (
              <p style={{ color: t.text2, fontSize: 14 }}>
                No sermon text matches were found automatically. When your database links verses to sermons, they will appear here.
              </p>
            )}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {refSermons.map(s => (
                <li key={s.id} style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      showToast(`${s.title} · ${s.reference_code}`)
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: `1px solid ${t.border}`,
                      background: t.bg,
                      color: t.text,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: t.text2, marginTop: 4 }}>#{s.reference_code}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{s.date}</div>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setRefPanel(null)}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '10px',
                borderRadius: 12,
                border: `1px solid ${t.border}`,
                background: t.bg3,
                fontWeight: 600,
                cursor: 'pointer',
                color: t.text,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
