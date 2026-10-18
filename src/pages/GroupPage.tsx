import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, type AuditEntry, type Details, type Expense, type Group, type Profile, type Settlement } from '../lib/supabase'
import Billing from './Billing'
import { ReceiptField, ReceiptThumb } from '../components/Receipt'
import { fetchRate } from '../lib/fx'
import { netBalances, simplifyDebts, splitByWeights, splitEqually } from '../lib/balances'
import { deleteGroupReceipts } from '../lib/receipt'
import GroupIconPicker, { GroupIcon, GROUP_COLORS } from '../components/GroupIconPicker'
import PayNowDialog from '../components/PayNowDialog'
import Avatar, { AVATAR_PRESETS, presetAvatarKey } from '../components/Avatar'
import { CalendarDays, RefreshCw, Share2 } from 'lucide-react'
import { asPendingExpense, pendingExpenses, queueExpense, subscribePending, syncPendingExpenses } from '../lib/offlineExpenses'

type SplitMode = 'equal' | 'exact' | 'percent' | 'shares'

export default function GroupPage({ userId }: { userId: string }) {
  const { id } = useParams()
  const nav = useNavigate()
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [tab, setTab] = useState<'expenses' | 'balances' | 'billing' | 'history'>('expenses')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [payer, setPayer] = useState('')
  const [selectedDates, setSelectedDates] = useState<string[] | null>(null)
  const [dateFilterOpen, setDateFilterOpen] = useState(false)
  const [newestFirst, setNewestFirst] = useState(true)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [viewing, setViewing] = useState<Expense | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'members' | 'sharing' | 'danger'>('general')
  const [groupName, setGroupName] = useState('')
  const [groupIcon, setGroupIcon] = useState('Users')
  const [groupIconColor, setGroupIconColor] = useState<string | null>(null)
  const [groupCurrency, setGroupCurrency] = useState('')
  const [groupLocalCurrency, setGroupLocalCurrency] = useState('')
  const [sharePin, setSharePin] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestAvatar, setGuestAvatar] = useState<string | null>(null)
  const [settling, setSettling] = useState<{ transfer: { from: string; to: string; amount: number }; recipient: Profile } | null>(null)
  const [pendingVersion, setPendingVersion] = useState(0)
  const [syncingPending, setSyncingPending] = useState(false)
  const [pendingSyncMessage, setPendingSyncMessage] = useState('')

  const load = useCallback(async () => {
    const cacheKey = `splitbill-group-cache:${userId}:${id}`
    let cache: { group?: Group; members?: Profile[]; expenses?: Expense[]; settlements?: Settlement[]; audit?: AuditEntry[] } = {}
    try { cache = JSON.parse(localStorage.getItem(cacheKey) ?? '{}') } catch { /* ignore malformed cache */ }
    if (cache.group) {
      setGroup(cache.group)
      setMembers(cache.members ?? [])
      const pending = pendingExpenses(id!, userId).map(asPendingExpense)
      const saved = cache.expenses ?? []
      setExpenses([...saved, ...pending.filter((local) => !saved.some((remote) => remote.id === local.id))]
        .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at)))
      setSettlements(cache.settlements ?? [])
      setAudit(cache.audit ?? [])
    }
    const [g, m, e, s, a] = await Promise.all([
      supabase.from('groups').select('*').eq('id', id).single(),
      supabase.from('group_members').select('profiles(id,name,avatar_key,paynow_mobile)').eq('group_id', id),
      supabase
        .from('expenses')
        .select('*, expense_splits(user_id, share)')
        .eq('group_id', id)
        .order('spent_on', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('settlements').select('*').eq('group_id', id),
      supabase.from('audit_log').select('*').eq('group_id', id).order('created_at', { ascending: false }).limit(200),
    ])
    const groupData = (g.data as Group | null) ?? cache.group ?? null
    const memberData = m.data ? ((m.data as unknown as { profiles: Profile }[]).map((r) => r.profiles)) : cache.members ?? []
    const saved = (e.data as Expense[] | null) ?? cache.expenses ?? []
    const settlementData = (s.data as Settlement[] | null) ?? cache.settlements ?? []
    const auditData = (a.data as AuditEntry[] | null) ?? cache.audit ?? []
    if (groupData) {
      try { localStorage.setItem(cacheKey, JSON.stringify({ group: groupData, members: memberData, expenses: saved, settlements: settlementData, audit: auditData })) } catch { /* cache is best effort */ }
    }
    setGroup(groupData)
    setMembers(memberData)
    const pending = pendingExpenses(id!, userId).map(asPendingExpense)
    setExpenses([...saved, ...pending.filter((local) => !saved.some((remote) => remote.id === local.id))]
      .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at)))
    setSettlements(settlementData)
    setAudit(auditData)
  }, [id, userId])

  useEffect(() => {
    load()
    const refreshPending = () => setPendingVersion((version) => version + 1)
    const unsubscribe = subscribePending(refreshPending)
    const sync = () => { void syncPendingExpenses(userId, id).then(load) }
    window.addEventListener('online', sync)
    sync()
    const ch = supabase
      .channel(`group-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, () => load())
      .subscribe()
    return () => {
      unsubscribe()
      window.removeEventListener('online', sync)
      supabase.removeChannel(ch)
    }
  }, [id, load, userId])

  useEffect(() => { load() }, [pendingVersion, load])

  const name = (uid: string) => (uid === userId ? 'You' : members.find((m) => m.id === uid)?.name ?? '?')
  const bal = useMemo(() => netBalances(expenses, settlements), [expenses, settlements])
  const transfers = useMemo(() => simplifyDebts(bal), [bal])
  const money = (n: number) => `${n.toFixed(2)} ${group?.currency ?? ''}`
  const mine = (bal[userId] ?? 0) / 100

  if (!group) return <p className="center muted">Loading…</p>
  const link = `${location.origin}/join/${group.invite_code}`

  async function settle(from: string, to: string, amount: number) {
    const { error } = await supabase.from('settlements').insert({ group_id: id, from_user: from, to_user: to, amount })
    if (error) { alert(error.message); return }
    setSettling(null)
    load()
  }
  async function retryPendingSync() {
    if (syncingPending) return
    setSyncingPending(true)
    setPendingSyncMessage('')
    try {
      await syncPendingExpenses(userId, id)
      await load()
      if (pendingExpenses(id!, userId).length > 0) {
        setPendingSyncMessage(navigator.onLine ? 'Sync failed. Please try again.' : 'You are offline. Connect to the internet and try again.')
      }
    } catch {
      setPendingSyncMessage('Sync failed. Please try again.')
    } finally {
      setSyncingPending(false)
    }
  }
  async function revertPayment(s: Settlement) {
    if (!confirm(`Revert payment: ${name(s.from_user)} paid ${name(s.to_user)} ${money(s.amount)}?`)) return
    const { error } = await supabase.from('settlements').delete().eq('id', s.id)
    if (error) alert(error.message)
    load()
  }
  async function remove(eid: string) {
    if (!confirm('Delete this expense?')) return
    await supabase.from('expenses').delete().eq('id', eid)
    setEditing(null)
    load()
  }
  async function restore(aid: string) {
    const { error } = await supabase.rpc('restore_expense', { aid })
    if (error) alert(error.message)
    load()
  }
  async function deleteGroup() {
    if (!group) return
    if (!confirm(`Delete “${group.name}” and all its expenses, history, and receipt attachments? This cannot be undone.`)) return
    try {
      await deleteGroupReceipts(group.id)
      const { error } = await supabase.from('groups').delete().eq('id', group.id)
      if (error) throw error
      nav('/')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not delete group')
    }
  }
  async function saveGroupSettings(event: React.FormEvent) {
    event.preventDefault()
    if (!group) return
    const { error } = await supabase.from('groups').update({
      name: groupName.trim(), icon: groupIcon, icon_color: groupIconColor, currency: groupCurrency.toUpperCase(), local_currency: groupLocalCurrency.toUpperCase(),
    }).eq('id', group.id)
    if (error) return alert(error.message)
    setSettingsOpen(false)
    load()
  }
  async function addGuest() {
    if (!guestName.trim()) return
    const { error } = await supabase.rpc('add_guest_member', {
      gid: group!.id, guest_name: guestName.trim(), guest_avatar: guestAvatar,
    })
    if (error) return alert(error.message)
    setGuestName('')
    setGuestAvatar(null)
    await load()
  }
  async function createPublicShare() {
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
    const { data, error } = await supabase.rpc('set_public_group_share', { gid: group!.id, pin })
    if (error) return alert(error.message)
    const url = `${location.origin}/share/${data}`
    setShareUrl(url)
    setSharePin(pin)
    await navigator.clipboard?.writeText(url)
  }
  async function disablePublicShare() {
    const { error } = await supabase.rpc('disable_public_group_share', { gid: group!.id })
    if (error) return alert(error.message)
    setShareUrl('')
    setSharePin('')
  }
  async function toggleGroupSettings() {
    const currentGroup = group
    if (!currentGroup) return
    const opening = !settingsOpen
    setSettingsOpen(opening)
    if (!opening) return
    setSettingsTab('general')
    setGroupName(currentGroup.name)
    setGroupIcon(currentGroup.icon || 'Users')
    setGroupIconColor(currentGroup.icon_color)
    setGroupCurrency(currentGroup.currency)
    setGroupLocalCurrency(currentGroup.local_currency)
    setSharePin('')
    const { data, error } = await supabase.rpc('get_public_group_share_id', { gid: currentGroup.id })
    if (error) return alert(error.message)
    setShareUrl(data ? `${location.origin}/share/${data}` : '')
  }
  // transaction date, then the time it was entered
  const availableDates = [...new Set(expenses.map((e) => e.spent_on))].sort((a, b) => b.localeCompare(a))
  const shown = expenses
    .filter((e) => (!payer || e.paid_by === payer) && (selectedDates === null || selectedDates.includes(e.spent_on)) && e.description.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (a.spent_on + a.created_at).localeCompare(b.spent_on + b.created_at) * (newestFirst ? -1 : 1))
  const pending = pendingExpenses(id!, userId)

  return (
    <>
      <button className="groupTitle" onClick={() => void toggleGroupSettings()}><span className="groupIconBadge" style={{ background: group.icon_color || `hsl(${hue(group.name)} 60% 88%)`, color: GROUP_COLORS.find((c) => c.background === group.icon_color)?.foreground || `hsl(${hue(group.name)} 45% 30%)` }}><GroupIcon name={group.icon} size={21} /></span> {group.name} <span aria-hidden="true">⚙</span></button>
      {pending.length > 0 && <div className="offlineNotice"><button className="offlineSyncButton" type="button" onClick={() => void retryPendingSync()} disabled={syncingPending} aria-label="Retry syncing saved expenses" title="Retry sync"><RefreshCw size={17} className={syncingPending ? 'spinning' : ''} /></button><span>{pending.length} {pending.length === 1 ? 'expense is' : 'expenses are'} saved on this device and waiting to sync.{pendingSyncMessage && <><br /><span>{pendingSyncMessage}</span></>}</span></div>}
      {settingsOpen && (
        <section className="card groupSettings">
          <div className="settingsHeading"><div><h3>Group settings</h3><small className="muted">Manage your group in one place</small></div><button type="button" className="link" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>Close</button></div>
          <div className="settingsTabs" role="tablist" aria-label="Group settings sections">
            {(['general', 'members', 'sharing', 'danger'] as const).map((key) => <button type="button" role="tab" aria-selected={settingsTab === key} className={settingsTab === key ? 'on' : ''} key={key} onClick={() => setSettingsTab(key)}>{({ general: 'General', members: 'Members', sharing: 'Sharing', danger: 'Danger zone' })[key]}</button>)}
          </div>
          {settingsTab === 'general' && <form className="settingsPanel" onSubmit={saveGroupSettings}>
            {group.created_by === userId ? <>
            <h4>Group details</h4>
            <label>Group name<input value={groupName} onChange={(e) => setGroupName(e.target.value)} required /></label>
            <GroupIconPicker value={groupIcon} onChange={setGroupIcon} color={groupIconColor} onColorChange={setGroupIconColor} />
            <div className="settingsCurrencyGrid"><label>Settlement currency<input value={groupCurrency} onChange={(e) => setGroupCurrency(e.target.value.toUpperCase())} maxLength={3} minLength={3} required /></label><label>Local currency<input value={groupLocalCurrency} onChange={(e) => setGroupLocalCurrency(e.target.value.toUpperCase())} maxLength={3} minLength={3} required /></label></div>
            <div className="row settingsActions"><button type="submit">Save changes</button><button type="button" className="link" onClick={() => setSettingsOpen(false)}>Cancel</button></div>
            </> : <p className="muted">Only the group creator can change group details.</p>}
          </form>}
          {settingsTab === 'members' && <div className="settingsPanel">
            <h4>Invite friends</h4>
            <p className="muted settingsDescription">Share this link or invite code <b>{group.invite_code}</b> with your group.</p>
            <div className="row"><input aria-label="Group invite link" readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" onClick={() => void navigator.clipboard?.writeText(link)}>Copy</button></div>
            <h4>Members</h4><div className="memberList settingsMemberList">{members.map((m) => <div className="memberItem" key={m.id}><Avatar name={m.name} k={m.avatar_key} size={30} /><span>{m.id === userId ? 'You' : m.name}</span></div>)}</div>
            {group.created_by === userId && <div className="publicShareForm">
              <b>Add someone without an account</b>
              <small className="muted">Guests appear in expense and split lists. They can view expenses using your public link and PIN.</small>
              <div>
                <label>Guest name<input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={60} required /></label>
                <div className="avatarPickerHeading"><Avatar name={guestName || 'Guest'} k={guestAvatar} size={48} /><span>Choose an avatar</span></div>
                <div className="avatarChoices">
                  <button type="button" className={`avatarChoice${guestAvatar === null ? ' selected' : ''}`} aria-label="Use initial" onClick={() => setGuestAvatar(null)}><Avatar name={guestName || 'Guest'} size={42} /></button>
                  {AVATAR_PRESETS.map((preset) => { const key = presetAvatarKey(preset.id); return <button type="button" key={preset.id} className={`avatarChoice${guestAvatar === key ? ' selected' : ''}`} aria-label={preset.title} onClick={() => setGuestAvatar(key)}><Avatar name={guestName || 'Guest'} k={key} size={42} /></button> })}
                </div>
                <button type="button" onClick={() => void addGuest()} disabled={!guestName.trim()}>Add guest</button>
              </div>
            </div>}
          </div>}
          {settingsTab === 'sharing' && <div className="settingsPanel">
            {group.created_by === userId ? <>
            <h4>Public expense sharing</h4>
            <p className="muted settingsDescription">Anyone with the link and 6 digit PIN can view expenses. Balances and settle up are hidden.</p>
            <div className="publicShareForm">
              <div className="row"><Share2 size={18} /><b>Share expenses publicly</b></div>
              {shareUrl ? <>
                <small className="muted">Public link</small>
                <div className="row"><input readOnly value={shareUrl} onFocus={(e) => e.target.select()} /><button type="button" onClick={() => void navigator.clipboard?.writeText(shareUrl)}>Copy</button></div>
                {sharePin && <div className="sharePinDisplay">PIN to share: <b>{sharePin}</b><button type="button" onClick={() => void navigator.clipboard?.writeText(sharePin)}>Copy PIN</button></div>}
                {!sharePin && <small className="muted">PINs cannot be recovered. Rotate the PIN to create a new one.</small>}
                <button type="button" onClick={() => void createPublicShare()}>Rotate PIN</button>
                <button type="button" className="danger" onClick={disablePublicShare}>Turn off public sharing</button>
              </> : <button type="button" onClick={() => void createPublicShare()}>Create share link and PIN</button>}
            </div>
            </> : <p className="muted">Only the group creator can manage public sharing.</p>}
          </div>}
          {settingsTab === 'danger' && <div className="settingsPanel dangerPanel"><h4>Delete group</h4><p className="muted settingsDescription">Permanently remove the group, its expenses, history, and receipt attachments.</p>{group.created_by === userId ? <button type="button" className="danger" onClick={deleteGroup}>Delete group</button> : <p className="muted">Only the group creator can delete this group.</p>}</div>}
        </section>
      )}
      <div className={`overallLine ${mine >= 0 ? 'posText' : 'owe'}`}>
        {Math.abs(mine) < 0.005 ? 'You are settled up' : mine > 0 ? `You are owed ${money(mine)} overall` : `You owe ${money(-mine)} overall`}
      </div>
      {transfers.filter((t) => t.from === userId || t.to === userId).map((t, i) => (
        <div key={i} className="muted">
          {t.to === userId ? `${name(t.from)} owes you` : `You owe ${name(t.to)}`}{' '}
          <span className={t.to === userId ? 'posText' : 'owe'}>{money(t.amount)}</span>
        </div>
      ))}

      <div className="chips">
        <button className="settleBtn" onClick={() => setTab('balances')}>Settle up</button>
        <button className={tab === 'expenses' ? 'on' : ''} onClick={() => setTab('expenses')}>Expenses</button>
        <button className={tab === 'balances' ? 'on' : ''} onClick={() => setTab('balances')}>Balances</button>
        <button className={tab === 'billing' ? 'on' : ''} onClick={() => setTab('billing')}>Billing</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
      </div>

      {tab === 'billing' && <Billing expenses={expenses} settlements={settlements} group={group} members={members} name={name} />}

      {tab === 'expenses' && (
        <>
          <button className="fab" onClick={() => setAdding(true)}>+ Add expense</button>
          {expenses.length === 0 && <p className="muted">No expenses yet.</p>}
          {expenses.length > 0 && (
            <div className="row expenseFiltersRow">
              <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="">Paid by: anyone</option>
                {members.map((m) => <option key={m.id} value={m.id}>{name(m.id)}</option>)}
              </select>
              <select value={newestFirst ? 'desc' : 'asc'} onChange={(e) => setNewestFirst(e.target.value === 'desc')}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
              <div className="expenseDateFilterMenu">
                <button type="button" className={`expenseDateFilterButton${selectedDates !== null ? ' active' : ''}`} aria-label="Filter by date" aria-expanded={dateFilterOpen} onClick={() => setDateFilterOpen(!dateFilterOpen)}><CalendarDays size={19} />{selectedDates !== null && <span>{selectedDates.length}</span>}</button>
                {dateFilterOpen && <fieldset className="expenseDateFilters">
                  <legend>Filter by date</legend>
                  <div className="expenseDateOptions">
                    {availableDates.map((date) => {
                      const [year, month, day] = date.split('-')
                      return <label key={date}><input type="checkbox" checked={selectedDates === null || selectedDates.includes(date)} onChange={(event) => {
                        const next = selectedDates === null ? availableDates.filter((d) => d !== date) : event.target.checked ? [...selectedDates, date] : selectedDates.filter((d) => d !== date)
                        setSelectedDates(next.length === availableDates.length ? null : next)
                      }} />{`${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`}</label>
                    })}
                  </div>
                </fieldset>}
              </div>
            </div>
          )}
          {expenses.length > 0 && shown.length === 0 && <p className="muted">No matching expenses.</p>}
          {shown.map((e, i) => {
            const myShare = e.expense_splits.find((s) => s.user_id === userId)?.share ?? 0
            // what this expense does to my balance: lent if I paid, borrowed if someone else did
            const delta = e.paid_by === userId ? e.amount - myShare : -myShare
            const month = e.spent_on.slice(0, 7)
            const newMonth = i === 0 || shown[i - 1].spent_on.slice(0, 7) !== month
            return (
              <div key={e.id}>
                {newMonth && <div className="month">{MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</div>}
                <div className="exp clickable" onClick={() => setViewing(e)}>
                  <div className="date">
                    <span>{MONTHS[Number(e.spent_on.slice(5, 7)) - 1]}</span>
                    <span className="day">{e.spent_on.slice(8, 10)}</span>
                  </div>
                  <div className="tile" style={{ background: `hsl(${hue(e.description)} 60% 88%)`, color: `hsl(${hue(e.description)} 45% 30%)` }}>
                    {catEmoji(e.category) ?? e.description.trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="grow">
                    <div className="title">{e.description}{pending.some((item) => item.id === e.id) && <span className="pendingBadge">Waiting to sync</span>}</div>
                    <div className="muted small">
                      {name(e.paid_by)} paid {money(e.amount)}
                      {e.local_amount != null && e.local_currency !== group.currency && (
                        <> · {e.local_amount.toFixed(2)} {e.local_currency} @ {e.fx_rate}</>
                      )}
                    </div>
                  </div>
                  <div className="right small">
                    {Math.abs(delta) < 0.005 ? (
                      <span className="muted">not involved</span>
                    ) : (
                      <span className={delta > 0 ? 'posText' : 'owe'}>
                        {delta > 0 ? 'you lent' : 'you borrowed'}
                        <div className="amt">{money(Math.abs(delta))}</div>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </>
      )}

      {tab === 'balances' && (
        <>
          <h3>Who owes who</h3>
          {transfers.length === 0 && <p className="muted">Everyone is settled up 🎉</p>}
          {transfers.map((t, i) => (
            <div key={i} className="card row">
              <span>{name(t.from)} → {name(t.to)}: <b>{money(t.amount)}</b></span>
              {t.from === userId && <button onClick={() => {
                const recipient = members.find((m) => m.id === t.to)
                if (recipient) setSettling({ transfer: t, recipient })
              }}>Settle</button>}
            </div>
          ))}
          <h3>Net balances</h3>
          {members.map((m) => {
            const b = (bal[m.id] ?? 0) / 100
            return (
              <div key={m.id} className="row small">
                <span>{name(m.id)}</span>
                <span className={b >= 0 ? 'posText' : 'negText'}>{b >= 0 ? '+' : ''}{money(b)}</span>
              </div>
            )
          })}
          {settlements.length > 0 && (
            <>
              <h3>Payments made</h3>
              {settlements.map((s) => (
                <div key={s.id} className="row small">
                  <div className="settlementEntry">
                    <span className="muted">{name(s.from_user)} paid {name(s.to_user)} {money(s.amount)} · {s.created_at.slice(0, 10)}</span>
                    {s.receipt_key ? <ReceiptThumb k={s.receipt_key} /> : s.from_user === userId ? <><small className="muted">Add payment receipt (stored in monochrome).</small><ReceiptField groupId={group.id} value={null} onChange={async (key) => {
                      const { error } = await supabase.from('settlements').update({ receipt_key: key }).eq('id', s.id)
                      if (error) alert(error.message)
                      load()
                    }} /></> : null}
                  </div>
                  <button className="link danger" onClick={() => revertPayment(s)}>Revert</button>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {settling && <PayNowDialog recipient={settling.recipient} amount={settling.transfer.amount} currency={group.currency}
        onCancel={() => setSettling(null)} onPaid={() => void settle(settling.transfer.from, settling.transfer.to, settling.transfer.amount)} />}

      {tab === 'history' && (
        <>
          {audit.length === 0 && <p className="muted">No activity recorded yet.</p>}
          <div className="timeline">
            {audit.map((a, i) => {
              const canRestore = a.entity === 'expense' && a.action === 'deleted' && !expenses.some((e) => e.id === a.entity_id)
              const day = new Date(a.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
              const newDay = i === 0 || new Date(audit[i - 1].created_at).toLocaleDateString() !== new Date(a.created_at).toLocaleDateString()
              return (
                <div key={a.id}>
                  {newDay && <div className="tlDay">{day}</div>}
                  <div className="tlItem">
                    <span className={`dot ${a.action}`} />
                    <div className="small muted">{new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div>
                      <b>{a.actor_id ? name(a.actor_id) : 'Someone'}</b> {a.action} {a.entity === 'expense' ? 'expense' : 'a'} <b>{a.summary}</b>
                    </div>
                    {a.details && a.action === 'updated' && a.old_details ? (
                      <Changes before={a.old_details} after={a.details} name={name} cur={group.currency} />
                    ) : (
                      a.details && <Snapshot d={a.details} name={name} cur={group.currency} />
                    )}
                    {canRestore && a.details && <button onClick={() => restore(a.id)}>Restore this expense</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {viewing && (
        <ExpenseDetail
          e={viewing}
          group={group}
          name={name}
          audit={audit}
          userId={userId}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null) }}
          onDelete={async () => { await remove(viewing.id); setViewing(null) }}
        />
      )}

      {(adding || editing) && (
        <ExpenseForm
          group={group}
          members={members}
          userId={userId}
          expense={editing}
          onDelete={editing ? () => remove(editing.id) : undefined}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSaved={() => { setAdding(false); setEditing(null); load() }}
        />
      )}
    </>
  )
}

type NameFn = (id: string) => string

function ExpenseDetail(p: {
  e: Expense
  group: Group
  name: NameFn
  audit: AuditEntry[]
  userId: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { e, group } = p
  const userIdOf = p.userId
  const money = (n: number) => `${n.toFixed(2)} ${group.currency}`
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const mine = p.audit.filter((a) => a.entity === 'expense' && a.entity_id === e.id)
  const added = mine.find((a) => a.action === 'created')
  const updated = mine.find((a) => a.action === 'updated')
  const who = (a?: AuditEntry) => (a?.actor_id ? p.name(a.actor_id) : 'someone').toLowerCase()
  const others = e.expense_splits.filter((s) => s.user_id !== e.paid_by)
  const history = mine.slice().reverse()
  return (
    <div className="modal" onClick={p.onClose}>
      <div className="card sheet" onClick={(ev) => ev.stopPropagation()}>
        <div className="row">
          <button className="link" onClick={p.onClose}>← Back</button>
          <span className="inline">
            <button className="link" onClick={p.onEdit}>Edit</button>
            <button className="link danger" onClick={p.onDelete}>Delete</button>
          </span>
        </div>
        <div className="tile big" style={{ background: `hsl(${hue(e.description)} 60% 88%)`, color: `hsl(${hue(e.description)} 45% 30%)` }}>
          {catEmoji(e.category) ?? e.description.trim().charAt(0).toUpperCase()}
        </div>
        <h3 style={{ margin: 0 }}>{e.description}</h3>
        <div className="bigAmt">{money(e.amount)}</div>
        {e.local_amount != null && e.local_currency !== group.currency && (
          <div className="muted small">{e.local_amount.toFixed(2)} {e.local_currency} @ {e.fx_rate}</div>
        )}
        <div className="muted small">
          <div>{day(e.spent_on + 'T00:00:00')}</div>
          <div>Added by {added ? who(added) : 'unknown'} on {day(added?.created_at ?? e.created_at)}</div>
          {updated && <div>Updated by {who(updated)} on {day(updated.created_at)}</div>}
        </div>
        {e.receipt_key && <ReceiptThumb k={e.receipt_key} className="receiptFull" />}
        <div className="paidTree">
          <div><b>{p.name(e.paid_by)}</b> paid {money(e.amount)}</div>
          {others.map((s) => (
            <div key={s.user_id} className="branch">{s.user_id === userIdOf ? 'You owe' : `${p.name(s.user_id)} owes`} {money(s.share)}</div>
          ))}
        </div>
        {history.length > 0 && (
          <>
            <div className="month">Activity</div>
            {history.map((a) => (
              <div key={a.id} className="small muted">{new Date(a.created_at).toLocaleString()} · {who(a)} {a.action}</div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export const CATEGORIES = [
  { id: 'food', emoji: '🍽️', label: 'Food & Drinks' },
  { id: 'groceries', emoji: '🛒', label: 'Groceries' },
  { id: 'transport', emoji: '🚕', label: 'Transport' },
  { id: 'flights', emoji: '✈️', label: 'Flights' },
  { id: 'stay', emoji: '🏨', label: 'Stay' },
  { id: 'activities', emoji: '🎟️', label: 'Tickets & Activities' },
  { id: 'shopping', emoji: '🛍️', label: 'Shopping' },
  { id: 'fuel', emoji: '⛽', label: 'Petrol & Toll' },
  { id: 'other', emoji: '📦', label: 'Other' },
]
const catEmoji = (id: string | null | undefined) => CATEGORIES.find((c) => c.id === id)?.emoji
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// stable pastel colour per description for the row tile
export const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

function Snapshot({ d, name, cur }: { d: Details; name: NameFn; cur: string }) {
  if (d.from_user) return <div className="small muted">{name(d.from_user)} → {name(d.to_user!)}: {d.amount.toFixed(2)} {cur}</div>
  return (
    <div className="small muted">
      <div>
        {d.amount.toFixed(2)} {cur}
        {d.local_amount != null && d.local_currency !== cur && <> ({d.local_amount.toFixed(2)} {d.local_currency} @ {d.fx_rate})</>}
        {d.spent_on && <> · {d.spent_on}</>}
      </div>
      {d.paid_by && <div>Paid by {name(d.paid_by)}</div>}
      {d.splits && d.splits.length > 0 && (
        <div>Shared: {d.splits.map((s) => `${name(s.user_id)} ${s.share.toFixed(2)}`).join(', ')}</div>
      )}
    </div>
  )
}

function Changes({ before, after, name, cur }: { before: Details; after: Details; name: NameFn; cur: string }) {
  const show = (k: string, d: Details): string => {
    if (k === 'splits') return (d.splits ?? []).map((s) => `${name(s.user_id)} ${s.share.toFixed(2)}`).join(', ')
    const v = d[k as keyof Details]
    if (v == null) return '–'
    if (k === 'receipt_key') return v ? 'attached' : '–'
    return k === 'paid_by' ? name(String(v)) : k === 'amount' ? `${Number(v).toFixed(2)} ${cur}` : String(v)
  }
  const keys = ['description', 'amount', 'paid_by', 'spent_on', 'local_amount', 'local_currency', 'fx_rate', 'category', 'receipt_key', 'splits']
  const diff = keys.filter((k) => show(k, before) !== show(k, after))
  return (
    <div className="small muted">
      {diff.length === 0 && 'No visible changes'}
      {diff.map((k) => (
        <div key={k}>{k === 'splits' ? 'shared' : k}: {show(k, before)} → {show(k, after)}</div>
      ))}
    </div>
  )
}

function ExpenseForm(p: {
  group: Group
  members: Profile[]
  userId: string
  expense: Expense | null
  onDelete?: () => void
  onClose: () => void
  onSaved: () => void
}) {
  const ex = p.expense
  const settleCur = p.group.currency
  const hasFx = p.group.local_currency !== settleCur
  // editing a converted expense: keep its original local amount and FX rate
  const exForeign = !!ex && ex.local_amount != null && !!ex.local_currency && ex.local_currency !== settleCur
  const [desc, setDesc] = useState(ex?.description ?? '')
  const [amount, setAmount] = useState(ex ? String(exForeign ? ex.local_amount : ex.amount) : '')
  const [date, setDate] = useState(ex?.spent_on ?? new Date().toISOString().slice(0, 10))
  const [paidBy, setPaidBy] = useState(ex?.paid_by ?? p.userId)
  const [category, setCategory] = useState<string | null>(ex?.category ?? null)
  const [receipt, setReceipt] = useState<string | null>(ex?.receipt_key ?? null)
  const dateRef = useRef<HTMLInputElement>(null)
  // stored splits are in the settlement currency: exact amounts if unconverted, else proportional weights
  const [mode, setMode] = useState<SplitMode>(ex ? (exForeign ? 'shares' : 'exact') : 'equal')
  const [included, setIncluded] = useState<Record<string, boolean>>(
    Object.fromEntries(p.members.map((m) => [m.id, ex ? ex.expense_splits.some((s) => s.user_id === m.id) : true])),
  )
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries((ex?.expense_splits ?? []).map((s) => [s.user_id, String(s.share)])),
  )
  const [err, setErr] = useState('')

  // 'local' = amount typed in the trip's local currency and converted via FX; 'settlement' = no conversion
  const [entry, setEntry] = useState<'local' | 'settlement'>(ex ? (exForeign ? 'local' : 'settlement') : hasFx ? 'local' : 'settlement')
  const [liveRate, setLiveRate] = useState<number | null>(null)
  const [manualRate, setManualRate] = useState(exForeign ? String(ex.fx_rate) : '')
  const [override, setOverride] = useState(exForeign)
  const [rateLoading, setRateLoading] = useState(false)
  const foreign = hasFx && entry === 'local'
  const entryCur = foreign ? p.group.local_currency : settleCur

  useEffect(() => {
    if (!foreign) return
    let live = true
    setRateLoading(true)
    fetchRate(p.group.local_currency, settleCur).then((r) => {
      if (!live) return
      setLiveRate(r)
      setRateLoading(false)
    })
    return () => { live = false }
  }, [foreign, p.group.local_currency, settleCur])

  const total = parseFloat(amount) || 0
  // manual entry is opt-in, but forced when no live rate could be fetched
  const manual = override || (!rateLoading && liveRate === null)
  const fxRate = manual ? parseFloat(manualRate) || 0 : liveRate ?? 0
  const settleTotal = foreign ? Math.round(total * fxRate * 100) / 100 : total

  function buildSplits() {
    const ids = p.members.filter((m) => included[m.id]).map((m) => m.id)
    if (ids.length === 0) throw new Error('Select at least one person')
    if (mode === 'equal') return splitEqually(total, ids)
    const nums = Object.fromEntries(ids.map((i) => [i, parseFloat(vals[i]) || 0]))
    if (mode === 'exact') {
      const sum = ids.reduce((a, i) => a + nums[i], 0)
      if (Math.abs(sum - total) > 0.005) throw new Error(`Amounts add up to ${sum.toFixed(2)}, expected ${total.toFixed(2)} ${entryCur}`)
      return ids.map((i) => ({ user_id: i, share: nums[i] }))
    }
    if (mode === 'percent') {
      const sum = ids.reduce((a, i) => a + nums[i], 0)
      if (Math.abs(sum - 100) > 0.005) throw new Error(`Percentages add up to ${sum}, expected 100`)
    }
    if (ids.every((i) => nums[i] <= 0)) throw new Error('Enter at least one value')
    return splitByWeights(total, nums)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      if (total <= 0) throw new Error('Enter an amount')
      if (foreign && fxRate <= 0) throw new Error('Enter an FX rate')
      if (settleTotal <= 0) throw new Error('Converted amount is too small')
      let splits = buildSplits()
      // splits are entered in the entry currency; store them in the settlement currency
      if (foreign) {
        splits = splitByWeights(settleTotal, Object.fromEntries(splits.map((s) => [s.user_id, s.share])))
      }
      const row = {
        description: desc,
        amount: settleTotal,
        paid_by: paidBy,
        spent_on: date,
        local_amount: total,
        local_currency: entryCur,
        fx_rate: foreign ? fxRate : 1,
        category,
        receipt_key: receipt,
      }
      if (!ex && !navigator.onLine) {
        await queueExpense({ id: crypto.randomUUID(), groupId: p.group.id, userId: p.userId, fields: row, splits, savedAt: new Date().toISOString() })
        p.onSaved()
        return
      }
      const { error } = await supabase.rpc('save_expense', { eid: ex?.id ?? null, gid: p.group.id, fields: row, splits })
      if (error) {
        const networkFailure = !navigator.onLine || /fetch|network|connection/i.test(error.message)
        if (!ex && networkFailure) {
          await queueExpense({ id: crypto.randomUUID(), groupId: p.group.id, userId: p.userId, fields: row, splits, savedAt: new Date().toISOString() })
          p.onSaved()
          return
        }
        throw error
      }
      p.onSaved()
    } catch (x) {
      setErr((x as Error).message)
    }
  }

  const unit = mode === 'percent' ? '%' : mode === 'shares' ? 'shares' : ''

  return (
    <div className="modal" onClick={p.onClose}>
      <form className="card sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="expenseFormHeading">
          <div className="expenseFormTitle">
            <div className="expenseCategoryIcon" aria-hidden="true">{catEmoji(category) ?? '🧾'}</div>
            <div><h3>{ex ? 'Edit expense' : 'Add expense'}</h3><span className="muted small">{p.group.name}</span></div>
          </div>
          <div className="dateField expenseDateField">
            <button type="button" className="dateBtn" onClick={() => dateRef.current?.showPicker?.()}>
              📅 {MONTHS[Number(date.slice(5, 7)) - 1]}-{date.slice(8, 10)}
            </button>
            <input ref={dateRef} className="dateHidden" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
        </div>
        <div className="expenseCategoryPicker" aria-label="Expense category">
          {CATEGORIES.map((c) => <button type="button" key={c.id} className={category === c.id ? 'selected' : ''} aria-label={c.label} title={c.label} onClick={() => setCategory(category === c.id ? null : c.id)}>{c.emoji}</button>)}
        </div>
        <div className="expensePrimaryFields">
          <input className="expenseDescription" placeholder="What was this for?" value={desc} onChange={(e) => setDesc(e.target.value)} required />
          <div className="expenseAmountField"><span>{entryCur}</span><input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        </div>
        {hasFx && (
          <label>Currency
            <select value={entry} onChange={(e) => setEntry(e.target.value as 'local' | 'settlement')}>
              <option value="local">Local – {p.group.local_currency} (convert to {settleCur})</option>
              <option value="settlement">Settlement – {settleCur}</option>
            </select>
          </label>
        )}
        {foreign && (
          <div>
            <label>FX rate (1 {entryCur} = ? {settleCur})
              <input
                type="number" step="any" min="0" inputMode="decimal"
                placeholder={rateLoading ? 'Fetching rate…' : 'Enter rate'}
                value={manual ? manualRate : liveRate ?? ''}
                readOnly={!manual}
                onChange={(e) => setManualRate(e.target.value)}
                required
              />
            </label>
            {liveRate !== null && (
              <label className="check">
                <input
                  type="checkbox" checked={override}
                  onChange={(e) => {
                    setOverride(e.target.checked)
                    if (e.target.checked && !manualRate) setManualRate(String(liveRate))
                  }}
                />
                Override rate
              </label>
            )}
            {!rateLoading && liveRate === null && <small className="muted">Live rate unavailable, enter it manually.</small>}
            {settleTotal > 0 && <small className="muted">≈ {settleTotal.toFixed(2)} {settleCur}</small>}
          </div>
        )}
        <div className="expenseMetaRow">
        <ReceiptField groupId={p.group.id} value={receipt} onChange={setReceipt} />
        </div>
        <section className="expenseSplitSection">
        <label>Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {p.members.map((m) => <option key={m.id} value={m.id}>{m.id === p.userId ? 'You' : m.name}</option>)}
          </select>
        </label>
        <label>Split
          <select value={mode} onChange={(e) => setMode(e.target.value as SplitMode)}>
            <option value="equal">Equally</option>
            <option value="exact">Exact amounts</option>
            <option value="percent">Percentages</option>
            <option value="shares">Shares</option>
          </select>
        </label>
        <div className="splitMembers">
          {p.members.map((m) => {
            const selected = !!included[m.id]
            const name = m.id === p.userId ? 'You' : m.name
            return (
              <div key={m.id} className={`splitMember${selected ? ' selected' : ''}`}>
                <button type="button" className="splitMemberChoice" aria-pressed={selected} onClick={() => setIncluded({ ...included, [m.id]: !selected })}>
                  <span className="splitMemberAvatar"><Avatar name={name} k={m.avatar_key} size={52} /><span className="splitMemberCheck" aria-hidden="true">{selected ? '✓' : ''}</span></span>
                  <span className="splitMemberName">{name}</span>
                </button>
                {mode !== 'equal' && selected && (
                  <span className="splitMemberValue"><input aria-label={`${name} ${unit || 'amount'}`} type="number" step="0.01" min="0" inputMode="decimal" value={vals[m.id] ?? ''} onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} />{unit}</span>
                )}
              </div>
            )
          })}
        </div>
        </section>
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button type="button" className="link" onClick={p.onClose}>Cancel</button>
          {p.onDelete && <button type="button" className="link danger" onClick={p.onDelete}>Delete</button>}
          <button>Save</button>
        </div>
      </form>
    </div>
  )
}
