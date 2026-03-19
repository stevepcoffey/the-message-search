import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    // Simple keyword search across sermon chunks
    const words = query.split(' ').slice(0, 3).join(' | ')
    
    const { data: sermonResults } = await supabase
      .from('sermon_chunks')
      .select('text, sermon_id, sermons(title, date, location)')
      .textSearch('text', words)
      .limit(6)

    const { data: bibleResults } = await supabase
      .from('bible_verses')
      .select('book, chapter, verse, text')
      .textSearch('text', words)
      .limit(4)

    const context = [
      ...(sermonResults || []).map((r: any) =>
        `From "${r.sermons?.title}" (${r.sermons?.date}):\n${r.text}`
      ),
      ...(bibleResults || []).map((r: any) =>
        `From ${r.book} ${r.chapter}:${r.verse} (KJV):\n${r.text}`
      )
    ].join('\n\n---\n\n')

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a research assistant for The Message, a body of sermons preached by William Marrion Branham between 1947 and 1965, and the King James Bible.

You ONLY answer using the passages provided below. Do not draw on outside knowledge. If the answer is not in the passages, say so.

Always attribute quotes to the specific sermon title and date, or Bible reference.

SOURCE PASSAGES:
${context}`,
      messages: [{ role: 'user', content: query }]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    return NextResponse.json({
      response: responseText,
      sources: [
        ...(sermonResults || []).slice(0, 2).map((r: any) => ({
          title: r.sermons?.title,
          date: r.sermons?.date,
          source: 'message'
        })),
        ...(bibleResults || []).slice(0, 1).map((r: any) => ({
          title: `${r.book} ${r.chapter}:${r.verse}`,
          source: 'bible'
        }))
      ]
    })

  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
```

Save with **Command + S**. Then in Terminal:
```
cd ~/Desktop/the-message-search && git add . && git commit -m "Fix chat to use text search" && git push