-- Legend Lore — initial schema.
--
-- Run this once in the Supabase SQL editor (or with `supabase db push`).
-- All access control lives here, in row-level security (RLS) policies: the
-- browser holds a public "anon" key, so anything not enforced in this file is
-- not enforced at all.

-- ---------------------------------------------------------------------------
-- Profiles: a public-facing name for each auth user.
-- ---------------------------------------------------------------------------

create table public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	display_name text not null,
	created_at timestamptz not null default now()
);

-- Discord puts the user's name in raw_user_meta_data; email sign-ups fall back
-- to the part of the address before the @.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.profiles (id, display_name)
	values (
		new.id,
		coalesce(
			new.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
			new.raw_user_meta_data ->> 'full_name',
			new.raw_user_meta_data ->> 'name',
			split_part(new.email, '@', 1),
			'Adventurer'
		)
	);
	return new;
end;
$$;

create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Campaigns and membership.
-- ---------------------------------------------------------------------------

create table public.campaigns (
	id uuid primary key default gen_random_uuid(),
	name text not null check (length(trim(name)) between 1 and 200),
	created_by uuid not null default auth.uid() references auth.users (id),
	created_at timestamptz not null default now()
);

-- Every member can edit everything in the campaign. "owner" additionally may
-- rename/delete the campaign and remove other members.
create table public.campaign_members (
	campaign_id uuid not null references public.campaigns (id) on delete cascade,
	user_id uuid not null references auth.users (id) on delete cascade,
	role text not null default 'editor' check (role in ('owner', 'editor')),
	joined_at timestamptz not null default now(),
	primary key (campaign_id, user_id)
);

create index campaign_members_user_idx on public.campaign_members (user_id);

-- Membership checks used by every policy below. SECURITY DEFINER so the check
-- itself is not subject to campaign_members' own RLS (which would recurse).
create function public.is_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.campaign_members
		where campaign_id = cid and user_id = auth.uid()
	);
$$;

create function public.is_owner(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.campaign_members
		where campaign_id = cid and user_id = auth.uid() and role = 'owner'
	);
$$;

-- Invite links: /join?token=... . Any member can create one.
create table public.campaign_invites (
	token text primary key default replace(gen_random_uuid()::text, '-', ''),
	campaign_id uuid not null references public.campaigns (id) on delete cascade,
	created_by uuid not null default auth.uid() references auth.users (id),
	created_at timestamptz not null default now(),
	expires_at timestamptz not null default now() + interval '7 days'
);

-- ---------------------------------------------------------------------------
-- Node types (per campaign, extensible). Seeded with Place/Person/Object/Lore.
-- ---------------------------------------------------------------------------

create table public.node_types (
	id uuid primary key default gen_random_uuid(),
	campaign_id uuid not null references public.campaigns (id) on delete cascade,
	label text not null check (length(trim(label)) between 1 and 50),
	color text not null default '#888888' check (color ~ '^#[0-9a-fA-F]{6}$'),
	icon text,
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	unique (campaign_id, id)
);

create unique index node_types_label_idx on public.node_types (campaign_id, lower(label));

-- ---------------------------------------------------------------------------
-- Nodes and edges. Never hard-deleted by clients: deletion sets deleted_at.
-- ---------------------------------------------------------------------------

create table public.nodes (
	id uuid primary key default gen_random_uuid(),
	campaign_id uuid not null references public.campaigns (id) on delete cascade,
	type_id uuid not null,
	name text not null check (length(trim(name)) between 1 and 200),
	aliases text[] not null default '{}',
	tags text[] not null default '{}',
	notes text not null default '' check (length(notes) <= 200000),
	session_number integer check (session_number >= 0),
	version integer not null default 1,
	created_by uuid references auth.users (id) on delete set null,
	created_at timestamptz not null default now(),
	updated_by uuid references auth.users (id) on delete set null,
	updated_at timestamptz not null default now(),
	deleted_at timestamptz,
	unique (campaign_id, id),
	-- Composite FK keeps a node's type inside the same campaign.
	foreign key (campaign_id, type_id) references public.node_types (campaign_id, id)
);

create index nodes_campaign_idx on public.nodes (campaign_id);
create index nodes_tags_idx on public.nodes using gin (tags);

create table public.edges (
	id uuid primary key default gen_random_uuid(),
	campaign_id uuid not null references public.campaigns (id) on delete cascade,
	from_id uuid not null,
	to_id uuid not null,
	annotation text not null default '' check (length(annotation) <= 500),
	session_number integer check (session_number >= 0),
	version integer not null default 1,
	created_by uuid references auth.users (id) on delete set null,
	created_at timestamptz not null default now(),
	updated_by uuid references auth.users (id) on delete set null,
	updated_at timestamptz not null default now(),
	deleted_at timestamptz,
	-- Composite FKs keep both endpoints inside the same campaign.
	foreign key (campaign_id, from_id) references public.nodes (campaign_id, id),
	foreign key (campaign_id, to_id) references public.nodes (campaign_id, id)
);

create index edges_campaign_idx on public.edges (campaign_id);
create index edges_from_idx on public.edges (from_id);
create index edges_to_idx on public.edges (to_id);

-- Stamp authorship/timestamps server-side so clients can't forge them, bump
-- the version counter, and stop clients moving rows between campaigns.
create function public.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		new.created_by := auth.uid();
		new.created_at := now();
		new.version := 1;
	else
		if new.campaign_id <> old.campaign_id then
			raise exception 'campaign_id cannot be changed';
		end if;
		new.created_by := old.created_by;
		new.created_at := old.created_at;
		new.version := old.version + 1;
	end if;
	new.updated_by := auth.uid();
	new.updated_at := now();
	return new;
end;
$$;

-- Trim whitespace, drop blanks and duplicates (keeping first-seen order).
create function public.clean_text_array(arr text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
	select coalesce(array_agg(t order by first_pos), '{}')
	from (
		select trim(x) as t, min(pos) as first_pos
		from unnest(arr) with ordinality as u(x, pos)
		group by trim(x)
	) s
	where t <> '';
$$;

-- Trim whitespace, drop blanks and duplicates from tags and aliases.
create function public.normalize_node()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.name := trim(new.name);
	new.tags := public.clean_text_array(new.tags);
	new.aliases := public.clean_text_array(new.aliases);
	return new;
end;
$$;

create trigger nodes_normalize before insert or update on public.nodes
	for each row execute function public.normalize_node();
create trigger nodes_stamp before insert or update on public.nodes
	for each row execute function public.stamp_row();
create trigger edges_stamp before insert or update on public.edges
	for each row execute function public.stamp_row();

-- ---------------------------------------------------------------------------
-- History: a full snapshot of every node/edge after every change. Undo is
-- "restore an earlier snapshot", which itself becomes a new revision.
-- ---------------------------------------------------------------------------

create table public.revisions (
	id bigint generated always as identity primary key,
	campaign_id uuid not null references public.campaigns (id) on delete cascade,
	entity_type text not null check (entity_type in ('node', 'edge')),
	entity_id uuid not null,
	version integer not null,
	op text not null check (op in ('create', 'update', 'delete', 'restore')),
	snapshot jsonb not null,
	changed_by uuid references auth.users (id) on delete set null,
	changed_at timestamptz not null default now()
);

create index revisions_entity_idx on public.revisions (entity_id, version desc);
create index revisions_campaign_idx on public.revisions (campaign_id, changed_at desc);

create function public.record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	op text;
begin
	if tg_op = 'INSERT' then
		op := 'create';
	elsif old.deleted_at is null and new.deleted_at is not null then
		op := 'delete';
	elsif old.deleted_at is not null and new.deleted_at is null then
		op := 'restore';
	else
		op := 'update';
	end if;

	insert into public.revisions (campaign_id, entity_type, entity_id, version, op, snapshot, changed_by)
	values (new.campaign_id, tg_argv[0], new.id, new.version, op, to_jsonb(new), auth.uid());
	return null;
end;
$$;

create trigger nodes_history after insert or update on public.nodes
	for each row execute function public.record_revision('node');
create trigger edges_history after insert or update on public.edges
	for each row execute function public.record_revision('edge');

-- ---------------------------------------------------------------------------
-- Campaign bootstrap and invites.
-- ---------------------------------------------------------------------------

-- The creator becomes owner, and the default node types are seeded.
create function public.handle_new_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.campaign_members (campaign_id, user_id, role)
	values (new.id, new.created_by, 'owner');

	insert into public.node_types (campaign_id, label, color, icon, sort_order) values
		(new.id, 'Place',  '#4e79a7', 'castle', 0),
		(new.id, 'Person', '#e15759', 'person', 1),
		(new.id, 'Object', '#f28e2b', 'sword',  2),
		(new.id, 'Lore',   '#76b7b2', 'scroll', 3);
	return new;
end;
$$;

create trigger on_campaign_created
	after insert on public.campaigns
	for each row execute function public.handle_new_campaign();

-- Non-members can't see invites (RLS), so joining goes through this function.
create function public.accept_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	cid uuid;
begin
	if auth.uid() is null then
		raise exception 'must be signed in';
	end if;

	select campaign_id into cid
	from public.campaign_invites
	where token = invite_token and expires_at > now();

	if cid is null then
		raise exception 'invite is invalid or has expired';
	end if;

	insert into public.campaign_members (campaign_id, user_id, role)
	values (cid, auth.uid(), 'editor')
	on conflict do nothing;

	return cid;
end;
$$;

revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.campaign_invites enable row level security;
alter table public.node_types enable row level security;
alter table public.nodes enable row level security;
alter table public.edges enable row level security;
alter table public.revisions enable row level security;

-- Profiles: yourself, plus anyone you share a campaign with.
create policy "profiles: read self and campaign-mates" on public.profiles
	for select to authenticated using (
		id = auth.uid() or exists (
			select 1 from public.campaign_members mine
			join public.campaign_members theirs using (campaign_id)
			where mine.user_id = auth.uid() and theirs.user_id = profiles.id
		)
	);
create policy "profiles: update self" on public.profiles
	for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Campaigns.
create policy "campaigns: members read" on public.campaigns
	for select to authenticated using (public.is_member(id));
-- The creator isn't a member until the insert trigger runs, so allow them to
-- read their own row too (needed for INSERT ... RETURNING).
create policy "campaigns: creator reads" on public.campaigns
	for select to authenticated using (created_by = auth.uid());
create policy "campaigns: anyone signed in creates" on public.campaigns
	for insert to authenticated with check (created_by = auth.uid());
create policy "campaigns: owner renames" on public.campaigns
	for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
create policy "campaigns: owner deletes" on public.campaigns
	for delete to authenticated using (public.is_owner(id));

-- Members: rows are only inserted by triggers/accept_invite.
create policy "members: members read" on public.campaign_members
	for select to authenticated using (public.is_member(campaign_id));
create policy "members: leave or owner removes" on public.campaign_members
	for delete to authenticated using (user_id = auth.uid() or public.is_owner(campaign_id));

-- Invites.
create policy "invites: members read" on public.campaign_invites
	for select to authenticated using (public.is_member(campaign_id));
create policy "invites: members create" on public.campaign_invites
	for insert to authenticated with check (public.is_member(campaign_id) and created_by = auth.uid());
create policy "invites: members revoke" on public.campaign_invites
	for delete to authenticated using (public.is_member(campaign_id));

-- Node types: any member manages them. Deleting a type still in use fails on
-- the foreign key from nodes.
create policy "node_types: members read" on public.node_types
	for select to authenticated using (public.is_member(campaign_id));
create policy "node_types: members create" on public.node_types
	for insert to authenticated with check (public.is_member(campaign_id));
create policy "node_types: members update" on public.node_types
	for update to authenticated using (public.is_member(campaign_id)) with check (public.is_member(campaign_id));
create policy "node_types: members delete" on public.node_types
	for delete to authenticated using (public.is_member(campaign_id));

-- Nodes and edges: members read/create/update. No DELETE policy, so hard
-- deletes are impossible from the client; use deleted_at instead.
create policy "nodes: members read" on public.nodes
	for select to authenticated using (public.is_member(campaign_id));
create policy "nodes: members create" on public.nodes
	for insert to authenticated with check (public.is_member(campaign_id));
create policy "nodes: members update" on public.nodes
	for update to authenticated using (public.is_member(campaign_id)) with check (public.is_member(campaign_id));

create policy "edges: members read" on public.edges
	for select to authenticated using (public.is_member(campaign_id));
create policy "edges: members create" on public.edges
	for insert to authenticated with check (public.is_member(campaign_id));
create policy "edges: members update" on public.edges
	for update to authenticated using (public.is_member(campaign_id)) with check (public.is_member(campaign_id));

-- Revisions: read-only for members; written only by the history trigger.
create policy "revisions: members read" on public.revisions
	for select to authenticated using (public.is_member(campaign_id));

-- ---------------------------------------------------------------------------
-- Realtime: broadcast row changes to subscribed clients (RLS still applies).
-- ---------------------------------------------------------------------------

do $$
begin
	if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		alter publication supabase_realtime add table public.nodes, public.edges, public.node_types;
	end if;
end;
$$;
