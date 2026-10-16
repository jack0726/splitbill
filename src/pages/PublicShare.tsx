import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type PublicExpense = { id: string; description: string; amount: number; spent_on: string; local_amount: number | null; local_currency: string | null; fx_rate: number | null; paid_by: string }
type PublicGroup = { name: string; currency: string; local_currency: string; expenses: PublicExpense[] }

export default function PublicShare() {
  const { id } = useParams()
  const [pin, setPin] = useState('')
  const [group, setGroup] = useState<PublicGroup | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function unlock(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('read_public_group_share', { share_id: id, pin })
    setLoading(false)
    if (rpcError) return setError('That PIN is incorrect or this share link has been turned off.')
    setGroup(data as PublicGroup)
  }

  return (
    <main>
      <header className="bar publicBar"><span className="logo">Pizza</span><span>Shared expenses</span></header>
      {!group ? (
        <form className="card auth" onSubmit={unlock}>
          <h2>View shared expenses</h2>
          <p className="muted">Enter the 6 digit PIN provided by the group.</p>
          <label>PIN<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
          {error && <p className="error">{error}</p>}
          <button disabled={loading || pin.length !== 6}>{loading ? 'Checking…' : 'View expenses'}</button>
        </form>
      ) : (
        <>
          <h2>{group.name}</h2>
          <p className="muted">Read-only expense list · {group.expenses.length} expenses</p>
          {group.expenses.map((expense) => (
            <article className="card publicExpense" key={expense.id}>
              <div className="row"><b>{expense.description}</b><b>{Number(expense.amount).toFixed(2)} {group.currency}</b></div>
              <div className="muted small">{expense.spent_on} · Paid by {expense.paid_by}</div>
              {expense.local_amount != null && expense.local_currency !== group.currency && (
                <div className="muted small">Original amount: {Number(expense.local_amount).toFixed(2)} {expense.local_currency} @ {expense.fx_rate}</div>
              )}
            </article>
          ))}
          {group.expenses.length === 0 && <p className="muted">No expenses yet.</p>}
        </>
      )}
    </main>
  )
}
