import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { supabaseServer } from '@/lib/supabase-server'

type SearchHistoryRow = {
  id?: number
  query: string
  mode: 'chat' | 'search'
  user_id: string | null
  result_count: number | null
  response_time_ms: number | null
  created_at: string
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function timeAgo(ts: string): string {
  const diff = Math.max(1, Date.now() - new Date(ts).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function classifyTopic(query: string): string {
  const q = query.toLowerCase()
  if (/(faith|believ|trust)/.test(q)) return 'Faith'
  if (/(heal|sick|disease|miracle)/.test(q)) return 'Healing'
  if (/(holy ghost|holy spirit|spirit of god)/.test(q)) return 'Holy Ghost'
  if (/(bapt|water baptism|jesus name)/.test(q)) return 'Baptism'
  if (/(grace|mercy|salvation|redeem)/.test(q)) return 'Salvation/Grace'
  if (/(church age|laodicea|ephesus|revelation)/.test(q)) return 'Seven Church Ages'
  if (/(repent|sin|forgive|forgiveness)/.test(q)) return 'Repentance'
  if (/(love|charity)/.test(q)) return 'Love'
  if (/(prayer|pray|intercession)/.test(q)) return 'Prayer'
  if (/(bride|rapture|second coming|coming)/.test(q)) return 'Bride/Rapture'
  return 'Other'
}

export default async function AdminPage() {
  const cookieStore = await cookies()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!anon) redirect('/')

  const authClient = createServerClient(supabaseUrl, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set() {},
      remove() {},
    },
  })
  const { data: authData } = await authClient.auth.getUser()
  const email = authData?.user?.email || ''
  if (email.toLowerCase() !== 'stevepcoffey@gmail.com') redirect('/')

  const now = new Date()
  const todayStart = startOfDay(now)
  const weekStart = new Date(todayStart)
  weekStart.setDate(todayStart.getDate() - 6)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const chartStart = new Date(todayStart)
  chartStart.setDate(todayStart.getDate() - 29)

  const { data: rowsData } = await supabaseServer
    .from('search_history')
    .select('query,mode,user_id,result_count,response_time_ms,created_at')
    .gte('created_at', chartStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(5000)

  const rows = ((rowsData || []) as SearchHistoryRow[]).filter(r => !!r.created_at)
  const totalToday = rows.filter(r => new Date(r.created_at) >= todayStart).length
  const totalWeek = rows.filter(r => new Date(r.created_at) >= weekStart).length
  const totalMonth = rows.filter(r => new Date(r.created_at) >= monthStart).length
  const uniqueUsers = new Set(rows.filter(r => r.user_id).map(r => r.user_id as string)).size

  const queryCounts = new Map<string, number>()
  for (const r of rows) {
    const q = (r.query || '').trim()
    if (!q) continue
    queryCounts.set(q, (queryCounts.get(q) || 0) + 1)
  }
  const top20 = [...queryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)

  const byDayMap = new Map<string, number>()
  for (let i = 0; i < 30; i++) {
    const d = new Date(chartStart)
    d.setDate(chartStart.getDate() + i)
    byDayMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (const r of rows) {
    const key = new Date(r.created_at).toISOString().slice(0, 10)
    if (!byDayMap.has(key)) continue
    byDayMap.set(key, (byDayMap.get(key) || 0) + 1)
  }
  const byDay = [...byDayMap.entries()].map(([day, count]) => ({ day, count }))
  const maxDayCount = Math.max(1, ...byDay.map(d => d.count))

  const modeChat = rows.filter(r => r.mode === 'chat').length
  const modeSearch = rows.filter(r => r.mode === 'search').length
  const modeTotal = Math.max(1, modeChat + modeSearch)

  const topicMap = new Map<string, number>()
  for (const r of rows) {
    const topic = classifyTopic(r.query || '')
    topicMap.set(topic, (topicMap.get(topic) || 0) + 1)
  }
  const topTopics = [...topicMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)

  const recent50 = rows.slice(0, 50)
  const recentUserIds = [...new Set(recent50.map(r => r.user_id).filter(Boolean) as string[])]
  const emailMap = new Map<string, string>()
  for (const uid of recentUserIds.slice(0, 50)) {
    try {
      const { data } = await supabaseServer.auth.admin.getUserById(uid)
      emailMap.set(uid, data?.user?.email || uid)
    } catch {
      emailMap.set(uid, uid)
    }
  }

  const cardStyle = {
    background: '#E7E7E3',
    border: '1px solid rgba(0,0,0,0.13)',
    borderRadius: 14,
    padding: 14,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F3F3F0', color: '#000', padding: 16, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', margin: '0 0 10px' }}>Admin Dashboard</h1>
        <p style={{ margin: '0 0 14px', color: '#353539' }}>Search analytics and usage activity.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10, marginBottom: 12 }}>
          <div style={cardStyle}><div style={{ color: '#66666E', fontSize: 12 }}>Total searches today</div><div style={{ fontWeight: 700, fontSize: 24 }}>{totalToday}</div></div>
          <div style={cardStyle}><div style={{ color: '#66666E', fontSize: 12 }}>Total searches this week</div><div style={{ fontWeight: 700, fontSize: 24 }}>{totalWeek}</div></div>
          <div style={cardStyle}><div style={{ color: '#66666E', fontSize: 12 }}>Total searches this month</div><div style={{ fontWeight: 700, fontSize: 24 }}>{totalMonth}</div></div>
          <div style={cardStyle}><div style={{ color: '#66666E', fontSize: 12 }}>Total unique users</div><div style={{ fontWeight: 700, fontSize: 24 }}>{uniqueUsers}</div></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) minmax(320px,2fr)', gap: 12, marginBottom: 12 }}>
          <div style={cardStyle}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Top 20 searches</h2>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {top20.map(([q, c]) => (
                <li key={q} style={{ marginBottom: 6 }}>
                  <span>{q}</span>
                  <span style={{ marginLeft: 8, color: '#66666E' }}>({c})</span>
                </li>
              ))}
            </ol>
          </div>
          <div style={cardStyle}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Searches by day (30 days)</h2>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 180 }}>
              {byDay.map(d => (
                <div key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, minWidth: 4, background: '#86CD82', borderRadius: '4px 4px 0 0', height: `${Math.max(3, (d.count / maxDayCount) * 100)}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) minmax(320px,1fr)', gap: 12, marginBottom: 12 }}>
          <div style={cardStyle}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Top topics</h2>
            {topTopics.map(([topic, count]) => (
              <div key={topic} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                <span>{topic}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
          <div style={cardStyle}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Usage by mode</h2>
            <div style={{ marginBottom: 8, color: '#353539' }}>Chat: {modeChat} · Search: {modeSearch}</div>
            <div style={{ height: 20, borderRadius: 999, overflow: 'hidden', background: '#D6D6D1', border: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ width: `${(modeChat / modeTotal) * 100}%`, height: '100%', background: '#86CD82', float: 'left' }} />
              <div style={{ width: `${(modeSearch / modeTotal) * 100}%`, height: '100%', background: '#72A276', float: 'left' }} />
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Recent searches (last 50)</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {recent50.map((r, idx) => (
              <div key={`${r.created_at}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: '#F3F3F0', border: '1px solid rgba(0,0,0,0.08)' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.query}</div>
                <span style={{ fontSize: 11, borderRadius: 999, padding: '4px 9px', background: r.mode === 'chat' ? '#86CD82' : '#D6D6D1', color: '#17351f', fontWeight: 700 }}>{r.mode}</span>
                <span style={{ color: '#66666E', fontSize: 12, minWidth: 170, textAlign: 'right' }}>
                  {timeAgo(r.created_at)} · {r.user_id ? (emailMap.get(r.user_id) || r.user_id) : 'anonymous'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
