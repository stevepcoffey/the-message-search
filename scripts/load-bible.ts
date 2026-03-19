import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function loadBible() {
  console.log('Downloading KJV Bible...')
  
  const response = await fetch('https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json')
  const books = await response.json()
  
  console.log(`Found ${books.length} books. Loading verses...`)
  
  let totalVerses = 0

  for (let bookIndex = 0; bookIndex < books.length; bookIndex++) {
    const book = books[bookIndex]
    console.log(`Loading ${book.name}...`)
    
    for (let chapterIndex = 0; chapterIndex < book.chapters.length; chapterIndex++) {
      const chapter = book.chapters[chapterIndex]
      
      const verses = chapter.map((verseText: string, verseIndex: number) => ({
        book: book.name,
        book_number: bookIndex + 1,
        chapter: chapterIndex + 1,
        verse: verseIndex + 1,
        text: verseText,
        sermon_ref_count: 0
      }))

      const { error } = await supabase
        .from('bible_verses')
        .insert(verses)

      if (error) {
        console.error(`Error loading ${book.name} ${chapterIndex + 1}:`, error.message)
      } else {
        totalVerses += verses.length
      }
    }
  }

  console.log(`Done! Loaded ${totalVerses} verses.`)
}

loadBible().catch(console.error)