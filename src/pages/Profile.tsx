import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import Avatar, { AVATAR_PRESETS, presetAvatarKey } from '../components/Avatar'
import CameraCapture from '../components/CameraCapture'
import ReceiptCropper from '../components/ReceiptCropper'
import { generateAvatar, loadImage, processAvatar, uploadAvatar } from '../lib/receipt'

export default function Profile({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [paynowMobile, setPaynowMobile] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [photoImg, setPhotoImg] = useState<ImageBitmap | null>(null)
  const [photoConsent, setPhotoConsent] = useState(false)
  const [generatedAvatar, setGeneratedAvatar] = useState<Blob | null>(null)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const gallery = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!generatedAvatar) { setGeneratedUrl(null); return }
    const url = URL.createObjectURL(generatedAvatar)
    setGeneratedUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [generatedAvatar])

  useEffect(() => {
    supabase.from('profiles').select('name, avatar_key, paynow_mobile').eq('id', user.id).single().then(({ data }) => {
      if (data) { setName(data.name); setAvatar(data.avatar_key); setPaynowMobile(data.paynow_mobile ?? '') }
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

  async function savePayNow(e: React.FormEvent) {
    e.preventDefault()
    const digits = paynowMobile.replace(/[\s()-]/g, '')
    const normalized = digits ? (digits.startsWith('+65') ? digits : digits.startsWith('65') ? `+${digits}` : `+65${digits}`) : null
    if (normalized && !/^\+65[89]\d{7}$/.test(normalized)) return say('', 'Enter a Singapore mobile number with 8 digits, starting with 8 or 9.')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ paynow_mobile: normalized }).eq('id', user.id)
    setBusy(false)
    if (error) return say('', error.message)
    setPaynowMobile(normalized ?? '')
    say(normalized ? 'PayNow number saved' : 'PayNow number removed')
  }

  async function chooseAvatar(key: string | null) {
    setBusy(true)
    try {
      const { error } = await supabase.from('profiles').update({ avatar_key: key }).eq('id', user.id)
      if (error) throw error
      setAvatar(key)
      say(key ? 'Avatar saved' : 'Using your initial')
      onChanged()
    } catch (x) {
      say('', (x as Error).message)
    }
    setBusy(false)
  }

  async function pickedPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await openPhoto(file)
  }

  async function openPhoto(file: Blob) {
    setCameraOpen(false)
    setGeneratedAvatar(null)
    try { setPhotoImg(await loadImage(file)) } catch { say('', 'Could not read that photo') }
  }

  async function createFromPhoto(photo: Blob) {
    setPhotoImg(null)
    setBusy(true)
    say('Creating your avatar…')
    try {
      setGeneratedAvatar(await generateAvatar(photo))
      say('Avatar preview ready. Choose Use this avatar to save it.')
    } catch (x) {
      say('', (x as Error).message)
    }
    setBusy(false)
  }

  async function saveGeneratedAvatar() {
    if (!generatedAvatar) return
    setBusy(true)
    try {
      const image = await loadImage(generatedAvatar)
      const jpeg = await processAvatar(image, { x: 0, y: 0, w: image.width, h: image.height })
      image.close()
      const key = await uploadAvatar(jpeg)
      const { error } = await supabase.from('profiles').update({ avatar_key: key }).eq('id', user.id)
      if (error) throw error
      setAvatar(key)
      setGeneratedAvatar(null)
      say('Avatar saved')
      onChanged()
    } catch (x) {
      say('', (x as Error).message)
    }
    setBusy(false)
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
        <div className="avatarPickerHeading">
          <Avatar name={name || user.email || '?'} k={avatar} size={72} />
          <div><h3>Choose an avatar</h3><p className="muted small">Choose a preset or create one from your photo.</p></div>
        </div>
        <section className="photoAvatar">
          <h3>Create an avatar from a selfie</h3>
          <p className="muted small">We’ll turn your cropped photo into an illustrated headshot. You can preview it before saving.</p>
          <label className="check photoConsent">
            <input type="checkbox" checked={photoConsent} onChange={(e) => setPhotoConsent(e.target.checked)} />
            <span>I agree to send my cropped photo to OpenAI to generate an avatar. Pizza saves the generated image only if I choose it. Image generation may incur API charges.</span>
          </label>
          <div className="photoAvatarActions">
            <button type="button" disabled={!photoConsent || busy} onClick={() => setCameraOpen(true)}>📷 Take a selfie</button>
            <button type="button" className="secondaryButton" disabled={!photoConsent || busy} onClick={() => gallery.current?.click()}>Choose a photo</button>
          </div>
          <input ref={gallery} type="file" accept="image/*" hidden onChange={pickedPhoto} />
          {busy && msg === 'Creating your avatar…' && <p className="muted small" role="status">Creating your avatar… This may take a little while.</p>}
          {generatedUrl && <div className="generatedAvatarPreview">
            <img src={generatedUrl} alt="Generated avatar preview" />
            <div><button type="button" disabled={busy} onClick={saveGeneratedAvatar}>Use this avatar</button><button type="button" className="link" disabled={busy} onClick={() => setGeneratedAvatar(null)}>Discard</button></div>
          </div>}
        </section>
        <div className="avatarPicker" role="group" aria-label="Avatar choices">
          {AVATAR_PRESETS.map((preset) => {
            const selected = avatar === presetAvatarKey(preset.id)
            return <button
              key={preset.id}
              type="button"
              className={`avatarChoice${selected ? ' selected' : ''}`}
              disabled={busy}
              aria-label={`Choose ${preset.title} avatar`}
              aria-pressed={selected}
              title={preset.title}
              onClick={() => chooseAvatar(presetAvatarKey(preset.id))}
            ><img src={preset.src} alt="" /></button>
          })}
        </div>
        <div className="avatarPickerFooter">
          <details className="avatarCredits muted small">
            <summary>Avatar credits and license</summary>
            <ul>{AVATAR_PRESETS.map((preset) => <li key={preset.id}><a href={preset.url} target="_blank" rel="noreferrer">{preset.title}</a> by {preset.creator}</li>)}</ul>
            <a href="https://lottiefiles.com/page/license" target="_blank" rel="noreferrer">Lottie Simple License</a>
          </details>
          {avatar && <button type="button" className="link" disabled={busy} onClick={() => chooseAvatar(null)}>Use initial instead</button>}
        </div>
      </div>
      {photoImg && <ReceiptCropper img={photoImg} square onDone={createFromPhoto} onCancel={() => setPhotoImg(null)} />}
      {cameraOpen && <CameraCapture onCaptured={openPhoto} onCancel={() => setCameraOpen(false)} />}

      <form className="card" onSubmit={saveName}>
        <h3>Name</h3>
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        <p className="muted small">{user.email}</p>
        <button disabled={busy}>Save name</button>
      </form>

      <form className="card" onSubmit={savePayNow}>
        <h3>PayNow</h3>
        <p className="muted small">Add your Singapore mobile number linked to PayNow. People settling up with you can scan a payment QR. Leave blank to skip.</p>
        <label>Handphone number<input type="tel" inputMode="tel" autoComplete="tel" placeholder="9123 4567 or +65 9123 4567" value={paynowMobile} onChange={(e) => setPaynowMobile(e.target.value)} /></label>
        <button disabled={busy}>Save PayNow number</button>
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
