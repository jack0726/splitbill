import type { Expense, Settlement } from './supabase'

const cents = (n: number) => Math.round(n * 100)

/** Net balance per user in cents: positive = is owed money, negative = owes. */
export function netBalances(expenses: Expense[], settlements: Settlement[]) {
  const bal: Record<string, number> = {}
  const add = (u: string, c: number) => (bal[u] = (bal[u] ?? 0) + c)
  for (const e of expenses) {
    add(e.paid_by, cents(e.amount))
    for (const s of e.expense_splits) add(s.user_id, -cents(s.share))
  }
  for (const s of settlements) {
    add(s.from_user, cents(s.amount))
    add(s.to_user, -cents(s.amount))
  }
  return bal
}

export type Transfer = { from: string; to: string; amount: number }

/** Greedy debt simplification: minimises the number of payments. */
export function simplifyDebts(bal: Record<string, number>): Transfer[] {
  const debtors = Object.entries(bal).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }))
  const creditors = Object.entries(bal).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }))
  debtors.sort((a, b) => b.v - a.v)
  creditors.sort((a, b) => b.v - a.v)
  const out: Transfer[] = []
  let i = 0, j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].v, creditors[j].v)
    if (pay > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: pay / 100 })
    debtors[i].v -= pay
    creditors[j].v -= pay
    if (debtors[i].v === 0) i++
    if (creditors[j].v === 0) j++
  }
  return out
}

/** Split `total` across users so shares sum exactly to total (remainder cents go to first users). */
export function splitEqually(total: number, userIds: string[]) {
  const t = cents(total)
  const base = Math.floor(t / userIds.length)
  let rem = t - base * userIds.length
  return userIds.map((user_id) => ({ user_id, share: (base + (rem-- > 0 ? 1 : 0)) / 100 }))
}

/** Split proportionally by weights (percentages or shares), exact to the cent. */
export function splitByWeights(total: number, weights: Record<string, number>) {
  const ids = Object.keys(weights).filter((id) => weights[id] > 0)
  const sum = ids.reduce((a, id) => a + weights[id], 0)
  const t = cents(total)
  const raw = ids.map((id) => ({ id, c: Math.floor((t * weights[id]) / sum) }))
  let rem = t - raw.reduce((a, r) => a + r.c, 0)
  for (const r of raw) if (rem-- > 0) r.c++
  return raw.map((r) => ({ user_id: r.id, share: r.c / 100 }))
}
