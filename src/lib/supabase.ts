import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export type Profile = { id: string; name: string }
export type Group = { id: string; name: string; currency: string; invite_code: string }
export type Expense = {
  id: string
  group_id: string
  description: string
  amount: number
  paid_by: string
  spent_on: string
  expense_splits: { user_id: string; share: number }[]
}
export type Settlement = {
  id: string
  group_id: string
  from_user: string
  to_user: string
  amount: number
  created_at: string
}
