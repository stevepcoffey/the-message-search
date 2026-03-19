import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { semanticSearch } from '@/lib/search'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Retrieve relevant passages
    const results = await semanticSearch(query, 'both')
    const context = results.slice(0, 8).map((r: any) => {
      if (r.source === 'message') {
        return `From "${r.title}" (${r.date}):\n${r.text}`
      } else {
        return `From ${r.book} ${r.chapter}:${r.verse} (KJV):\n${r.text}`
      }
    }).join('\n\n---\n\n')

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a research assistant for The Message, a body of sermons preached by William Marrion Branham between 1947 and 1965, and the King James Bible.

You ONLY answer using the passages provided below. You do not draw on any outside knowledge, commentary, theology, or sources. If the answer cannot be found in the provided passages, say so clearly.

When quoting, use exact words from the source. Always attribute quotes to the specific sermon title and date, or the Bible reference.

Do not refer to any person, event, doctrine, or teaching that is not represented in the provided passages.

SOURCE PASSAGES:
${context}`,
      messages: [{ role: 'user', content: query }]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    return NextResponse.json({
      response: responseText,
      sources: results.slice(0, 3)
    })

  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 })
  }
}