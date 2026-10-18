import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, type Expense, type Group, type Profile, type Settlement } from '../lib/supabase'
import { netBalances, simplifyDebts } from '../lib/balances'
import { hue } from './GroupPage'
import GroupIconPicker, { GroupIcon, GROUP_COLORS } from '../components/GroupIconPicker'

type Summary = { mine: number; lines: { text: string; amount: number; owed: boolean }[] }

export default function Groups({ userId }: { userId: string }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [sums, setSums] = useState<Record<string, Summary>>({})
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('Users')
  const [iconColor, setIconColor] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [currency, setCurrency] = useState('SGD')
  const [localCurrency, setLocalCurrency] = useState('SGD')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const nav = useNavigate()

  async function load() {
    const cacheKey = `splitbill-groups-cache:${userId}`
    type Cache = { groups?: Group[]; expenses?: Expense[]; settlements?: Settlement[]; members?: { group_id: string; profiles: Profile }[] }
    let cache: Cache = {}
    try { cache = JSON.parse(localStorage.getItem(cacheKey) ?? '{}') } catch { /* ignore malformed cache */ }
    if (cache.groups) setGroups(cache.groups)
    let remoteGroups: Group[] | null = null
    let remoteExpenses: Expense[] | null = null
    let remoteSettlements: Settlement[] | null = null
    let remoteMembers: { group_id: string; profiles: Profile }[] | null = null
    if (navigator.onLine) {
      const [g, e, st, m] = await Promise.all([
        supabase.from('groups').select('*').order('created_at', { ascending: false }),
        supabase.from('expenses').select('*, expense_splits(user_id, share)'),
        supabase.from('settlements').select('*'),
        supabase.from('group_members').select('group_id, profiles(id,name,avatar_key,paynow_mobile)'),
      ])
      remoteGroups = g.data as Group[] | null
      remoteExpenses = e.data as Expense[] | null
      remoteSettlements = st.data as Settlement[] | null
      remoteMembers = m.data as unknown as { group_id: string; profiles: Profile }[] | null
    }
    const gs = remoteGroups ?? cache.groups ?? []
    const exp = remoteExpenses ?? cache.expenses ?? []
    const set = remoteSettlements ?? cache.settlements ?? []
    const mem = remoteMembers ?? cache.members ?? []
    setGroups(gs)
    const out: Record<string, Summary> = {}
    for (const g of gs) {
      const bal = netBalances(exp.filter((x) => x.group_id === g.id), set.filter((x) => x.group_id === g.id))
      const nm = (id: string) => mem.find((r) => r.group_id === g.id && r.profiles.id === id)?.profiles.name ?? '?'
      const lines = simplifyDebts(bal).flatMap((t) =>
        t.to === userId ? [{ text: `${nm(t.from)} owes you`, amount: t.amount, owed: true }]
        : t.from === userId ? [{ text: `You owe ${nm(t.to)}`, amount: t.amount, owed: false }] : [])
      out[g.id] = { mine: (bal[userId] ?? 0) / 100, lines }
    }
    setSums(out)
  }
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('groups').insert({
      name, icon, icon_color: iconColor, description: description.trim() || null, start_date: startDate || null, end_date: endDate || null,
      currency, local_currency: localCurrency,
    }).select().single()
    if (error) return setErr(error.message)
    nav(`/g/${data.id}`)
  }

  async function join(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.rpc('join_group', { code: code.trim() })
    if (error) return setErr(error.message)
    nav(`/g/${data}`)
  }

  // overall balance per settlement currency
  const totals: Record<string, number> = {}
  for (const g of groups) totals[g.currency] = (totals[g.currency] ?? 0) + (sums[g.id]?.mine ?? 0)
  const parts = Object.entries(totals).filter(([, v]) => Math.abs(v) >= 0.005)
  const overall = parts.length === 0 ? 'You are all settled up'
    : 'Overall, ' + parts.map(([c, v]) => `you ${v > 0 ? 'are owed' : 'owe'} ${Math.abs(v).toFixed(2)} ${c}`).join(', ')

  return (
    <>
      <h2 className="overall">{overall}</h2>
      {groups.length === 0 && <p className="muted">No groups yet. Create one below.</p>}
      {groups.length > 0 && <div className="month">Showing all groups</div>}
      {groups.map((g) => {
        const s = sums[g.id]
        const mine = s?.mine ?? 0
        const settled = Math.abs(mine) < 0.005
        return (
          <Link key={g.id} to={`/g/${g.id}`} className="exp">
            <div className="tile big" style={{ background: g.icon_color || `hsl(${hue(g.name)} 60% 88%)`, color: GROUP_COLORS.find((c) => c.background === g.icon_color)?.foreground || `hsl(${hue(g.name)} 45% 30%)` }}>
              <GroupIcon name={g.icon} size={30} />
            </div>
            <div className="grow">
              <div className="title">{g.name}</div>
              {settled
                ? <div className="muted small">settled up</div>
                : <div className={mine > 0 ? 'posText' : 'owe'}><b>{mine > 0 ? 'you are owed' : 'you owe'} {Math.abs(mine).toFixed(2)} {g.currency}</b></div>}
              {s?.lines.map((l, i) => (
                <div key={i} className="muted small">{l.text} <span className={l.owed ? 'posText' : 'owe'}>{l.amount.toFixed(2)} {g.currency}</span></div>
              ))}
            </div>
          </Link>
        )
      })}

      <form className="card" onSubmit={create}>
        <h3>New group</h3>
        <input placeholder="Group name (e.g. Trip to Bergen)" value={name} onChange={(e) => setName(e.target.value)} required />
        <GroupIconPicker value={icon} onChange={setIcon} color={iconColor} onColorChange={setIconColor} />
        <details>
          <summary>Options</summary>
          <label>Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </label>
          <label>Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>End date
            <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label>Settlement currency
            <input placeholder="SGD" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} minLength={3} required />
          </label>
          <label>Local currency (spent while travelling)
            <input placeholder="SGD" value={localCurrency} onChange={(e) => setLocalCurrency(e.target.value.toUpperCase())} maxLength={3} minLength={3} required />
          </label>
        </details>
        <button>Create group</button>
      </form>

      <form className="card" onSubmit={join}>
        <h3>Join with invite code</h3>
        <input placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} required />
        <button>Join</button>
      </form>
      {err && <p className="error">{err}</p>}
    </>
  )
}
