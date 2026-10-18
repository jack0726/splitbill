import { useEffect, useState } from 'react'
import { receiptUrl } from '../lib/receipt'
import { hue } from '../pages/GroupPage'

export const AVATAR_PRESETS = [
  { id: 'lf-01', src: '/avatars/avatar-01.png', title: 'Spiky hair', group: 'Male', creator: 'Artem Bezdolev', url: 'https://lottiefiles.com/free-animation/avatar-M96ZOrdG4C' },
  { id: 'lf-02', src: '/avatars/avatar-02.png', title: 'Blue hoodie', group: 'Male', creator: 'Matthew C', url: 'https://lottiefiles.com/free-animation/avatar-2K8fgWn5xp' },
  { id: 'lf-03', src: '/avatars/avatar-03.png', title: 'Blue shirt', group: 'Male', creator: 'MD Kowsar Ali', url: 'https://lottiefiles.com/free-animation/avatar-Nkty3EUywH' },
  { id: 'lf-04', src: '/avatars/avatar-04.png', title: 'Pink stripes', group: 'Female', creator: 'Prime', url: 'https://lottiefiles.com/free-animation/avatar-9SnXmPFZCl' },
  { id: 'lf-05', src: '/avatars/avatar-05.png', title: 'Dark hair', group: 'Female', creator: 'Allan Ribas', url: 'https://lottiefiles.com/free-animation/avatar_choice-ZNSQbDjqj2' },
  { id: 'lf-06', src: '/avatars/avatar-06.png', title: 'Orange hair', group: 'Female', creator: 'Patchpo', url: 'https://lottiefiles.com/free-animation/meet-the-team-avatar-14-PLTNsipjiH' },
  { id: 'lf-07', src: '/avatars/avatar-07.png', title: 'Young boy', group: 'Children', creator: 'Viet Le', url: 'https://lottiefiles.com/free-animation/profile-avatar-for-child-UoIzfSbAe2' },
  { id: 'lf-08', src: '/avatars/avatar-08.png', title: 'Short hair', group: 'Female', creator: 'Emily Liao', url: 'https://lottiefiles.com/free-animation/avatar-woman-short-hair-ZbixzqM6fP' },
  ...[
    ['male', 'Male', 17, false],
    ['female', 'Female', 16, false],
    ['senior', 'Seniors', 20, true],
    ['teen', 'Teens', 20, false],
    ['child', 'Children', 19, false],
  ].flatMap(([kind, group, count, senior]) => Array.from({ length: count as number }, (_, n) => {
    const id = `${kind}-${n + 1}`
    const skinTones = ['#f1c7a5', '#c98e68', '#8d5524', '#e0ac82', '#704735']
    const hairTones = senior ? ['#a9aaa7', '#777c82', '#d0c6b3', '#6a5750'] : ['#30252a', '#8d5524', '#cc8b4b', '#3c5870', '#70533e', '#9a445d']
    const shirtTones = ['#477c83', '#a65368', '#5268a5', '#cc8b4b', '#678e80', '#735b91', '#c06c4a']
    const backgrounds = ['#d9eee6', '#f5e2d5', '#dfe5f7', '#f0e8c9', '#d8eaf0', '#f0ddeb']
    const skin = skinTones[(n * 3 + 1) % skinTones.length]
    const hair = hairTones[(n * 5 + 2) % hairTones.length]
    const shirt = shirtTones[(n * 2 + 3) % shirtTones.length]
    const bg = backgrounds[n % backgrounds.length]
    const style = n % 4
    const hairShape = style === 0 ? `<path d="M23 43Q22 16 50 17Q78 17 77 46L70 37L64 27Q49 36 30 29Z" fill="${hair}"/>` : style === 1 ? `<path d="M23 47Q20 17 50 17Q80 17 77 48L70 63L69 37Q50 29 31 38L30 61Z" fill="${hair}"/>` : style === 2 ? `<path d="M22 45Q22 16 50 17Q78 16 78 45Q64 34 50 35Q35 34 22 45Z" fill="${hair}"/><path d="M24 42L16 35L25 57M76 42L84 35L75 57" fill="${hair}"/>` : `<path d="M24 44Q24 18 50 18Q76 18 76 44L69 33Q49 40 31 32Z" fill="${hair}"/>`
    const child = kind === 'child'
    const title = `${group} avatar ${n + 1}`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="${bg}"/><path d="M12 100Q15 68 50 68Q85 68 88 100" fill="${shirt}"/><path d="M39 62h22v15Q50 85 39 77Z" fill="${skin}"/><ellipse cx="50" cy="47" rx="25" ry="31" fill="${skin}"/>${hairShape}<path d="M39 49h2m18 0h2" stroke="#342c2a" stroke-width="3" stroke-linecap="round"/><path d="M45 61q5 4 10 0" fill="none" stroke="#9d5550" stroke-width="2" stroke-linecap="round"/>${senior ? '<path d="M27 49q-8-7-11 1m57-1q8-7 11 1" fill="none" stroke="#777" stroke-width="3" stroke-linecap="round"/><path d="M34 45h10m12 0h10" stroke="#65747d" stroke-width="2"/><circle cx="39" cy="47" r="7" fill="none" stroke="#65747d" stroke-width="2"/><circle cx="61" cy="47" r="7" fill="none" stroke="#65747d" stroke-width="2"/></svg>' : child ? '<circle cx="50" cy="83" r="3" fill="#fff" opacity=".8"/></svg>' : '</svg>'}`
    return { id, src: `data:image/svg+xml,${encodeURIComponent(svg)}`, title, group: group as string, creator: 'Splitbill illustration', url: '' }
  })),
]

export const AVATAR_GROUPS = ['Male', 'Female', 'Seniors', 'Teens', 'Children'] as const

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
