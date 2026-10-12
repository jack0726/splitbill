import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Auth from './pages/Auth'
import Groups from './pages/Groups'
import GroupPage from './pages/GroupPage'
import Join from './pages/Join'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return <p className="center muted">Loading…</p>
  if (!session) return <Auth />

  return (
    <>
      <header className="bar">
        <Link to="/" className="logo">SplitBill</Link>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Groups />} />
          <Route path="/g/:id" element={<GroupPage userId={session.user.id} />} />
          <Route path="/join/:code" element={<Join />} />
        </Routes>
      </main>
    </>
  )
}
