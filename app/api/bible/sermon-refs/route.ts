import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

/** Best-effort sermon lookup by verse reference appearing in sermon full_text (service role). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const book = String(body.book || '').trim()
    const chapter = Number(body.chapter)
    const verse = Number(body.verse)
    if (!book || !Number.isFinite(chapter) || !Number.isFinite(verse)) {
      return NextResponse.json({ error: 'book, chapter, verse required' }, { status: 400 })
    }

    const patterns = [`%${book}%${chapter}:${verse}%`, `%${book}%${chapter}: ${verse}%`, `%${chapter}:${verse}%`]

    const seen = new Set<string>()
    const out: { id: string; title: string; date: string; reference_code: string }[] = []

    for (const pat of patterns) {
      if (out.length >= 25) break
      const { data, error } = await supabaseServer
        .from('sermons')
        .select('id, title, date, reference_code')
        .ilike('full_text', pat)
        .limit(25)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      for (const r of data || []) {
        const k = String(r.id)
        if (!seen.has(k)) {
          seen.add(k)
          out.push(r as any)
        }
      }
      if (out.length > 0 && pat !== patterns[2]) break
    }

    return NextResponse.json({ sermons: out })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
