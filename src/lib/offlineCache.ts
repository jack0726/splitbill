import { supabase, type Expense, type Group, type Profile, type Settlement } from './supabase'

type CachedMember = { group_id: string; profiles: Profile }
type GroupsCache = { groups: Group[]; expenses: Expense[]; settlements: Settlement[]; members: CachedMember[] }

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

export async function refreshOfflineCache(userId: string) {
  if (!navigator.onLine) return
  const [groups, expenses, settlements, members] = await Promise.all([
    allRows<Group>((from, to) => supabase.from('groups').select('*').order('created_at', { ascending: false }).range(from, to)),
    allRows<Expense>((from, to) => supabase.from('expenses').select('*, expense_splits(user_id, share)').range(from, to)),
    allRows<Settlement>((from, to) => supabase.from('settlements').select('*').range(from, to)),
    allRows<CachedMember>((from, to) => supabase.from('group_members').select('group_id, profiles(id,name,avatar_key,paynow_mobile)').range(from, to)),
  ])
  if (!navigator.onLine) return
  try {
    localStorage.setItem(`splitbill-groups-cache:${userId}`, JSON.stringify({ groups, expenses, settlements, members }))
  } catch { /* Keep the previous cache if the device has no storage space. */ }
}
