import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, type Expense, type Group, type Profile, type Settlement } from '../lib/supabase'
import { fetchRate } from '../lib/fx'
import { netBalances, simplifyDebts, splitByWeights, splitEqually } from '../lib/balances'

type SplitMode = 'equal' | 'exact' | 'percent' | 'shares'

export default function GroupPage({ userId }: { userId: string }) {
  const { id } = useParams()
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [tab, setTab] = useState<'expenses' | 'balances'>('expenses')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const [g, m, e, s] = await Promise.all([
      supabase.from('groups').select('*').eq('id', id).single(),
      supabase.from('group_members').select('profiles(id,name)').eq('group_id', id),
      supabase
        .from('expenses')
        .select('*, expense_splits(user_id, share)')
        .eq('group_id', id)
        .order('spent_on', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('settlements').select('*').eq('group_id', id),
    ])
    setGroup(g.data as Group)
    setMembers(((m.data ?? []) as unknown as { profiles: Profile }[]).map((r) => r.profiles))
    setExpenses((e.data as Expense[]) ?? [])
    setSettlements((s.data as Settlement[]) ?? [])
  }, [id])

  useEffect(() => {
    load()
    const ch = supabase
      .channel(`group-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, load])

  const name = (uid: string) => (uid === userId ? 'You' : members.find((m) => m.id === uid)?.name ?? '?')
  const bal = useMemo(() => netBalances(expenses, settlements), [expenses, settlements])
  const transfers = useMemo(() => simplifyDebts(bal), [bal])
  const money = (n: number) => `${n.toFixed(2)} ${group?.currency ?? ''}`
  const mine = (bal[userId] ?? 0) / 100

  if (!group) return <p className="center muted">Loading…</p>
  const link = `${location.origin}/join/${group.invite_code}`

  async function settle(from: string, to: string, amount: number) {
    await supabase.from('settlements').insert({ group_id: id, from_user: from, to_user: to, amount })
    load()
  }
  async function remove(eid: string) {
    if (confirm('Delete this expense?')) {
      await supabase.from('expenses').delete().eq('id', eid)
      load()
    }
  }

  return (
    <>
      <h2>{group.name}</h2>
      <div className={`card summary ${mine >= 0 ? 'pos' : 'neg'}`}>
        {Math.abs(mine) < 0.005 ? 'You are settled up' : mine > 0 ? `You are owed ${money(mine)}` : `You owe ${money(-mine)}`}
      </div>

      <div className="card">
        <small className="muted">Invite friends: share this link or code <b>{group.invite_code}</b></small>
        <div className="row">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
        </div>
        <small className="muted">Members: {members.map((m) => m.name).join(', ')}</small>
      </div>

      <div className="tabs">
        <button className={tab === 'expenses' ? 'on' : ''} onClick={() => setTab('expenses')}>Expenses</button>
        <button className={tab === 'balances' ? 'on' : ''} onClick={() => setTab('balances')}>Balances</button>
      </div>

      {tab === 'expenses' && (
        <>
          <button className="fab" onClick={() => setAdding(true)}>+ Add expense</button>
          {expenses.length === 0 && <p className="muted">No expenses yet.</p>}
          {expenses.map((e) => {
            const myShare = e.expense_splits.find((s) => s.user_id === userId)?.share ?? 0
            return (
              <div key={e.id} className="card row">
                <div>
                  <strong>{e.description}</strong>
                  <div className="muted small">
                    {name(e.paid_by)} paid {money(e.amount)} · {e.spent_on}
                    {e.local_amount != null && e.local_currency !== group.currency && (
                      <> · {e.local_amount.toFixed(2)} {e.local_currency} @ {e.fx_rate}</>
                    )}
                  </div>
                </div>
                <div className="right">
                  <div className="small muted">your share</div>
                  <div>{money(myShare)}</div>
                  <button className="link danger" onClick={() => remove(e.id)}>delete</button>
                </div>
              </div>
            )
          })}
        </>
      )}

      {tab === 'balances' && (
        <>
          <h3>Who owes who</h3>
          {transfers.length === 0 && <p className="muted">Everyone is settled up 🎉</p>}
          {transfers.map((t, i) => (
            <div key={i} className="card row">
              <span>{name(t.from)} → {name(t.to)}: <b>{money(t.amount)}</b></span>
              <button onClick={() => settle(t.from, t.to, t.amount)}>Settle</button>
            </div>
          ))}
          <h3>Net balances</h3>
          {members.map((m) => {
            const b = (bal[m.id] ?? 0) / 100
            return (
              <div key={m.id} className="row small">
                <span>{name(m.id)}</span>
                <span className={b >= 0 ? 'posText' : 'negText'}>{b >= 0 ? '+' : ''}{money(b)}</span>
              </div>
            )
          })}
          {settlements.length > 0 && (
            <>
              <h3>Payments made</h3>
              {settlements.map((s) => (
                <div key={s.id} className="small muted">
                  {name(s.from_user)} paid {name(s.to_user)} {money(s.amount)} · {s.created_at.slice(0, 10)}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {adding && (
        <AddExpense
          group={group}
          members={members}
          userId={userId}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load() }}
        />
      )}
    </>
  )
}

function AddExpense(p: {
  group: Group
  members: Profile[]
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [paidBy, setPaidBy] = useState(p.userId)
  const [mode, setMode] = useState<SplitMode>('equal')
  const [included, setIncluded] = useState<Record<string, boolean>>(Object.fromEntries(p.members.map((m) => [m.id, true])))
  const [vals, setVals] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  const settleCur = p.group.currency
  const hasFx = p.group.local_currency !== settleCur
  // 'local' = amount typed in the trip's local currency and converted via FX; 'settlement' = no conversion
  const [entry, setEntry] = useState<'local' | 'settlement'>(hasFx ? 'local' : 'settlement')
  const [liveRate, setLiveRate] = useState<number | null>(null)
  const [manualRate, setManualRate] = useState('')
  const [override, setOverride] = useState(false)
  const [rateLoading, setRateLoading] = useState(false)
  const foreign = hasFx && entry === 'local'
  const entryCur = foreign ? p.group.local_currency : settleCur

  useEffect(() => {
    if (!foreign) return
    let live = true
    setRateLoading(true)
    fetchRate(p.group.local_currency, settleCur).then((r) => {
      if (!live) return
      setLiveRate(r)
      setRateLoading(false)
    })
    return () => { live = false }
  }, [foreign, p.group.local_currency, settleCur])

  const total = parseFloat(amount) || 0
  // manual entry is opt-in, but forced when no live rate could be fetched
  const manual = override || (!rateLoading && liveRate === null)
  const fxRate = manual ? parseFloat(manualRate) || 0 : liveRate ?? 0
  const settleTotal = foreign ? Math.round(total * fxRate * 100) / 100 : total

  function buildSplits() {
    const ids = p.members.filter((m) => included[m.id]).map((m) => m.id)
    if (ids.length === 0) throw new Error('Select at least one person')
    if (mode === 'equal') return splitEqually(total, ids)
    const nums = Object.fromEntries(ids.map((i) => [i, parseFloat(vals[i]) || 0]))
    if (mode === 'exact') {
      const sum = ids.reduce((a, i) => a + nums[i], 0)
      if (Math.abs(sum - total) > 0.005) throw new Error(`Amounts add up to ${sum.toFixed(2)}, expected ${total.toFixed(2)} ${entryCur}`)
      return ids.map((i) => ({ user_id: i, share: nums[i] }))
    }
    if (mode === 'percent') {
      const sum = ids.reduce((a, i) => a + nums[i], 0)
      if (Math.abs(sum - 100) > 0.005) throw new Error(`Percentages add up to ${sum}, expected 100`)
    }
    if (ids.every((i) => nums[i] <= 0)) throw new Error('Enter at least one value')
    return splitByWeights(total, nums)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      if (total <= 0) throw new Error('Enter an amount')
      if (foreign && fxRate <= 0) throw new Error('Enter an FX rate')
      if (settleTotal <= 0) throw new Error('Converted amount is too small')
      let splits = buildSplits()
      // splits are entered in the entry currency; store them in the settlement currency
      if (foreign) {
        splits = splitByWeights(settleTotal, Object.fromEntries(splits.map((s) => [s.user_id, s.share])))
      }
      const { data, error } = await supabase
        .from('expenses')
        .insert({
          group_id: p.group.id,
          description: desc,
          amount: settleTotal,
          paid_by: paidBy,
          spent_on: date,
          local_amount: total,
          local_currency: entryCur,
          fx_rate: foreign ? fxRate : 1,
        })
        .select('id')
        .single()
      if (error) throw error
      const { error: e2 } = await supabase
        .from('expense_splits')
        .insert(splits.map((s) => ({ ...s, expense_id: data.id })))
      if (e2) {
        await supabase.from('expenses').delete().eq('id', data.id)
        throw e2
      }
      p.onSaved()
    } catch (x) {
      setErr((x as Error).message)
    }
  }

  const unit = mode === 'percent' ? '%' : mode === 'shares' ? 'shares' : ''

  return (
    <div className="modal" onClick={p.onClose}>
      <form className="card sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>Add expense</h3>
        <input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} required />
        {hasFx && (
          <label>Currency
            <select value={entry} onChange={(e) => setEntry(e.target.value as 'local' | 'settlement')}>
              <option value="local">Local – {p.group.local_currency} (convert to {settleCur})</option>
              <option value="settlement">Settlement – {settleCur}</option>
            </select>
          </label>
        )}
        <input type="number" step="0.01" min="0" inputMode="decimal" placeholder={`Amount (${entryCur})`} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        {foreign && (
          <div>
            <label>FX rate (1 {entryCur} = ? {settleCur})
              <input
                type="number" step="any" min="0" inputMode="decimal"
                placeholder={rateLoading ? 'Fetching rate…' : 'Enter rate'}
                value={manual ? manualRate : liveRate ?? ''}
                readOnly={!manual}
                onChange={(e) => setManualRate(e.target.value)}
                required
              />
            </label>
            {liveRate !== null && (
              <label className="check">
                <input
                  type="checkbox" checked={override}
                  onChange={(e) => {
                    setOverride(e.target.checked)
                    if (e.target.checked && !manualRate) setManualRate(String(liveRate))
                  }}
                />
                Override rate
              </label>
            )}
            {!rateLoading && liveRate === null && <small className="muted">Live rate unavailable, enter it manually.</small>}
            {settleTotal > 0 && <small className="muted">≈ {settleTotal.toFixed(2)} {settleCur}</small>}
          </div>
        )}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <label>Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {p.members.map((m) => <option key={m.id} value={m.id}>{m.id === p.userId ? 'You' : m.name}</option>)}
          </select>
        </label>
        <label>Split
          <select value={mode} onChange={(e) => setMode(e.target.value as SplitMode)}>
            <option value="equal">Equally</option>
            <option value="exact">Exact amounts</option>
            <option value="percent">Percentages</option>
            <option value="shares">Shares</option>
          </select>
        </label>
        {p.members.map((m) => (
          <div key={m.id} className="row">
            <label className="check">
              <input type="checkbox" checked={!!included[m.id]} onChange={(e) => setIncluded({ ...included, [m.id]: e.target.checked })} />
              {m.id === p.userId ? 'You' : m.name}
            </label>
            {mode !== 'equal' && included[m.id] && (
              <span className="inline">
                <input className="short" type="number" step="0.01" min="0" inputMode="decimal" value={vals[m.id] ?? ''} onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} />
                {unit}
              </span>
            )}
          </div>
        ))}
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button type="button" className="link" onClick={p.onClose}>Cancel</button>
          <button>Save</button>
        </div>
      </form>
    </div>
  )
}
