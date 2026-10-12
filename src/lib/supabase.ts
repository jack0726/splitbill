import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export type Profile = { id: string; name: string }
export type Group = { id: string; name: string; currency: string; local_currency: string; invite_code: string }
export type Expense = {
  id: string
  group_id: string
  description: string
  amount: number
  paid_by: string
  spent_on: string
  created_at: string
  local_amount: number | null
  local_currency: string | null
  fx_rate: number | null
  category: string | null
  receipt_key: string | null
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
export type AuditEntry = {
  id: string
  actor_id: string | null
  action: 'created' | 'updated' | 'deleted' | 'restored'
  entity: 'expense' | 'settlement'
  entity_id: string
  summary: string
  details: Details | null
  old_details: Details | null
  created_at: string
}
export type Details = {
  description?: string
  amount: number
  paid_by?: string
  spent_on?: string
  local_amount?: number | null
  local_currency?: string | null
  fx_rate?: number | null
  category?: string | null
  receipt_key?: string | null
  splits?: { user_id: string; share: number }[]
  from_user?: string
  to_user?: string
}
