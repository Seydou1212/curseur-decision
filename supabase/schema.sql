-- =====================================================================
-- Curseur de décision – schéma Supabase (état complet à jour)
-- Nouvelle installation : à exécuter une fois dans Supabase > SQL Editor.
-- Installation existante : exécuter plutôt les fichiers de
-- supabase/migrations/ qui n'ont pas encore été passés.
-- Les tables sont préfixées "curseur_" : tu peux donc réutiliser un
-- projet Supabase existant (celui de jury-cqp par exemple) sans conflit.
-- =====================================================================

-- phase : preparation (édition de la liste) | vote (vote ouvert) | resultats
-- levels : définition des 5 niveaux propre à la séance
--          [{ who, title, text }, ...] ; null = niveaux par défaut de l'appli
create table if not exists public.curseur_sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  admin_key   text not null,
  phase       text not null default 'preparation'
              check (phase in ('preparation', 'vote', 'resultats')),
  levels      jsonb,
  created_at  timestamptz not null default now()
);
alter table public.curseur_sessions add column if not exists levels jsonb;

-- Décisions propres à chaque séance.
-- key : identifiant stable, utilisé comme clé dans curseur_votes.answers
-- prop : niveau proposé (jamais renvoyé aux associés avant les résultats)
create table if not exists public.curseur_decisions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.curseur_sessions(id) on delete cascade,
  key         text not null check (key ~ '^[A-Za-z0-9_-]{1,60}$'),
  label       text not null check (length(label) between 1 and 300),
  domain      text not null check (domain ~ '^[a-z0-9-]{1,30}$'),
  prop        smallint check (prop between 1 and 5),
  test        boolean not null default false,
  position    int not null default 0,
  unique (session_id, key)
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
alter table public.curseur_decisions enable row level security;
alter table public.curseur_votes enable row level security;

-- =====================================================================
-- Fonctions internes (non exposées à l'application)
-- =====================================================================

-- Séance correspondant au code ET à la clé animateur, sinon erreur
create or replace function public.curseur_admin_session(p_code text, p_admin_key text)
returns public.curseur_sessions
language plpgsql
security definer
set search_path = public
as $$
declare s curseur_sessions%rowtype;
begin
  select * into s from curseur_sessions
   where code = upper(p_code) and admin_key = p_admin_key;
  if not found or p_admin_key is null then raise exception 'Lien animateur invalide'; end if;
  return s;
end;
$$;

-- Même chose, mais exige la phase "preparation" (édition de la liste)
create or replace function public.curseur_admin_editable(p_code text, p_admin_key text)
returns public.curseur_sessions
language plpgsql
security definer
set search_path = public
as $$
declare s curseur_sessions%rowtype;
begin
  s := curseur_admin_session(p_code, p_admin_key);
  if s.phase <> 'preparation' then
    raise exception 'La liste ne se modifie qu''en phase de préparation';
  end if;
  return s;
end;
$$;

-- Contrôle des champs d'une décision ; renvoie le libellé nettoyé
create or replace function public.curseur_check_decision(p_label text, p_domain text, p_prop int)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare l text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
begin
  if length(l) < 1 then raise exception 'Le libellé est vide'; end if;
  if length(l) > 300 then raise exception 'Le libellé dépasse 300 caractères'; end if;
  if p_domain is null or p_domain !~ '^[a-z0-9-]{1,30}$' then raise exception 'Domaine invalide'; end if;
  if p_prop is not null and p_prop not between 1 and 5 then raise exception 'Niveau proposé invalide'; end if;
  return l;
end;
$$;

-- Retire une décision de tous les votes d'une séance ; renvoie le nombre de votes effacés
create or replace function public.curseur_clear_votes(p_session uuid, p_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update curseur_votes set answers = answers - p_key, updated_at = now()
   where session_id = p_session and answers ? p_key;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- =====================================================================
-- Fonctions appelées par l'application
-- =====================================================================

-- ---------------------------------------------------------------------
-- Créer une séance, pré-remplie avec la liste par défaut envoyée par
-- l'application (src/decisions.js). Renvoie le code et la clé animateur.
-- p_decisions : [{ id, label, domain, prop, test }, ...]
-- ---------------------------------------------------------------------
create or replace function public.curseur_create_session(p_decisions jsonb default '[]'::jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
  k text;
  sid uuid;
  d record;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if p_decisions is null then p_decisions := '[]'::jsonb; end if;
  if jsonb_typeof(p_decisions) <> 'array' then raise exception 'Liste de décisions invalide'; end if;
  if jsonb_array_length(p_decisions) > 100 then raise exception 'Trop de décisions (100 au maximum)'; end if;

  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from curseur_sessions where code = c);
  end loop;
  k := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into curseur_sessions (code, admin_key) values (c, k) returning id into sid;

  for d in select value as v, ordinality as pos from jsonb_array_elements(p_decisions) with ordinality loop
    if jsonb_typeof(d.v) <> 'object' or coalesce(d.v->>'id', '') !~ '^[A-Za-z0-9_-]{1,60}$' then
      raise exception 'Liste de décisions invalide';
    end if;
    insert into curseur_decisions (session_id, key, label, domain, prop, test, position)
    values (
      sid,
      d.v->>'id',
      curseur_check_decision(d.v->>'label', d.v->>'domain', (d.v->>'prop')::int),
      d.v->>'domain',
      (d.v->>'prop')::int,
      coalesce((d.v->>'test')::boolean, false),
      d.pos
    );
  end loop;

  return json_build_object('code', c, 'admin_key', k);
end;
$$;

-- ---------------------------------------------------------------------
-- État public d'une séance : phase, niveaux et liste des décisions.
-- Le niveau proposé (prop) n'est renvoyé qu'en phase "resultats"
-- ou à l'animateur. L'animateur reçoit aussi le nombre de votes
-- par décision (pour avertir avant un effacement).
-- levels_locked : des votes existent, les niveaux ne se modifient plus.
-- ---------------------------------------------------------------------
create or replace function public.curseur_session(p_code text, p_admin_key text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  is_admin boolean;
  show_prop boolean;
  list json;
begin
  select * into s from curseur_sessions where code = upper(p_code);
  if not found then
    return json_build_object('exists', false);
  end if;
  is_admin := p_admin_key is not null and p_admin_key = s.admin_key;
  show_prop := is_admin or s.phase = 'resultats';

  select coalesce(json_agg(json_build_object(
           'id', d.key,
           'label', d.label,
           'domain', d.domain,
           'test', d.test,
           'prop', case when show_prop then d.prop end,
           'votes', case when is_admin then
              (select count(*) from curseur_votes v where v.session_id = s.id and v.answers ? d.key) end
         ) order by d.position, d.label), '[]'::json)
    into list
    from curseur_decisions d
   where d.session_id = s.id;

  return json_build_object(
    'exists', true,
    'is_admin', is_admin,
    'phase', s.phase,
    'levels', s.levels,
    'levels_locked', exists (select 1 from curseur_votes v where v.session_id = s.id and v.answers <> '{}'::jsonb),
    'decisions', list
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Enregistrer ou mettre à jour son vote (phase "vote" uniquement).
-- Seules les décisions existantes de la séance sont gardées.
-- ---------------------------------------------------------------------
create or replace function public.curseur_cast_vote(p_code text, p_token text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  clean jsonb := '{}'::jsonb;
  e record;
begin
  select * into s from curseur_sessions where code = upper(p_code);
  if not found then raise exception 'Séance introuvable'; end if;
  if s.phase <> 'vote' then raise exception 'Le vote n''est pas ouvert'; end if;
  if p_token is null or length(p_token) < 10 or length(p_token) > 100 then
    raise exception 'Jeton de vote invalide';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Vote invalide'; end if;

  -- On ne garde que des niveaux entiers de 1 à 5 sur des décisions de la séance
  for e in
    select a.key, a.value
      from jsonb_each(p_answers) a
      join curseur_decisions d on d.session_id = s.id and d.key = a.key
  loop
    if jsonb_typeof(e.value) = 'number' and (e.value::text)::numeric in (1,2,3,4,5) then
      clean := clean || jsonb_build_object(e.key, (e.value::text)::int);
    end if;
  end loop;

  insert into curseur_votes (session_id, voter_token, answers, updated_at)
  values (s.id, p_token, clean, now())
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
-- répartition seulement en phase "resultats" OU pour l'animateur.
-- Seules les décisions encore présentes dans la séance sont comptées.
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

  if is_admin or s.phase = 'resultats' then
    select coalesce(json_object_agg(t.k, t.arr), '{}'::json) into cnt
      from (
        select e.key as k,
               json_build_array(
                 count(*) filter (where e.value::text = '1'),
                 count(*) filter (where e.value::text = '2'),
                 count(*) filter (where e.value::text = '3'),
                 count(*) filter (where e.value::text = '4'),
                 count(*) filter (where e.value::text = '5')
               ) as arr
          from curseur_votes v
          cross join jsonb_each(v.answers) e
          join curseur_decisions d on d.session_id = s.id and d.key = e.key
         where v.session_id = s.id
         group by e.key
      ) t;
  end if;

  return json_build_object(
    'exists', true,
    'is_admin', is_admin,
    'phase', s.phase,
    'voters', n,
    'counts', cnt
  );
end;
$$;

-- =====================================================================
-- Actions animateur (protégées par la clé)
-- =====================================================================

-- Changer de phase (dans les deux sens)
create or replace function public.curseur_set_phase(p_code text, p_admin_key text, p_phase text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s curseur_sessions%rowtype;
begin
  if p_phase is null or p_phase not in ('preparation', 'vote', 'resultats') then
    raise exception 'Phase inconnue';
  end if;
  s := curseur_admin_session(p_code, p_admin_key);
  update curseur_sessions set phase = p_phase where id = s.id;
end;
$$;

-- Ajouter une décision en fin de liste ; renvoie son identifiant
create or replace function public.curseur_add_decision(
  p_code text, p_admin_key text,
  p_label text, p_domain text, p_prop int default null, p_test boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  l text;
  k text;
begin
  s := curseur_admin_editable(p_code, p_admin_key);
  l := curseur_check_decision(p_label, p_domain, p_prop);
  if (select count(*) from curseur_decisions where session_id = s.id) >= 100 then
    raise exception 'Trop de décisions (100 au maximum)';
  end if;
  loop
    k := 'd-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    exit when not exists (select 1 from curseur_decisions where session_id = s.id and key = k);
  end loop;
  insert into curseur_decisions (session_id, key, label, domain, prop, test, position)
  values (s.id, k, l, p_domain, p_prop, coalesce(p_test, false),
          coalesce((select max(position) from curseur_decisions where session_id = s.id), 0) + 1);
  return k;
end;
$$;

-- Modifier une décision. Si le libellé change, la question n'est plus
-- la même : ses votes sont effacés. Renvoie le nombre de votes effacés.
create or replace function public.curseur_update_decision(
  p_code text, p_admin_key text, p_key text,
  p_label text, p_domain text, p_prop int default null, p_test boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  d curseur_decisions%rowtype;
  l text;
  n int := 0;
begin
  s := curseur_admin_editable(p_code, p_admin_key);
  l := curseur_check_decision(p_label, p_domain, p_prop);
  select * into d from curseur_decisions where session_id = s.id and key = p_key;
  if not found then raise exception 'Décision introuvable'; end if;
  if d.label <> l then n := curseur_clear_votes(s.id, p_key); end if;
  update curseur_decisions
     set label = l, domain = p_domain, prop = p_prop, test = coalesce(p_test, false)
   where id = d.id;
  return n;
end;
$$;

-- Supprimer une décision et ses votes. Renvoie le nombre de votes effacés.
create or replace function public.curseur_delete_decision(p_code text, p_admin_key text, p_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  n int;
begin
  s := curseur_admin_editable(p_code, p_admin_key);
  delete from curseur_decisions where session_id = s.id and key = p_key;
  if not found then raise exception 'Décision introuvable'; end if;
  n := curseur_clear_votes(s.id, p_key);
  return n;
end;
$$;

-- Monter (p_dir = -1) ou descendre (p_dir = 1) une décision dans son groupe :
-- décisions de l'atelier ensemble, les autres par domaine.
create or replace function public.curseur_move_decision(p_code text, p_admin_key text, p_key text, p_dir int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  d curseur_decisions%rowtype;
  o curseur_decisions%rowtype;
begin
  s := curseur_admin_editable(p_code, p_admin_key);
  if p_dir is null or p_dir not in (-1, 1) then raise exception 'Direction invalide'; end if;

  -- Renumérote 1, 2, 3… dans l'ordre affiché, pour que les positions soient toutes distinctes
  update curseur_decisions x set position = r.rn
    from (select id, row_number() over (order by position, label, id) as rn
            from curseur_decisions where session_id = s.id) r
   where x.id = r.id;

  select * into d from curseur_decisions where session_id = s.id and key = p_key;
  if not found then raise exception 'Décision introuvable'; end if;

  select * into o from curseur_decisions x
   where x.session_id = s.id and x.id <> d.id
     and x.test = d.test and (d.test or x.domain = d.domain)
     and (case when p_dir < 0 then x.position < d.position else x.position > d.position end)
   order by x.position * p_dir
   limit 1;
  if not found then return; end if; -- déjà en tête ou en fin de groupe

  update curseur_decisions set position = o.position where id = d.id;
  update curseur_decisions set position = d.position where id = o.id;
end;
$$;

-- Remplacer la définition des 5 niveaux (p_levels = null : niveaux par défaut).
-- Seulement en préparation, et tant qu'aucun vote n'est enregistré :
-- un vote ne doit jamais changer de sens.
create or replace function public.curseur_set_levels(p_code text, p_admin_key text, p_levels jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s curseur_sessions%rowtype;
  clean jsonb := '[]'::jsonb;
  e jsonb;
  w text;
  t text;
  x text;
begin
  s := curseur_admin_editable(p_code, p_admin_key);
  if exists (select 1 from curseur_votes v where v.session_id = s.id and v.answers <> '{}'::jsonb) then
    raise exception 'Des votes sont déjà enregistrés : les niveaux ne se modifient plus';
  end if;

  if p_levels is not null and jsonb_typeof(p_levels) <> 'null' then
    if jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) <> 5 then
      raise exception 'Il faut exactement 5 niveaux';
    end if;
    for e in select value from jsonb_array_elements(p_levels) loop
      if jsonb_typeof(e) <> 'object' then raise exception 'Niveau invalide'; end if;
      w := btrim(regexp_replace(coalesce(e->>'who', ''), '\s+', ' ', 'g'));
      t := btrim(regexp_replace(coalesce(e->>'title', ''), '\s+', ' ', 'g'));
      x := btrim(coalesce(e->>'text', ''));
      if length(w) not between 1 and 40 then raise exception 'Le « qui décide » doit faire de 1 à 40 caractères'; end if;
      if length(t) not between 1 and 80 then raise exception 'Le titre d''un niveau doit faire de 1 à 80 caractères'; end if;
      if length(x) > 300 then raise exception 'L''explication d''un niveau dépasse 300 caractères'; end if;
      clean := clean || jsonb_build_array(jsonb_build_object('who', w, 'title', t, 'text', x));
    end loop;
  else
    clean := null;
  end if;

  update curseur_sessions set levels = clean where id = s.id;
end;
$$;

-- Effacer tous les votes ; si les résultats étaient affichés, on revient au vote
create or replace function public.curseur_reset(p_code text, p_admin_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s curseur_sessions%rowtype;
begin
  s := curseur_admin_session(p_code, p_admin_key);
  delete from curseur_votes where session_id = s.id;
  update curseur_sessions set phase = 'vote' where id = s.id and phase = 'resultats';
end;
$$;

-- =====================================================================
-- Droits d'exécution
-- =====================================================================
-- Fonctions internes : personne ne peut les appeler depuis l'application
revoke execute on function public.curseur_admin_session(text, text) from public, anon, authenticated;
revoke execute on function public.curseur_admin_editable(text, text) from public, anon, authenticated;
revoke execute on function public.curseur_check_decision(text, text, int) from public, anon, authenticated;
revoke execute on function public.curseur_clear_votes(uuid, text) from public, anon, authenticated;

-- Fonctions de l'application (clé anon)
grant execute on function public.curseur_create_session(jsonb) to anon, authenticated;
grant execute on function public.curseur_session(text, text) to anon, authenticated;
grant execute on function public.curseur_cast_vote(text, text, jsonb) to anon, authenticated;
grant execute on function public.curseur_my_vote(text, text) to anon, authenticated;
grant execute on function public.curseur_results(text, text) to anon, authenticated;
grant execute on function public.curseur_set_phase(text, text, text) to anon, authenticated;
grant execute on function public.curseur_add_decision(text, text, text, text, int, boolean) to anon, authenticated;
grant execute on function public.curseur_update_decision(text, text, text, text, text, int, boolean) to anon, authenticated;
grant execute on function public.curseur_delete_decision(text, text, text) to anon, authenticated;
grant execute on function public.curseur_move_decision(text, text, text, int) to anon, authenticated;
grant execute on function public.curseur_reset(text, text) to anon, authenticated;
grant execute on function public.curseur_set_levels(text, text, jsonb) to anon, authenticated;
