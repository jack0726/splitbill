import { useState } from 'react'
import { supabase } from '../lib/supabase'
import PizzaLoading from '../components/PizzaLoading'

export default function Auth() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
      setMsg(error ? error.message : 'If that email has an account, a reset link is on its way.')
      setBusy(false)
      return
    }
    const { error, data } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: window.location.origin } })
    if (error) setMsg(error.message)
    else if (mode === 'up' && !data.session) setMsg('Check your email to confirm your account, then sign in.')
    setBusy(false)
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <PizzaLoading compact />
      <h1>Pizza</h1>
      <p className="muted">Split your pizza with friends.</p>
      {mode === 'up' && (
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
      )}
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {mode !== 'forgot' && (
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      )}
      <button disabled={busy}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
      {msg && <p className="error">{msg}</p>}
      {mode === 'in' && (
        <button type="button" className="link" onClick={() => { setMode('forgot'); setMsg('') }}>Forgot password?</button>
      )}
      <button type="button" className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg('') }}>
        {mode === 'in' ? 'No account? Sign up' : mode === 'up' ? 'Have an account? Sign in' : 'Back to sign in'}
      </button>
    </form>
  )
}
