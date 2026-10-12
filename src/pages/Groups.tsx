import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, type Group } from '../lib/supabase'

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([])
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('SGD')
  const [localCurrency, setLocalCurrency] = useState('SGD')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const nav = useNavigate()

  async function load() {
    const { data } = await supabase.from('groups').select('*').order('created_at', { ascending: false })
    setGroups((data as Group[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('groups').insert({ name, currency, local_currency: localCurrency }).select().single()
    if (error) return setErr(error.message)
    nav(`/g/${data.id}`)
  }

  async function join(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.rpc('join_group', { code: code.trim() })
    if (error) return setErr(error.message)
    nav(`/g/${data}`)
  }

  return (
    <>
      <h2>Your groups</h2>
      {groups.length === 0 && <p className="muted">No groups yet. Create one below.</p>}
      {groups.map((g) => (
        <Link key={g.id} to={`/g/${g.id}`} className="card row">
          <strong>{g.name}</strong>
          <span className="muted">{g.local_currency !== g.currency ? `${g.local_currency} → ${g.currency}` : g.currency}</span>
        </Link>
      ))}

      <form className="card" onSubmit={create}>
        <h3>New group</h3>
        <input placeholder="Group name (e.g. Trip to Bergen)" value={name} onChange={(e) => setName(e.target.value)} required />
        <label>Settlement currency
          <input placeholder="SGD" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} minLength={3} required />
        </label>
        <label>Local currency (spent while travelling)
          <input placeholder="SGD" value={localCurrency} onChange={(e) => setLocalCurrency(e.target.value.toUpperCase())} maxLength={3} minLength={3} required />
        </label>
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
