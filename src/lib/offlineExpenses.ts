import { supabase, type Expense } from './supabase'

type ExpenseFields = Omit<Expense, 'id' | 'group_id' | 'created_at' | 'expense_splits'>
export type PendingExpense = {
  id: string
  groupId: string
  userId: string
  fields: ExpenseFields
  splits: { user_id: string; share: number }[]
  savedAt: string
}

const key = 'splitbill-pending-expenses'

function read(): PendingExpense[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value as PendingExpense[] : []
  } catch {
    return []
  }
}

function write(items: PendingExpense[]) {
  localStorage.setItem(key, JSON.stringify(items))
  window.dispatchEvent(new Event('splitbill-pending-expenses-changed'))
}

export function pendingExpenses(groupId: string, userId: string): PendingExpense[] {
  return read().filter((item) => item.groupId === groupId && item.userId === userId)
}

export function subscribePending(callback: () => void) {
  window.addEventListener('splitbill-pending-expenses-changed', callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener('splitbill-pending-expenses-changed', callback)
    window.removeEventListener('storage', callback)
  }
}

export async function queueExpense(item: PendingExpense) {
  write([...read().filter((existing) => existing.id !== item.id), item])
}

export async function syncPendingExpenses(userId: string, groupId?: string) {
  if (!navigator.onLine) return
  const items = read()
  for (const item of items) {
    if (item.userId !== userId || (groupId && item.groupId !== groupId)) continue
    const { error } = await supabase.rpc('save_expense', {
      eid: item.id,
      gid: item.groupId,
      fields: item.fields,
      splits: item.splits,
    })
    if (error) break
    write(read().filter((existing) => existing.id !== item.id))
  }
}

export function asPendingExpense(item: PendingExpense): Expense {
  return {
    ...item.fields,
    id: item.id,
    group_id: item.groupId,
    created_at: item.savedAt,
    expense_splits: item.splits,
  }
}
