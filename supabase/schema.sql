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
