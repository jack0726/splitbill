import { useEffect, useRef, useState } from 'react'
import ReceiptCropper from './ReceiptCropper'
import { loadImage, receiptUrl, uploadReceipt } from '../lib/receipt'

// Authenticated thumbnail; tap to view full screen.
export function ReceiptThumb({ k, className = 'receiptThumb' }: { k: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setFailed(false)
    receiptUrl(k).then((u) => live && setSrc(u), () => live && setFailed(true))
    return () => { live = false }
  }, [k])
  if (failed) return <span className="muted small">Receipt unavailable</span>
  if (!src) return <span className="muted small">Loading receipt…</span>
  return (
    <>
      <img className={className} src={src} alt="Receipt" onClick={() => setOpen(true)} />
      {open && (
        <div className="viewer" onClick={() => setOpen(false)}>
          <img src={src} alt="Receipt" />
        </div>
      )}
    </>
  )
}

// Form field: take a photo (opens the camera on phones) or pick one, crop, then upload the shrunken B&W copy.
export function ReceiptField(p: { groupId: string; value: string | null; onChange: (key: string | null) => void }) {
  const [img, setImg] = useState<ImageBitmap | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)

  async function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr('')
    try {
      setImg(await loadImage(file))
    } catch {
      setErr('Could not read that image')
    }
  }

  async function done(blob: Blob) {
    setBusy(true)
    try {
      p.onChange(await uploadReceipt(p.groupId, blob))
      setImg(null)
    } catch (x) {
      setErr((x as Error).message)
      setImg(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="receiptRow">
        {p.value && <ReceiptThumb k={p.value} />}
        <button type="button" className="link" disabled={busy} onClick={() => camera.current?.click()}>📷 Take photo</button>
        <button type="button" className="link" disabled={busy} onClick={() => gallery.current?.click()}>🖼️ Choose photo</button>
        {p.value && <button type="button" className="link danger" onClick={() => p.onChange(null)}>Remove</button>}
        {busy && <span className="muted small">Uploading…</span>}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={picked} />
      {err && <p className="error">{err}</p>}
      {img && <ReceiptCropper img={img} onDone={done} onCancel={() => setImg(null)} />}
    </div>
  )
}
