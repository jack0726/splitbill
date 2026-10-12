import { supabase } from './supabase'

const MAX_EDGE = 1400
const QUALITY = 0.7

export type Crop = { x: number; y: number; w: number; h: number } // in source-image pixels

// Decode with EXIF rotation applied, so phone photos aren't sideways.
export const loadImage = (file: Blob) => createImageBitmap(file, { imageOrientation: 'from-image' })

// Crop, downscale, convert to black & white (grayscale + auto contrast) and encode as a small JPEG.
export async function processReceipt(img: ImageBitmap, crop: Crop): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(crop.w, crop.h))
  const w = Math.max(1, Math.round(crop.w * scale))
  const h = Math.max(1, Math.round(crop.h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h)

  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000
    px[i] = px[i + 1] = px[i + 2] = g
    hist[g | 0]++
  }
  // stretch levels between the 1st and 99th percentile so text pops and the paper goes white
  const total = w * h
  let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break } }
  const range = Math.max(1, hi - lo)
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = Math.min(255, Math.max(0, ((px[i] - lo) * 255) / range))
  }
  ctx.putImageData(data, 0, 0)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', QUALITY),
  )
}

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${data.session?.access_token ?? ''}` }
}

export async function uploadReceipt(groupId: string, blob: Blob): Promise<string> {
  const res = await fetch(`/api/receipts/${groupId}`, {
    method: 'PUT',
    headers: { ...(await authHeader()), 'Content-Type': 'image/jpeg' },
    body: blob,
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Upload failed')
  return ((await res.json()) as { key: string }).key
}

// <img> can't send the auth header, so fetch the bytes and hand back an object URL.
const cache = new Map<string, string>()
export async function receiptUrl(key: string): Promise<string> {
  const hit = cache.get(key)
  if (hit) return hit
  const res = await fetch(`/api/receipts/${key}`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Receipt unavailable')
  const url = URL.createObjectURL(await res.blob())
  cache.set(key, url)
  return url
}
