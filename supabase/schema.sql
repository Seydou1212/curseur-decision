-- =====================================================================
-- Curseur de décision – schéma Supabase
-- À exécuter une fois dans Supabase > SQL Editor.
-- Les tables sont préfixées "curseur_" : tu peux donc réutiliser un
-- projet Supabase existant (celui de jury-cqp par exemple) sans conflit.
-- =====================================================================

create table if not exists public.curseur_sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  admin_key   text not null,
  revealed    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.curseur_votes (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.curseur_sessions(id) on delete cascade,
  voter_token  text not null,
  answers      jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (session_id, voter_token)
);

-- Sécurité : RLS activée SANS aucune policy.
-- Personne ne lit ni n'écrit directement dans les tables :
-- tout passe par les fonctions ci-dessous (security definer).
-- Les votes individuels ne sont donc jamais lisibles, seuls les totaux.
alter table public.curseur_sessions enable row level security;
alter table public.curseur_votes enable row level security;

-- ---------------------------------------------------------------------
-- Créer une séance : renvoie le code (5 caractères) et la clé animateur
-- ---------------------------------------------------------------------
create or replace function public.curseur_create_session()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
  k text;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from curseur_sessions where code = c);
  end loop;
  k := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into curseur_sessions (code, admin_key) values (c, k);
  return json_build_object('code', c, 'admin_key', k);
end;
$$;

-- ---------------------------------------------------------------------
-- Infos publiques d'une séance (existe ? résultats révélés ?)
-- ---------------------------------------------------------------------
create or replace function public.curseur_session_info(p_code text)
returns json
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select json_build_object('exists', true, 'revealed', s.revealed)
       from curseur_sessions s where s.code = upper(p_code)),
    json_build_object('exists', false, 'revealed', false)
  );
$$;

-- ---------------------------------------------------------------------
-- Enregistrer ou mettre à jour son vote
-- ---------------------------------------------------------------------
create or replace function public.curseur_cast_vote(p_code text, p_token text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  clean jsonb := '{}'::jsonb;
  e record;
begin
  select id into sid from curseur_sessions where code = upper(p_code);
  if sid is null then raise exception 'Séance introuvable'; end if;
  if p_token is null or length(p_token) < 10 or length(p_token) > 100 then
    raise exception 'Jeton de vote invalide';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Vote invalide'; end if;

  -- On ne garde que des niveaux entiers de 1 à 5, au plus 100 décisions
  for e in select key, value from jsonb_each(p_answers) limit 100 loop
    if jsonb_typeof(e.value) = 'number'
       and (e.value::text)::numeric in (1,2,3,4,5)
       and length(e.key) <= 60 then
      clean := clean || jsonb_build_object(e.key, (e.value::text)::int);
    end if;
  end loop;

  insert into curseur_votes (session_id, voter_token, answers, updated_at)
  values (sid, p_token, clean, now())
  on conflict (session_id, voter_token)
  do update set answers = excluded.answers, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- Relire son propre vote (pour le modifier)
-- ---------------------------------------------------------------------
create or replace function public.curseur_my_vote(p_code text, p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select v.answers
    from curseur_votes v
    join curseur_sessions s on s.id = v.session_id
   where s.code = upper(p_code) and v.voter_token = p_token;
$$;

-- ---------------------------------------------------------------------
-- Résultats agrégés : nombre de votants toujours,
-- répartition seulement si révélée OU si la clé animateur est bonne
-- ---------------------------------------------------------------------
create or replace function public.curseur_results(p_code text, p_admin_key text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  is_admin boolean;
  n int;
  cnt json;
begin
  select * into s from curseur_sessions where code = upper(p_code);
  if not found then
    return json_build_object('exists', false);
  end if;
  is_admin := p_admin_key is not null and p_admin_key = s.admin_key;
  select count(*) into n from curseur_votes where session_id = s.id and answers <> '{}'::jsonb;

  if is_admin or s.revealed then
    select coalesce(json_object_agg(k, arr), '{}'::json) into cnt
      from (
        select e.key as k,
               json_build_array(
                 count(*) filter (where e.value::text = '1'),
                 count(*) filter (where e.value::text = '2'),
                 count(*) filter (where e.value::text = '3'),
                 count(*) filter (where e.value::text = '4'),
                 count(*) filter (where e.value::text = '5')
               ) as arr
          from curseur_votes v, jsonb_each(v.answers) e
         where v.session_id = s.id
         group by e.key
      ) t;
  end if;

  return json_build_object(
    'exists', true,
    'is_admin', is_admin,
    'revealed', s.revealed,
    'voters', n,
    'counts', cnt
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Actions animateur (protégées par la clé)
-- ---------------------------------------------------------------------
create or replace function public.curseur_set_reveal(p_code text, p_admin_key text, p_revealed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update curseur_sessions set revealed = p_revealed
   where code = upper(p_code) and admin_key = p_admin_key;
  if not found then raise exception 'Lien animateur invalide'; end if;
end;
$$;

create or replace function public.curseur_reset(p_code text, p_admin_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare sid uuid;
begin
  select id into sid from curseur_sessions where code = upper(p_code) and admin_key = p_admin_key;
  if sid is null then raise exception 'Lien animateur invalide'; end if;
  delete from curseur_votes where session_id = sid;
  update curseur_sessions set revealed = false where id = sid;
end;
$$;

-- Droits d'exécution pour l'application (clé anon)
grant execute on function public.curseur_create_session() to anon, authenticated;
grant execute on function public.curseur_session_info(text) to anon, authenticated;
grant execute on function public.curseur_cast_vote(text, text, jsonb) to anon, authenticated;
grant execute on function public.curseur_my_vote(text, text) to anon, authenticated;
grant execute on function public.curseur_results(text, text) to anon, authenticated;
grant execute on function public.curseur_set_reveal(text, text, boolean) to anon, authenticated;
grant execute on function public.curseur_reset(text, text) to anon, authenticated;
