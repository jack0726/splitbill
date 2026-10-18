-- SplitBill schema. Paste the WHOLE file into Supabase Dashboard -> SQL Editor and run it.
-- It is idempotent: safe to re-run any number of times, on a fresh or an existing database,
-- and it never deletes data. When the schema changes, edit this file in place and run it again.

-- ───────────────────────── tables ─────────────────────────

create table if not exists public.profiles (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- Profiles can also represent a guest who has no auth.users account.
alter table public.profiles drop constraint if exists profiles_id_fkey;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null default 'Users',
  icon_color text,
  description text,
  start_date date,
  end_date date,
  currency text not null default 'SGD',        -- settlement currency
  local_currency text not null default 'SGD',  -- currency spent while travelling
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- PIN protected, read-only public expense shares. The random share id is part of the URL;
-- the PIN hash is never exposed through table policies or RPC results.
create table if not exists public.public_group_shares (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null unique references public.groups(id) on delete cascade,
  pin_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.public_group_shares enable row level security;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_by uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  spent_on date not null default current_date,
  created_at timestamptz not null default now()
);

-- one row per person who owes part of an expense
create table if not exists public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  share numeric(12,2) not null check (share >= 0),
  primary key (expense_id, user_id)
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  receipt_key text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null check (entity in ('expense', 'settlement')),
  entity_id uuid not null,
  summary text not null,
  created_at timestamptz not null default now()
);

-- columns added after the first version (no-ops on a fresh database that already has them)
alter table public.groups add column if not exists local_currency text not null default 'SGD';
alter table public.groups add column if not exists icon text not null default 'Users';
alter table public.groups add column if not exists icon_color text;
alter table public.groups add column if not exists description text;
alter table public.groups add column if not exists start_date date;
alter table public.groups add column if not exists end_date date;
alter table public.groups alter column currency set default 'SGD';

-- amount/splits are always in the group's settlement currency; these keep the original entry
alter table public.expenses add column if not exists local_amount numeric(12,2);
alter table public.expenses add column if not exists local_currency text;
alter table public.expenses add column if not exists fx_rate numeric(18,8);  -- settlement units per 1 local unit
alter table public.expenses add column if not exists updated_at timestamptz;
alter table public.expenses add column if not exists category text;
alter table public.profiles add column if not exists avatar_key text;        -- R2 object key: avatars/<user id>/<uuid>.jpg
alter table public.profiles add column if not exists paynow_mobile text;    -- optional Singapore mobile proxy, stored in +65 format
alter table public.settlements add column if not exists receipt_key text;   -- R2 key for proof of payment
alter table public.expenses add column if not exists receipt_key text;       -- R2 object key: <group id>/<uuid>.jpg

alter table public.audit_log add column if not exists details jsonb;      -- state after (or before, for deletes)
alter table public.audit_log add column if not exists old_details jsonb;  -- state before, for updates
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('created', 'updated', 'deleted', 'restored'));
create index if not exists audit_log_group_idx on public.audit_log (group_id, created_at desc);

-- ───────────────────────── functions & triggers ─────────────────────────

-- helper: is the caller a member of this group? (security definer avoids RLS recursion)
create or replace function public.is_member(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

-- create profile automatically on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill profiles for users who signed up before the trigger existed
insert into public.profiles (id, name)
select id, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

-- creator becomes first member of a new group
create or replace function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id) values (new.id, new.created_by);
  return new;
end $$;

drop trigger if exists on_group_created on public.groups;
create trigger on_group_created after insert on public.groups
  for each row execute function public.add_creator_as_member();

-- join a group by invite code (the only way to add yourself)
create or replace function public.join_group(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  select id into gid from groups where invite_code = code;
  if gid is null then raise exception 'Invalid invite code'; end if;
  insert into group_members (group_id, user_id) values (gid, auth.uid())
    on conflict do nothing;
  return gid;
end $$;

-- Add a non-login guest profile to a group. Guests use normal profile IDs in expenses/splits.
create or replace function public.add_guest_member(gid uuid, guest_name text, guest_avatar text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare guest_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not exists (select 1 from groups where id = gid and created_by = auth.uid()) then
    raise exception 'Only the group creator can add guest members';
  end if;
  if length(trim(coalesce(guest_name, ''))) = 0 or length(trim(guest_name)) > 60 then
    raise exception 'Guest name must be between 1 and 60 characters';
  end if;
  if guest_avatar is not null and guest_avatar not in ('preset:lf-01','preset:lf-02','preset:lf-03','preset:lf-04','preset:lf-05','preset:lf-06','preset:lf-07','preset:lf-08') then
    raise exception 'Invalid guest avatar';
  end if;
  insert into profiles (id, name, avatar_key) values (guest_id, trim(guest_name), guest_avatar);
  insert into group_members (group_id, user_id) values (gid, guest_id);
  return guest_id;
end $$;

-- full state of an expense (incl. splits) as json, used by the audit log
create or replace function public.expense_snapshot(eid uuid)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(e) - 'created_by' - 'created_at' - 'updated_at'
    || jsonb_build_object('splits', coalesce((
         select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'share', s.share))
         from expense_splits s where s.expense_id = e.id), '[]'::jsonb))
  from expenses e where e.id = eid;
$$;

-- create (eid null) or edit an expense with its splits in one transaction, and log it
create or replace function public.save_expense(eid uuid, gid uuid, fields jsonb, splits jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  old_d jsonb;
  new_d jsonb;
  xid uuid := eid;
begin
  if not is_member(gid) then raise exception 'Not a member of this group'; end if;
  if fields->>'receipt_key' is not null and fields->>'receipt_key' not like gid::text || '/%' then
    raise exception 'Invalid receipt';
  end if;
  if xid is null or not exists (select 1 from expenses where id = xid and group_id = gid) then
    insert into expenses (id, group_id, description, amount, paid_by, spent_on, local_amount, local_currency, fx_rate, category, receipt_key)
    values (coalesce(xid, gen_random_uuid()), gid, fields->>'description', (fields->>'amount')::numeric, (fields->>'paid_by')::uuid,
            (fields->>'spent_on')::date, (fields->>'local_amount')::numeric, fields->>'local_currency',
            (fields->>'fx_rate')::numeric, fields->>'category', fields->>'receipt_key')
    returning id into xid;
  else
    old_d := expense_snapshot(xid);
    update expenses set description = fields->>'description', amount = (fields->>'amount')::numeric,
      paid_by = (fields->>'paid_by')::uuid, spent_on = (fields->>'spent_on')::date,
      local_amount = (fields->>'local_amount')::numeric, local_currency = fields->>'local_currency',
      fx_rate = (fields->>'fx_rate')::numeric, category = fields->>'category',
      receipt_key = fields->>'receipt_key', updated_at = now()
    where id = xid;
    delete from expense_splits where expense_id = xid;
  end if;
  insert into expense_splits (expense_id, user_id, share)
  select xid, x.user_id, x.share from jsonb_to_recordset(splits) as x(user_id uuid, share numeric);
  new_d := expense_snapshot(xid);
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details, old_details)
  values (gid, auth.uid(), case when old_d is null then 'created' else 'updated' end, 'expense', xid,
          new_d->>'description', new_d, old_d);
  return xid;
end $$;

-- log deletes with a snapshot taken before the splits cascade away
create or replace function public.log_expense_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details)
  values (old.group_id, auth.uid(), 'deleted', 'expense', old.id, old.description, expense_snapshot(old.id));
  return old;
end $$;

drop trigger if exists audit_expense_delete on public.expenses;
create trigger audit_expense_delete before delete on public.expenses
  for each row execute function public.log_expense_delete();

create or replace function public.log_settlement()
returns trigger language plpgsql security definer set search_path = public as $$
declare r settlements;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details)
  values (r.group_id, auth.uid(), case tg_op when 'DELETE' then 'deleted' else 'created' end, 'settlement',
          r.id, 'payment ' || r.amount, jsonb_build_object('from_user', r.from_user, 'to_user', r.to_user, 'amount', r.amount));
  return r;
end $$;

drop trigger if exists audit_settlements on public.settlements;
create trigger audit_settlements after insert or delete on public.settlements
  for each row execute function public.log_settlement();

-- old per-row diff logger, superseded by save_expense + the triggers above
drop trigger if exists audit_expenses on public.expenses;
drop function if exists public.log_audit();

-- undo an accidental delete: re-create the expense (same id) from its audit snapshot
create or replace function public.restore_expense(aid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a audit_log; d jsonb;
begin
  select * into a from audit_log where id = aid and entity = 'expense' and action = 'deleted';
  if a.id is null or not is_member(a.group_id) then raise exception 'Nothing to restore'; end if;
  if exists (select 1 from expenses where id = a.entity_id) then raise exception 'Already restored'; end if;
  d := a.details;
  insert into expenses (id, group_id, description, amount, paid_by, spent_on, local_amount, local_currency, fx_rate, category, receipt_key)
  values (a.entity_id, a.group_id, d->>'description', (d->>'amount')::numeric, (d->>'paid_by')::uuid,
          (d->>'spent_on')::date, (d->>'local_amount')::numeric, d->>'local_currency', (d->>'fx_rate')::numeric,
          d->>'category', d->>'receipt_key');
  insert into expense_splits (expense_id, user_id, share)
  select a.entity_id, x.user_id, x.share from jsonb_to_recordset(d->'splits') as x(user_id uuid, share numeric);
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details)
  values (a.group_id, auth.uid(), 'restored', 'expense', a.entity_id, a.summary, expense_snapshot(a.entity_id));
  return a.entity_id;
end $$;

-- Create/rotate a public share. Only the group creator can manage it.
create or replace function public.set_public_group_share(gid uuid, pin text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null or not exists (select 1 from groups where id = gid and created_by = auth.uid()) then
    raise exception 'Only the group creator can manage sharing';
  end if;
  if pin !~ '^[0-9]{6}$' then raise exception 'PIN must be 6 digits'; end if;
  sid := gen_random_uuid();
  insert into public_group_shares (id, group_id, pin_hash) values (sid, gid, md5(pin || ':' || sid::text))
  on conflict (group_id) do update set pin_hash = excluded.pin_hash, id = excluded.id, created_at = now()
  returning id into sid;
  return sid;
end $$;

create or replace function public.disable_public_group_share(gid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from groups where id = gid and created_by = auth.uid()) then
    raise exception 'Only the group creator can manage sharing';
  end if;
  delete from public_group_shares where group_id = gid;
end $$;

-- Let the group creator recover the active link after reopening settings. This reveals no PIN.
create or replace function public.get_public_group_share_id(gid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from groups where id = gid and created_by = auth.uid()) then
    raise exception 'Only the group creator can manage sharing';
  end if;
  return (select id from public_group_shares where group_id = gid);
end $$;

-- Verify the PIN before returning only the data needed to read expense history.
create or replace function public.read_public_group_share(share_id uuid, pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sh public_group_shares; g public.groups;
begin
  select * into sh from public_group_shares where id = share_id;
  if sh.id is null or pin !~ '^[0-9]{6}$' or sh.pin_hash <> md5(pin || ':' || sh.id::text) then
    raise exception 'Invalid share link or PIN';
  end if;
  select * into g from groups where id = sh.group_id;
  return jsonb_build_object(
    'name', g.name, 'currency', g.currency, 'local_currency', g.local_currency,
    'expenses', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'description', e.description, 'amount', e.amount, 'spent_on', e.spent_on,
      'local_amount', e.local_amount, 'local_currency', e.local_currency, 'fx_rate', e.fx_rate,
      'category', e.category, 'paid_by', coalesce(p.name, 'Unknown')
    ) order by e.spent_on desc, e.created_at desc)
      from expenses e left join profiles p on p.id = e.paid_by where e.group_id = g.id), '[]'::jsonb)
  );
end $$;

revoke all on public.public_group_shares from anon, authenticated;
grant execute on function public.set_public_group_share(uuid, text) to authenticated;
grant execute on function public.disable_public_group_share(uuid) to authenticated;
grant execute on function public.get_public_group_share_id(uuid) to authenticated;
grant execute on function public.read_public_group_share(uuid, text) to anon, authenticated;
grant execute on function public.add_guest_member(uuid, text, text) to authenticated;

-- ───────────────────────── row level security ─────────────────────────

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.audit_log enable row level security;

-- profiles: see yourself and people who share a group with you
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "groups read" on public.groups;
create policy "groups read" on public.groups for select to authenticated
  using (is_member(id) or created_by = auth.uid());
drop policy if exists "groups insert" on public.groups;
create policy "groups insert" on public.groups for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists "groups update" on public.groups;
create policy "groups update" on public.groups for update to authenticated
  using (is_member(id)) with check (is_member(id));
drop policy if exists "groups delete" on public.groups;
create policy "groups delete" on public.groups for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "members read" on public.group_members;
create policy "members read" on public.group_members for select to authenticated
  using (is_member(group_id));
drop policy if exists "members leave" on public.group_members;
create policy "members leave" on public.group_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "expenses read" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated
  using (is_member(group_id));
drop policy if exists "expenses insert" on public.expenses;
create policy "expenses insert" on public.expenses for insert to authenticated
  with check (is_member(group_id) and created_by = auth.uid());
drop policy if exists "expenses update" on public.expenses;
create policy "expenses update" on public.expenses for update to authenticated
  using (is_member(group_id)) with check (is_member(group_id));
drop policy if exists "expenses delete" on public.expenses;
create policy "expenses delete" on public.expenses for delete to authenticated
  using (is_member(group_id));

drop policy if exists "splits read" on public.expense_splits;
create policy "splits read" on public.expense_splits for select to authenticated
  using (exists (select 1 from expenses e where e.id = expense_id and is_member(e.group_id)));
drop policy if exists "splits write" on public.expense_splits;
create policy "splits write" on public.expense_splits for all to authenticated
  using (exists (select 1 from expenses e where e.id = expense_id and is_member(e.group_id)))
  with check (exists (select 1 from expenses e where e.id = expense_id and is_member(e.group_id)));

drop policy if exists "settlements read" on public.settlements;
create policy "settlements read" on public.settlements for select to authenticated
  using (is_member(group_id));
-- you can only settle your own debts (payer of the settlement must be the caller)
drop policy if exists "settlements insert" on public.settlements;
create policy "settlements insert" on public.settlements for insert to authenticated
  with check (is_member(group_id) and from_user = auth.uid());
drop policy if exists "settlements update own" on public.settlements;
create policy "settlements update own" on public.settlements for update to authenticated
  using (is_member(group_id) and from_user = auth.uid())
  with check (is_member(group_id) and from_user = auth.uid());
drop policy if exists "settlements delete" on public.settlements;
create policy "settlements delete" on public.settlements for delete to authenticated
  using (is_member(group_id));

-- audit log is read-only for members; rows are written only by the functions/triggers above
drop policy if exists "audit read" on public.audit_log;
create policy "audit read" on public.audit_log for select to authenticated
  using (is_member(group_id));

-- ───────────────────────── realtime ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['expenses', 'expense_splits', 'settlements', 'group_members', 'audit_log'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
