import { useEffect, useState } from 'react'
import { receiptUrl } from '../lib/receipt'
import { hue } from '../pages/GroupPage'

export const AVATAR_PRESETS = [
  { id: 'lf-01', src: '/avatars/avatar-01.png', title: 'Spiky hair', creator: 'Artem Bezdolev', url: 'https://lottiefiles.com/free-animation/avatar-M96ZOrdG4C' },
  { id: 'lf-02', src: '/avatars/avatar-02.png', title: 'Blue hoodie', creator: 'Matthew C', url: 'https://lottiefiles.com/free-animation/avatar-2K8fgWn5xp' },
  { id: 'lf-03', src: '/avatars/avatar-03.png', title: 'Blue shirt', creator: 'MD Kowsar Ali', url: 'https://lottiefiles.com/free-animation/avatar-Nkty3EUywH' },
  { id: 'lf-04', src: '/avatars/avatar-04.png', title: 'Pink stripes', creator: 'Prime', url: 'https://lottiefiles.com/free-animation/avatar-9SnXmPFZCl' },
  { id: 'lf-05', src: '/avatars/avatar-05.png', title: 'Dark hair', creator: 'Allan Ribas', url: 'https://lottiefiles.com/free-animation/avatar_choice-ZNSQbDjqj2' },
  { id: 'lf-06', src: '/avatars/avatar-06.png', title: 'Orange hair', creator: 'Patchpo', url: 'https://lottiefiles.com/free-animation/meet-the-team-avatar-14-PLTNsipjiH' },
  { id: 'lf-07', src: '/avatars/avatar-07.png', title: 'Young boy', creator: 'Viet Le', url: 'https://lottiefiles.com/free-animation/profile-avatar-for-child-UoIzfSbAe2' },
  { id: 'lf-08', src: '/avatars/avatar-08.png', title: 'Short hair', creator: 'Emily Liao', url: 'https://lottiefiles.com/free-animation/avatar-woman-short-hair-ZbixzqM6fP' },
]

export function presetAvatarKey(id: string) { return `preset:${id}` }

// Profile picture, or a coloured initial when there is none.
export default function Avatar({ name, k, size = 32 }: { name: string; k?: string | null; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSrc(null)
    if (k && !k.startsWith('preset:')) receiptUrl(k).then((u) => live && setSrc(u), () => {})
    return () => { live = false }
  }, [k])
  const style = { width: size, height: size, fontSize: size * 0.45 }
  if (k?.startsWith('preset:')) {
    const preset = AVATAR_PRESETS.find((item) => item.id === k.slice(7))
    if (preset) return <img className="avatar" style={style} src={preset.src} alt={`${name}'s avatar`} />
  }
  if (src) return <img className="avatar" style={style} src={src} alt={name} />
  return (
    <div className="avatar" style={{ ...style, background: `hsl(${hue(name)} 60% 88%)`, color: `hsl(${hue(name)} 45% 30%)` }}>
      {name.trim().charAt(0).toUpperCase()}
    </div>
  )
}
