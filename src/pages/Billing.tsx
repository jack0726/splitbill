import { useMemo } from 'react'
import type { Expense, Group, Profile } from '../lib/supabase'
import type { Settlement } from '../lib/supabase'
import { netBalances, simplifyDebts } from '../lib/balances'
import { CATEGORIES } from './GroupPage'

const COLORS = ['#1cc29f', '#3b82f6', '#f59e0b', '#e5484d', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#f97316']
const GREY = '#9aa0a6'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Billing({ expenses, settlements, group, members, name }: {
  expenses: Expense[]
  settlements: Settlement[]
  group: Group
  members: Profile[]
  name: (uid: string) => string
}) {
  const cur = group.currency
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

    const payerCats = members.map((m) => ({
      id: m.id,
      total: expenses.filter((e) => e.paid_by === m.id).reduce((sum, e) => sum + e.amount, 0),
      cells: cats.map((cat) => expenses.filter((e) => e.paid_by === m.id && (e.category ?? '') === cat.id).reduce((sum, e) => sum + e.amount, 0)),
    }))

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
    let running = 0
    const cumulative = days.map(([day, amount]) => ({ day, total: (running += amount) }))
    return { total, cats, people, payerCats, personCats, months, days, cumulative, span, top }
  }, [expenses, members])

  if (expenses.length === 0) return <p className="muted">No expenses yet, nothing to bill.</p>

  const maxDay = Math.max(...d.days.map((x) => x[1]), 0.01)
  const maxPayer = Math.max(...d.payerCats.map((p) => p.total), 0.01)
  const settlementBalances = netBalances(expenses, settlements)
  const transfers = simplifyDebts(settlementBalances)
  const maxCumulative = Math.max(...d.cumulative.map((p) => p.total), 0.01)
  const chartPoints = d.cumulative.map((p, i) => `${d.cumulative.length < 2 ? 8 : 8 + (i / (d.cumulative.length - 1)) * 84},${42 - (p.total / maxCumulative) * 34}`).join(' ')
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

      <h3>Who paid, and who used their share?</h3>
      <div className="card">
        <div className="billingExplain">
          <div className="billingLegend"><span className="billingDot paidDot" />Paid upfront</div>
          <div className="billingLegend"><span className="billingDot shareDot" />Their share of costs</div>
          <p className="small muted">The difference shows who covered more of the group bill. It is not an extra charge.</p>
        </div>
        {d.people.map((p) => {
          const diff = p.paid - p.share
          const scale = Math.max(p.paid, p.share, 0.01)
          return (
            <div key={p.id} className="personBars billingPerson">
              <div className="row small"><b>{name(p.id)}</b>
                <span className={`coveragePill ${diff >= 0 ? 'covered' : 'needsCover'}`}>
                  {diff > 0 ? `Covered ${fmt(diff)} for group` : diff < 0 ? `Used ${fmt(-diff)} more than paid` : 'Paid their share'}
                </span>
              </div>
              <div className="coverageTrack" aria-label={`${name(p.id)} paid ${fmt(p.paid)} and their share is ${fmt(p.share)} ${cur}`}>
                <div className="coverageBar paidBar" style={{ width: `${(p.paid / scale) * 100}%` }} />
                <div className="coverageBar shareBar" style={{ width: `${(p.share / scale) * 100}%` }} />
              </div>
              <div className="row small muted"><span>Paid <b className="billingAmount">{fmt(p.paid)}</b></span><span>Share <b className="billingAmount">{fmt(p.share)}</b></span></div>
            </div>
          )
        })}
      </div>

      <h3>Where each person’s share went</h3>
      <div className="card">
        <div className="small muted">Each bar is one member. Colors show their share by category; all bars use the same scale.</div>
        {d.personCats.some((p) => p.total > 0) ? <div className="memberChartScroll">
          <div className="memberChart" role="img" aria-label="Members' shares by category">
            {d.personCats.map((p) => (
              <div key={p.id} className="memberChartColumn" title={`${name(p.id)}: ${fmt(p.total)} ${cur}`}>
                <b className="memberChartTotal">{fmt(p.total)}</b>
                <div className="memberChartTrack">
                  {p.list.map((x) => <div key={x.id} title={`${x.label}: ${fmt(x.amount)} ${cur}`} style={{ height: `${(x.amount / Math.max(...d.personCats.map((person) => person.total), 0.01)) * 100}%`, background: x.color }} />)}
                </div>
                <span className="memberChartName">{name(p.id)}</span>
              </div>
            ))}
          </div>
        </div> : <div className="small muted">No expenses assigned to members.</div>}
        <div className="personCategoryList memberChartLegend">
          {d.cats.map((c) => <span key={c.id}><i className="swatch" style={{ background: c.color }} />{c.label}</span>)}
        </div>
      </div>

      <h3>Who paid for what?</h3>
      <div className="card">
        <div className="small muted">Each row is a payer; darker cells show where their payments went.</div>
        <div className="payerMatrixScroll"><table className="payerMatrix">
          <thead><tr><th>Payer</th>{d.cats.map((c) => <th key={c.id}>{c.label}</th>)}<th>Total</th></tr></thead>
          <tbody>{d.payerCats.map((p) => <tr key={p.id}>
            <th>{name(p.id)}</th>
            {p.cells.map((amount, i) => <td key={d.cats[i].id} style={{ background: amount ? `color-mix(in srgb, ${d.cats[i].color} ${Math.max(12, (amount / maxPayer) * 48)}%, var(--card))` : undefined }}>{amount ? fmt(amount) : '—'}</td>)}
            <td><b>{fmt(p.total)}</b></td>
          </tr>)}</tbody>
        </table></div>
      </div>

      <h3>Trip spending over time</h3>
      <div className="card">
        <div className="row small muted"><span>Running total</span><b>{fmt(d.total)} {cur}</b></div>
        <svg className="spendLineChart" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label="Cumulative trip spending over time">
          <path d="M 8 42 H 92" className="chartAxis" />
          <polyline points={chartPoints} className="spendLine" />
          {d.cumulative.map((p, i) => <circle key={p.day} cx={d.cumulative.length < 2 ? 8 : 8 + (i / (d.cumulative.length - 1)) * 84} cy={42 - (p.total / maxCumulative) * 34} r="1.4" className="spendPoint"><title>{p.day}: {fmt(p.total)} {cur} total</title></circle>)}
        </svg>
        <div className="row small muted"><span>{d.cumulative[0]?.day}</span><span>{d.cumulative.at(-1)?.day}</span></div>
      </div>

      <h3>Who still needs to pay?</h3>
      <div className="card">
        {transfers.length ? transfers.map((t, i) => <div className="settlementFlow" key={`${t.from}-${t.to}-${i}`}>
          <b>{name(t.from)}</b><span className="settlementArrow">→</span><b>{name(t.to)}</b><span className="amt">{fmt(t.amount)} {cur}</span>
        </div>) : <div className="small muted">Everyone is settled up.</div>}
        <div className="small muted">Suggested payments after recorded settlements.</div>
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
            <span><span>{CATEGORIES.find((c) => c.id === e.category)?.emoji ?? '•'} {e.description}</span><span className="small muted expenseMeta">{name(e.paid_by)} paid · {e.spent_on}</span></span>
            <span className="amt">{fmt(e.amount)} {cur}</span>
          </div>
        ))}
      </div>
    </>
  )
}
