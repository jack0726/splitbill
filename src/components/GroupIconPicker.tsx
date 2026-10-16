import { useState } from 'react'
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic.js'
import {
  BookOpen, BriefcaseBusiness, Car, Coffee, Dumbbell, Gamepad2, Heart,
  House, Music, Plane, Search, ShoppingBag, Tent, Users, Utensils, Wallet,
  PartyPopper, type LucideIcon,
} from 'lucide-react'

export const GROUP_ICONS: Record<string, LucideIcon> = {
  Users, House, Plane, Utensils, ShoppingBag, Car, Coffee, Music, Heart,
  Dumbbell, BookOpen, Gamepad2, Tent, Wallet, PartyPopper, BriefcaseBusiness,
}

export const GROUP_COLORS = [
  { background: '#fee2e2', foreground: '#991b1b', name: 'Red' },
  { background: '#ffedd5', foreground: '#9a3412', name: 'Orange' },
  { background: '#fef3c7', foreground: '#92400e', name: 'Amber' },
  { background: '#ecfccb', foreground: '#3f6212', name: 'Lime' },
  { background: '#dcfce7', foreground: '#166534', name: 'Green' },
  { background: '#ccfbf1', foreground: '#115e59', name: 'Teal' },
  { background: '#cffafe', foreground: '#155e75', name: 'Cyan' },
  { background: '#dbeafe', foreground: '#1e40af', name: 'Blue' },
  { background: '#e0e7ff', foreground: '#3730a3', name: 'Indigo' },
  { background: '#ede9fe', foreground: '#5b21b6', name: 'Violet' },
  { background: '#fae8ff', foreground: '#86198f', name: 'Fuchsia' },
  { background: '#fce7f3', foreground: '#9d174d', name: 'Pink' },
]

function renderIcon(name: string, size: number) {
  const Icon = name && GROUP_ICONS[name]
  if (Icon) return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
  if (name && iconNames.includes(name as IconName)) {
    return <DynamicIcon name={name as IconName} size={size} strokeWidth={1.8} aria-hidden="true" />
  }
  return <Users size={size} strokeWidth={1.8} aria-hidden="true" />
}

export function GroupIcon({ name, size = 24 }: { name?: string | null; size?: number }) {
  return renderIcon(name || 'Users', size)
}

export default function GroupIconPicker({ value, onChange, color, onColorChange }: {
  value: string
  onChange: (value: string) => void
  color: string | null
  onColorChange: (color: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const curatedIcons = Object.keys(GROUP_ICONS)
  const allIcons = [...new Set([...curatedIcons, ...iconNames])]
  const matchingIcons = searchOpen
    ? allIcons.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
    : curatedIcons.slice(0, 14)
  const icons = searchOpen ? matchingIcons.slice(0, 60) : matchingIcons

  return (
    <fieldset className="iconPicker">
      <legend>Group icon</legend>
      {searchOpen && <input
          type="search"
          aria-label="Search group icons"
          placeholder="Search icons"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />}
      <div className="iconOptions">
        {icons.map((name) => (
          <button
            key={name}
            type="button"
            className={value === name ? 'selected' : ''}
            aria-label={name}
            aria-pressed={value === name}
            title={name}
            onClick={() => onChange(name)}
          >{renderIcon(name, 22)}
          </button>
        ))}
        <button type="button" aria-label={searchOpen ? 'Close icon search' : 'Search icons'} title={searchOpen ? 'Close search' : 'Search icons'} onClick={() => { setSearchOpen((open) => !open); setQuery('') }}>
          {searchOpen ? <span aria-hidden="true">×</span> : <Search size={22} strokeWidth={1.8} aria-hidden="true" />}
        </button>
        <button type="button" aria-label="Choose group icon color" title="Choose icon color" onClick={() => setPaletteOpen((open) => !open)}>
          <PaletteIcon />
        </button>
      </div>
      {paletteOpen && <div className="colorOptions" aria-label="Group icon background color">
        {GROUP_COLORS.map((option) => <button
          key={option.background}
          type="button"
          aria-label={`${option.name} background`}
          aria-pressed={color === option.background}
          title={option.name}
          className={color === option.background ? 'selected' : ''}
          style={{ background: option.background, color: option.foreground }}
          onClick={() => onColorChange(option.background)}
        />)}
        <button type="button" className={!color ? 'selected' : ''} aria-label="Use automatic group color" aria-pressed={!color} title="Automatic color" onClick={() => onColorChange(null)}>Auto</button>
      </div>}
      {searchOpen && matchingIcons.length > icons.length && <small className="muted">Showing {icons.length} of {matchingIcons.length} matches. Refine your search to see more.</small>}
      {icons.length === 0 && <small className="muted">No matching icons.</small>}
    </fieldset>
  )
}

function PaletteIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.2-3.1 1.7 1.7 0 0 1 1.2-2.9H18a3 3 0 0 0 3-3c0-5-4-9-9-9Z" />
    <circle cx="7.5" cy="10" r=".8" /><circle cx="10" cy="6.5" r=".8" /><circle cx="15" cy="7" r=".8" />
  </svg>
}
