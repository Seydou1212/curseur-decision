-- =====================================================================
-- Migration 002 : niveaux modifiables par séance
-- À exécuter UNE fois dans Supabase > SQL Editor, après la 001
-- (ou après une installation faite avec schema.sql avant cette version).
--
-- Ce que fait la migration :
--   1. ajoute la colonne curseur_sessions.levels (null = niveaux par défaut
--      de l'appli : les séances existantes ne changent pas) ;
--   2. curseur_session renvoie aussi les niveaux ;
--   3. nouvelle fonction curseur_set_levels (animateur, en préparation,
--      tant qu'aucun vote n'est enregistré).
-- =====================================================================

begin;

alter table public.curseur_sessions add column if not exists levels jsonb;

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

grant execute on function public.curseur_session(text, text) to anon, authenticated;
grant execute on function public.curseur_set_levels(text, text, jsonb) to anon, authenticated;

commit;
