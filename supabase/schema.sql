-- SplitBill schema. Run once in Supabase Dashboard -> SQL Editor.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'SGD',        -- settlement currency
  local_currency text not null default 'SGD',  -- currency spent while travelling
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_by uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  spent_on date not null default current_date,
  -- amount/splits are always in the group's settlement currency; these keep the original entry
  local_amount numeric(12,2),
  local_currency text,
  fx_rate numeric(18,8),  -- settlement units per 1 local unit
  created_at timestamptz not null default now()
);

-- one row per person who owes part of an expense
create table public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  share numeric(12,2) not null check (share >= 0),
  primary key (expense_id, user_id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

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

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- creator becomes first member of a new group
create or replace function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id) values (new.id, new.created_by);
  return new;
end $$;

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

-- Row level security
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;

-- profiles: see yourself and people who share a group with you
create policy "profiles read" on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "groups read" on public.groups for select to authenticated
  using (is_member(id) or created_by = auth.uid());
create policy "groups insert" on public.groups for insert to authenticated
  with check (created_by = auth.uid());
create policy "groups update" on public.groups for update to authenticated
  using (is_member(id)) with check (is_member(id));

create policy "members read" on public.group_members for select to authenticated
  using (is_member(group_id));
create policy "members leave" on public.group_members for delete to authenticated
  using (user_id = auth.uid());

create policy "expenses read" on public.expenses for select to authenticated
  using (is_member(group_id));
create policy "expenses insert" on public.expenses for insert to authenticated
  with check (is_member(group_id) and created_by = auth.uid());
create policy "expenses update" on public.expenses for update to authenticated
  using (is_member(group_id)) with check (is_member(group_id));
create policy "expenses delete" on public.expenses for delete to authenticated
  using (is_member(group_id));

create policy "splits read" on public.expense_splits for select to authenticated
  using (exists (select 1 from expenses e where e.id = expense_id and is_member(e.group_id)));
create policy "splits write" on public.expense_splits for all to authenticated
  using (exists (select 1 from expenses e where e.id = expense_id and is_member(e.group_id)))
  with check (exists (select 1 from expenses e where e.id = expense_id and is_member(e.group_id)));

create policy "settlements read" on public.settlements for select to authenticated
  using (is_member(group_id));
create policy "settlements insert" on public.settlements for insert to authenticated
  with check (is_member(group_id));
create policy "settlements delete" on public.settlements for delete to authenticated
  using (is_member(group_id));

-- realtime updates in the app
alter publication supabase_realtime add table public.expenses, public.expense_splits, public.settlements, public.group_members;

-- backfill profiles for users who signed up before the trigger existed
insert into public.profiles (id, name)
select id, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

-- migration for databases created before local/settlement currencies existed
alter table public.groups add column if not exists local_currency text not null default 'SGD';
alter table public.groups alter column currency set default 'SGD';
alter table public.expenses add column if not exists local_amount numeric(12,2);
alter table public.expenses add column if not exists local_currency text;
alter table public.expenses add column if not exists fx_rate numeric(18,8);

-- migration: edit expenses + audit log (idempotent)
alter table public.expenses add column if not exists updated_at timestamptz;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  entity text not null check (entity in ('expense', 'settlement')),
  entity_id uuid not null,
  summary text not null,
  changes jsonb,  -- for updates: { field: [old, new] }
  created_at timestamptz not null default now()
);
create index if not exists audit_log_group_idx on public.audit_log (group_id, created_at desc);

alter table public.audit_log enable row level security;
drop policy if exists "audit read" on public.audit_log;
create policy "audit read" on public.audit_log for select to authenticated
  using (is_member(group_id));
-- no insert/update/delete policies: rows are written only by the triggers below

create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  act text;
  ent text := tg_argv[0];
  diff jsonb;
  summ text;
begin
  if tg_op = 'DELETE' then r := old; act := 'deleted';
  elsif tg_op = 'INSERT' then r := new; act := 'created';
  else r := new; act := 'updated'; end if;

  if ent = 'expense' then
    summ := r.description || ' (' || r.amount || ')';
    if tg_op = 'UPDATE' then
      -- ignore bookkeeping columns when diffing
      select jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)) into diff
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
      where n.value is distinct from o.value and n.key <> 'updated_at';
    end if;
  else
    summ := 'payment ' || r.amount;
  end if;

  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, changes)
  values (r.group_id, auth.uid(), act, ent, r.id, summ, diff);
  return r;
end $$;

drop trigger if exists audit_expenses on public.expenses;
create trigger audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.log_audit('expense');
drop trigger if exists audit_settlements on public.settlements;
create trigger audit_settlements after insert or delete on public.settlements
  for each row execute function public.log_audit('settlement');

alter publication supabase_realtime add table public.audit_log;

-- migration: full-detail audit log (idempotent). Supersedes the log_audit triggers above.
alter table public.audit_log add column if not exists details jsonb;      -- state after (or before, for deletes)
alter table public.audit_log add column if not exists old_details jsonb;  -- state before, for updates

drop trigger if exists audit_expenses on public.expenses;
drop trigger if exists audit_settlements on public.settlements;
drop function if exists public.log_audit();

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
  if xid is null then
    insert into expenses (group_id, description, amount, paid_by, spent_on, local_amount, local_currency, fx_rate)
    values (gid, fields->>'description', (fields->>'amount')::numeric, (fields->>'paid_by')::uuid,
            (fields->>'spent_on')::date, (fields->>'local_amount')::numeric, fields->>'local_currency',
            (fields->>'fx_rate')::numeric)
    returning id into xid;
  else
    if not exists (select 1 from expenses where id = xid and group_id = gid) then
      raise exception 'Expense not found';
    end if;
    old_d := expense_snapshot(xid);
    update expenses set description = fields->>'description', amount = (fields->>'amount')::numeric,
      paid_by = (fields->>'paid_by')::uuid, spent_on = (fields->>'spent_on')::date,
      local_amount = (fields->>'local_amount')::numeric, local_currency = fields->>'local_currency',
      fx_rate = (fields->>'fx_rate')::numeric, updated_at = now()
    where id = xid;
    delete from expense_splits where expense_id = xid;
  end if;
  insert into expense_splits (expense_id, user_id, share)
  select xid, x.user_id, x.share from jsonb_to_recordset(splits) as x(user_id uuid, share numeric);
  new_d := expense_snapshot(xid);
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details, old_details)
  values (gid, auth.uid(), case when eid is null then 'created' else 'updated' end, 'expense', xid,
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

-- undo an accidental delete: re-create the expense (same id) from its audit snapshot
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('created', 'updated', 'deleted', 'restored'));

create or replace function public.restore_expense(aid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a audit_log; d jsonb;
begin
  select * into a from audit_log where id = aid and entity = 'expense' and action = 'deleted';
  if a.id is null or not is_member(a.group_id) then raise exception 'Nothing to restore'; end if;
  if exists (select 1 from expenses where id = a.entity_id) then raise exception 'Already restored'; end if;
  d := a.details;
  insert into expenses (id, group_id, description, amount, paid_by, spent_on, local_amount, local_currency, fx_rate)
  values (a.entity_id, a.group_id, d->>'description', (d->>'amount')::numeric, (d->>'paid_by')::uuid,
          (d->>'spent_on')::date, (d->>'local_amount')::numeric, d->>'local_currency', (d->>'fx_rate')::numeric);
  insert into expense_splits (expense_id, user_id, share)
  select a.entity_id, x.user_id, x.share from jsonb_to_recordset(d->'splits') as x(user_id uuid, share numeric);
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details)
  values (a.group_id, auth.uid(), 'restored', 'expense', a.entity_id, a.summary, expense_snapshot(a.entity_id));
  return a.entity_id;
end $$;

-- migration: you can only settle your own debts (payer of the settlement must be the caller)
drop policy if exists "settlements insert" on public.settlements;
create policy "settlements insert" on public.settlements for insert to authenticated
  with check (is_member(group_id) and from_user = auth.uid());

-- migration: expense categories (idempotent). Re-creates save_expense / restore_expense with category.
alter table public.expenses add column if not exists category text;

create or replace function public.save_expense(eid uuid, gid uuid, fields jsonb, splits jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  old_d jsonb;
  new_d jsonb;
  xid uuid := eid;
begin
  if not is_member(gid) then raise exception 'Not a member of this group'; end if;
  if xid is null then
    insert into expenses (group_id, description, amount, paid_by, spent_on, local_amount, local_currency, fx_rate, category)
    values (gid, fields->>'description', (fields->>'amount')::numeric, (fields->>'paid_by')::uuid,
            (fields->>'spent_on')::date, (fields->>'local_amount')::numeric, fields->>'local_currency',
            (fields->>'fx_rate')::numeric, fields->>'category')
    returning id into xid;
  else
    if not exists (select 1 from expenses where id = xid and group_id = gid) then
      raise exception 'Expense not found';
    end if;
    old_d := expense_snapshot(xid);
    update expenses set description = fields->>'description', amount = (fields->>'amount')::numeric,
      paid_by = (fields->>'paid_by')::uuid, spent_on = (fields->>'spent_on')::date,
      local_amount = (fields->>'local_amount')::numeric, local_currency = fields->>'local_currency',
      fx_rate = (fields->>'fx_rate')::numeric, category = fields->>'category', updated_at = now()
    where id = xid;
    delete from expense_splits where expense_id = xid;
  end if;
  insert into expense_splits (expense_id, user_id, share)
  select xid, x.user_id, x.share from jsonb_to_recordset(splits) as x(user_id uuid, share numeric);
  new_d := expense_snapshot(xid);
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details, old_details)
  values (gid, auth.uid(), case when eid is null then 'created' else 'updated' end, 'expense', xid,
          new_d->>'description', new_d, old_d);
  return xid;
end $$;

create or replace function public.restore_expense(aid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare a audit_log; d jsonb;
begin
  select * into a from audit_log where id = aid and entity = 'expense' and action = 'deleted';
  if a.id is null or not is_member(a.group_id) then raise exception 'Nothing to restore'; end if;
  if exists (select 1 from expenses where id = a.entity_id) then raise exception 'Already restored'; end if;
  d := a.details;
  insert into expenses (id, group_id, description, amount, paid_by, spent_on, local_amount, local_currency, fx_rate, category)
  values (a.entity_id, a.group_id, d->>'description', (d->>'amount')::numeric, (d->>'paid_by')::uuid,
          (d->>'spent_on')::date, (d->>'local_amount')::numeric, d->>'local_currency', (d->>'fx_rate')::numeric,
          d->>'category');
  insert into expense_splits (expense_id, user_id, share)
  select a.entity_id, x.user_id, x.share from jsonb_to_recordset(d->'splits') as x(user_id uuid, share numeric);
  insert into audit_log (group_id, actor_id, action, entity, entity_id, summary, details)
  values (a.group_id, auth.uid(), 'restored', 'expense', a.entity_id, a.summary, expense_snapshot(a.entity_id));
  return a.entity_id;
end $$;
