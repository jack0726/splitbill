import { useEffect, useState } from 'react'
import { receiptUrl } from '../lib/receipt'
import { hue } from '../pages/GroupPage'

// Profile picture, or a coloured initial when there is none.
export default function Avatar({ name, k, size = 32 }: { name: string; k?: string | null; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSrc(null)
    if (k) receiptUrl(k).then((u) => live && setSrc(u), () => {})
    return () => { live = false }
  }, [k])
  const style = { width: size, height: size, fontSize: size * 0.45 }
  if (src) return <img className="avatar" style={style} src={src} alt={name} />
  return (
    <div className="avatar" style={{ ...style, background: `hsl(${hue(name)} 60% 88%)`, color: `hsl(${hue(name)} 45% 30%)` }}>
      {name.trim().charAt(0).toUpperCase()}
    </div>
  )
}
