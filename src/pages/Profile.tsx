import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { loadImage, uploadAvatar } from '../lib/receipt'
import ReceiptCropper from '../components/ReceiptCropper'
import Avatar from '../components/Avatar'

export default function Profile({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [img, setImg] = useState<ImageBitmap | null>(null)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const gallery = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('profiles').select('name, avatar_key').eq('id', user.id).single().then(({ data }) => {
      if (data) { setName(data.name); setAvatar(data.avatar_key) }
    })
  }, [user.id])

  function say(m: string, e = '') { setMsg(m); setErr(e) }

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ name: name.trim() }).eq('id', user.id)
    if (!error) await supabase.auth.updateUser({ data: { name: name.trim() } })
    setBusy(false)
    if (error) return say('', error.message)
    say('Name saved')
    onChanged()
  }

  async function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try { setImg(await loadImage(file)) } catch { say('', 'Could not read that image') }
  }

  async function cropped(blob: Blob) {
    setImg(null)
    setBusy(true)
    try {
      const key = await uploadAvatar(blob)
      const { error } = await supabase.from('profiles').update({ avatar_key: key }).eq('id', user.id)
      if (error) throw error
      setAvatar(key)
      say('Photo saved')
      onChanged()
    } catch (x) {
      say('', (x as Error).message)
    }
    setBusy(false)
  }

  async function removeAvatar() {
    const { error } = await supabase.from('profiles').update({ avatar_key: null }).eq('id', user.id)
    if (error) return say('', error.message)
    setAvatar(null)
    onChanged()
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return say('', error.message)
    setPassword('')
    say('Password changed')
  }

  return (
    <>
      <h2>Profile</h2>
      <div className="card">
        <div className="receiptRow">
          <Avatar name={name || user.email || '?'} k={avatar} size={72} />
          <button type="button" className="link" disabled={busy} onClick={() => camera.current?.click()}>📷 Take photo</button>
          <button type="button" className="link" disabled={busy} onClick={() => gallery.current?.click()}>🖼️ Choose photo</button>
          {avatar && <button type="button" className="link danger" onClick={removeAvatar}>Remove</button>}
        </div>
        <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={picked} />
        <input ref={gallery} type="file" accept="image/*" hidden onChange={picked} />
      </div>
      {img && <ReceiptCropper img={img} square onDone={cropped} onCancel={() => setImg(null)} />}

      <form className="card" onSubmit={saveName}>
        <h3>Name</h3>
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        <p className="muted small">{user.email}</p>
        <button disabled={busy}>Save name</button>
      </form>

      <form className="card" onSubmit={savePassword}>
        <h3>Change password</h3>
        <input type="password" placeholder="New password (min 6 characters)" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button disabled={busy}>Change password</button>
      </form>
      {msg && <p className="posText">{msg}</p>}
      {err && <p className="error">{err}</p>}
    </>
  )
}
