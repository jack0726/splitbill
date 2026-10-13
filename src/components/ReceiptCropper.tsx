import { useEffect, useRef, useState } from 'react'
import { processAvatar, processReceipt, type Crop } from '../lib/receipt'

type Box = { x: number; y: number; w: number; h: number } // in displayed pixels
type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; px: number; py: number; box: Box }

const MIN = 40

// Full-screen crop step: drag the box or its corners, then "Use photo" crops + shrinks + converts to B&W.
export default function ReceiptCropper(p: { img: ImageBitmap; square?: boolean; onDone: (blob: Blob) => void; onCancel: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 0, h: 0 })
  const drag = useRef<Drag | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // fit the image inside the available area, preserving aspect ratio
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const s = Math.min(el.clientWidth / p.img.width, el.clientHeight / p.img.height)
    const w = Math.round(p.img.width * s)
    const h = Math.round(p.img.height * s)
    setSize({ w, h })
    if (p.square) {
      const q = Math.round(Math.min(w, h) * 0.9)
      setBox({ x: Math.round((w - q) / 2), y: Math.round((h - q) / 2), w: q, h: q })
    } else {
      setBox({ x: Math.round(w * 0.05), y: Math.round(h * 0.05), w: Math.round(w * 0.9), h: Math.round(h * 0.9) })
    }
  }, [p.img])

  function start(mode: Drag['mode']) {
    return (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = { mode, px: e.clientX, py: e.clientY, box }
    }
  }

  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d || !size) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    let { x, y, w, h } = d.box
    if (d.mode === 'move') {
      x = Math.min(Math.max(0, x + dx), size.w - w)
      y = Math.min(Math.max(0, y + dy), size.h - h)
    } else {
      const left = d.mode.includes('w')
      const top = d.mode.includes('n')
      const x2 = left ? x + w : Math.min(size.w, x + w + dx)
      const y2 = top ? y + h : Math.min(size.h, y + h + dy)
      const nx = left ? Math.min(Math.max(0, x + dx), x2 - MIN) : x
      const ny = top ? Math.min(Math.max(0, y + dy), y2 - MIN) : y
      x = nx; y = ny
      w = Math.max(MIN, x2 - nx)
      h = Math.max(MIN, y2 - ny)
      if (p.square) {
        const q = Math.min(w, h)
        if (left) x += w - q
        if (top) y += h - q
        w = h = q
      }
    }
    setBox({ x, y, w, h })
  }

  async function confirm() {
    if (!size) return
    setBusy(true)
    setErr('')
    try {
      const k = p.img.width / size.w
      const crop: Crop = { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k }
      p.onDone(await (p.square ? processAvatar : processReceipt)(p.img, crop))
    } catch (x) {
      setErr((x as Error).message)
      setBusy(false)
    }
  }

  // draw the picture on a canvas (an ImageBitmap can't be an <img> src)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c || !size) return
    c.width = size.w
    c.height = size.h
    c.getContext('2d')!.drawImage(p.img, 0, 0, size.w, size.h)
  }, [p.img, size])

  const handle = (mode: Drag['mode'], style: React.CSSProperties) => (
    <div className="cropHandle" style={style} onPointerDown={start(mode)} />
  )

  return (
    <div className="cropper">
      <div className="cropArea" ref={wrap}>
        {size && (
          <div className="cropStage" style={{ width: size.w, height: size.h }} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
            <canvas ref={canvas} />
            <div className="cropBox" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} onPointerDown={start('move')}>
              {handle('nw', { left: -14, top: -14 })}
              {handle('ne', { right: -14, top: -14 })}
              {handle('sw', { left: -14, bottom: -14 })}
              {handle('se', { right: -14, bottom: -14 })}
            </div>
          </div>
        )}
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row cropBar">
        <button type="button" className="link" onClick={p.onCancel} disabled={busy}>Cancel</button>
        <span className="muted small">Drag the corners to crop</span>
        <button type="button" onClick={confirm} disabled={busy || !size}>{busy ? 'Working…' : 'Use photo'}</button>
      </div>
    </div>
  )
}
