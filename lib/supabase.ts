import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

// Avoid build-time crashes when public env vars are not present during prerender.
const fallbackUrl = 'https://placeholder.supabase.co'
const fallbackKey = 'placeholder-anon-key'
const resolvedUrl = supabaseUrl || fallbackUrl
const resolvedKey = supabaseKey || fallbackKey

export const supabase = createClient(resolvedUrl, resolvedKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
