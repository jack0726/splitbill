import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Auth from './pages/Auth'
import Groups from './pages/Groups'
import GroupPage from './pages/GroupPage'
import Join from './pages/Join'
import Profile from './pages/Profile'
import Avatar from './components/Avatar'
import PublicShare from './pages/PublicShare'
import PizzaLoading from './components/PizzaLoading'
import { refreshOfflineCache } from './lib/offlineCache'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [me, setMe] = useState<{ name: string; avatar_key: string | null } | null>(null)
  const [tick, setTick] = useState(0)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('splitbill-theme')
    return saved === 'dark' || saved === 'light' ? saved : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('splitbill-theme', theme)
  }, [theme])

  const themeToggle = (
    <button
      className="themeToggle"
      type="button"
      onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
    </button>
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // iOS Safari can leave an installed PWA open for long periods without
  // checking its service worker for a new deployment. Check when the app
  // returns to the foreground and periodically while it remains open.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const checkForAppUpdate = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.update().catch(() => undefined))),
      ).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', checkForAppUpdate)
    window.addEventListener('focus', checkForAppUpdate)
    window.addEventListener('online', checkForAppUpdate)
    const interval = window.setInterval(checkForAppUpdate, 30 * 60 * 1000)
    checkForAppUpdate()
    return () => {
      document.removeEventListener('visibilitychange', checkForAppUpdate)
      window.removeEventListener('focus', checkForAppUpdate)
      window.removeEventListener('online', checkForAppUpdate)
      window.clearInterval(interval)
    }
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    const refresh = () => { void refreshOfflineCache(uid).catch(() => {}) }
    if (navigator.onLine) refresh()
    window.addEventListener('online', refresh)
    return () => window.removeEventListener('online', refresh)
  }, [uid])

  useEffect(() => {
    if (!uid) return setMe(null)
    supabase.from('profiles').select('name, avatar_key').eq('id', uid).single().then(({ data }) => setMe(data))
  }, [uid, tick])

  if (!ready) return <PizzaLoading />
  if (!session && !location.pathname.startsWith('/share/')) return <><div className="themeControl">{themeToggle}</div><Auth /></>
  if (recovering) return <ResetPassword onDone={() => setRecovering(false)} />
  if (!session) return <Routes><Route path="/share/:id" element={<PublicShare />} /><Route path="*" element={<Auth />} /></Routes>

  return (
    <>
      <header className="bar">
        <Link to="/" className="logo"><img src="/icon.svg" alt="" /><span>Pizza</span><span className="appVersion">v{__APP_VERSION__}</span></Link>
        <div className="headerActions">
          {themeToggle}
          <Link to="/profile"><Avatar name={me?.name ?? '?'} k={me?.avatar_key} size={28} /></Link>
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/share/:id" element={<PublicShare />} />
          <>
          <Route path="/" element={<Groups userId={session.user.id} />} />
          <Route path="/g/:id" element={<GroupPage userId={session.user.id} />} />
          <Route path="/profile" element={<Profile user={session.user} onChanged={() => setTick((t) => t + 1)} />} />
          <Route path="/join/:code" element={<Join />} />
          </>
        </Routes>
      </main>
    </>
  )
}

function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setMsg(error.message)
    else onDone()
  }
  return (
    <form className="card auth" onSubmit={submit}>
      <h1>New password</h1>
      <input type="password" placeholder="New password (min 6 characters)" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button>Set password</button>
      {msg && <p className="error">{msg}</p>}
    </form>
  )
}
