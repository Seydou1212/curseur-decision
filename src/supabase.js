import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && key)
export const supabase = supabaseConfigured ? createClient(url, key) : null

// Appel d'une fonction SQL, avec une erreur lisible en cas d'échec
export async function rpc(name, params = {}) {
  if (!supabase) throw new Error('Supabase non configuré (variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY).')
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error(error.message)
  return data
}
