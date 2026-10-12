import { useMemo } from 'react'
import type { Expense, Group, Profile } from '../lib/supabase'
import { CATEGORIES } from './GroupPage'

const COLORS = ['#1cc29f', '#3b82f6', '#f59e0b', '#e5484d', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#f97316']
const GREY = '#9aa0a6'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Billing({ expenses, group, members, name }: {
  expenses: Expense[]
  group: Group
  members: Profile[]
  name: (uid: string) => string
}) {
  const cur = group.currency
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const d = useMemo(() => {
    const total = expenses.reduce((a, e) => a + e.amount, 0)

    const byCat = new Map<string, number>()
    for (const e of expenses) byCat.set(e.category ?? '', (byCat.get(e.category ?? '') ?? 0) + e.amount)
    const cats = [...byCat.entries()]
      .map(([id, amount], i) => {
        const c = CATEGORIES.find((x) => x.id === id)
        return { id, label: c ? `${c.emoji} ${c.label}` : 'Uncategorized', amount, color: id ? COLORS[i % COLORS.length] : GREY }
      })
      .sort((a, b) => b.amount - a.amount)
    // stable colours by rank
    cats.forEach((c, i) => { if (c.id) c.color = COLORS[i % COLORS.length] })

    const people = members.map((m) => {
      const paid = expenses.filter((e) => e.paid_by === m.id).reduce((a, e) => a + e.amount, 0)
      const share = expenses.reduce((a, e) => a + (e.expense_splits.find((s) => s.user_id === m.id)?.share ?? 0), 0)
      return { id: m.id, paid, share }
    })

    const byDay = new Map<string, number>()
    for (const e of expenses) byDay.set(e.spent_on, (byDay.get(e.spent_on) ?? 0) + e.amount)
    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    let span = 0
    if (days.length) span = Math.round((Date.parse(days[days.length - 1][0]) - Date.parse(days[0][0])) / 86400000) + 1

    // each person's consumed share per category, stacked
    const colorOf = new Map(cats.map((c) => [c.id, c.color]))
    const labelOf = new Map(cats.map((c) => [c.id, c.label]))
    const personCats = members.map((m) => {
      const parts = new Map<string, number>()
      for (const e of expenses) {
        const sh = e.expense_splits.find((x) => x.user_id === m.id)?.share ?? 0
        if (sh > 0) parts.set(e.category ?? '', (parts.get(e.category ?? '') ?? 0) + sh)
      }
      const list = [...parts.entries()].map(([id, amount]) => ({ id, amount, color: colorOf.get(id) ?? GREY, label: labelOf.get(id) ?? 'Uncategorized' }))
        .sort((a, b) => b.amount - a.amount)
      return { id: m.id, list, total: list.reduce((a, x) => a + x.amount, 0) }
    })

    const byMonth = new Map<string, number>()
    for (const e of expenses) byMonth.set(e.spent_on.slice(0, 7), (byMonth.get(e.spent_on.slice(0, 7)) ?? 0) + e.amount)
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    const top = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5)
    return { total, cats, people, personCats, months, days, span, top }
  }, [expenses, members])

  if (expenses.length === 0) return <p className="muted">No expenses yet, nothing to bill.</p>

  const maxPerson = Math.max(...d.people.flatMap((p) => [p.paid, p.share]), 0.01)
  const maxDay = Math.max(...d.days.map((x) => x[1]), 0.01)
  // donut geometry: circumference of r=15.915 is 100, so dash lengths are percentages
  let offset = 25

  return (
    <>
      <div className="stats">
        <div className="card"><div className="muted small">Total spent</div><div className="statVal">{fmt(d.total)} {cur}</div></div>
        <div className="card"><div className="muted small">Per person</div><div className="statVal">{fmt(d.total / Math.max(members.length, 1))} {cur}</div></div>
        <div className="card"><div className="muted small">Per day{d.span ? ` (${d.span} days)` : ''}</div><div className="statVal">{fmt(d.span ? d.total / d.span : 0)} {cur}</div></div>
        <div className="card"><div className="muted small">Expenses</div><div className="statVal">{expenses.length}</div></div>
      </div>

      <h3>By category</h3>
      <div className="card">
        <div className="donutWrap">
          <svg viewBox="0 0 42 42" className="donut" role="img" aria-label="Spending by category">
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--border)" strokeWidth="6" />
            {d.cats.map((c) => {
              const pct = (c.amount / d.total) * 100
              const el = (
                <circle key={c.id} cx="21" cy="21" r="15.915" fill="none" stroke={c.color} strokeWidth="6"
                  strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset} />
              )
              offset -= pct
              return el
            })}
          </svg>
          <div className="legend">
            {d.cats.map((c) => (
              <div key={c.id} className="legendRow">
                <span className="swatch" style={{ background: c.color }} />
                <span className="grow">{c.label}</span>
                <span className="small muted">{((c.amount / d.total) * 100).toFixed(0)}%</span>
                <span className="amt">{fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h3>Paid vs. share</h3>
      <div className="card">
        <div className="small muted">Paid = what they put up front. Share = what they actually consumed.</div>
        {d.people.map((p) => {
          const diff = p.paid - p.share
          return (
            <div key={p.id} className="personBars">
              <div className="row small"><b>{name(p.id)}</b>
                <span className={diff >= 0 ? 'posText' : 'owe'}>{diff >= 0 ? '+' : ''}{fmt(diff)} {cur}</span>
              </div>
              <div className="barRow"><span className="barLbl small muted">Paid</span><div className="bar2" style={{ width: `${(p.paid / maxPerson) * 100}%`, background: '#3b82f6' }} /><span className="small">{fmt(p.paid)}</span></div>
              <div className="barRow"><span className="barLbl small muted">Share</span><div className="bar2" style={{ width: `${(p.share / maxPerson) * 100}%`, background: 'var(--green)' }} /><span className="small">{fmt(p.share)}</span></div>
            </div>
          )
        })}
      </div>

      <h3>Who spent on what</h3>
      <div className="card">
        <div className="small muted">Each person's share of the cost, split by category.</div>
        {d.personCats.map((p) => (
          <div key={p.id} className="personBars">
            <div className="row small"><b>{name(p.id)}</b><span>{fmt(p.total)} {cur}</span></div>
            <div className="stack">
              {p.list.map((x) => <div key={x.id} title={`${x.label}: ${fmt(x.amount)} ${cur}`} style={{ width: `${(x.amount / p.total) * 100}%`, background: x.color }} />)}
            </div>
            <div className="small muted">{p.list.map((x) => `${x.label} ${fmt(x.amount)}`).join(' · ')}</div>
          </div>
        ))}
      </div>

      <h3>Spending by day</h3>
      <div className="card">
        <div className="dayChart">
          {d.days.map(([day, amount]) => (
            <div key={day} className="dayCol" title={`${day}: ${fmt(amount)} ${cur}`}>
              <div className="dayBar" style={{ height: `${(amount / maxDay) * 100}%` }} />
              <div className="dayLbl">{MONTHS[Number(day.slice(5, 7)) - 1]}<br />{day.slice(8, 10)}</div>
            </div>
          ))}
        </div>
      </div>

      {d.months.length > 1 && (
        <>
          <h3>By month</h3>
          <div className="card">
            {d.months.map(([m, amount]) => (
              <div key={m} className="barRow">
                <span className="barLbl small muted" style={{ width: 64 }}>{MONTHS[Number(m.slice(5)) - 1]} {m.slice(2, 4)}</span>
                <div className="bar2" style={{ width: `${(amount / Math.max(...d.months.map((x) => x[1]))) * 60}%`, background: 'var(--green)' }} />
                <span className="small">{fmt(amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Biggest expenses</h3>
      <div className="card">
        {d.top.map((e) => (
          <div key={e.id} className="row small">
            <span>{CATEGORIES.find((c) => c.id === e.category)?.emoji ?? '•'} {e.description}</span>
            <span className="amt">{fmt(e.amount)} {cur}</span>
          </div>
        ))}
      </div>
    </>
  )
}
