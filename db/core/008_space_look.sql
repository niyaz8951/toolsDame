-- db/core/008_space_look.sql - the icon and the colour of a space's tile can be
-- changed after the space is made, by its admins and by IT admins.
-- Serves: contract 3 (Access) and 7 (Audit).
-- Must not change: once run, never edited; a fix is a new file. A colour is
-- six hex digits (#0b63ce) or empty; an icon is at most 8 characters.
--
-- How to run: after 007. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if pg_catalog.to_regclass('core.invites') is null then
    raise exception 'Run db/core/007_add_people.sql first.';
  end if;
  if pg_catalog.to_regprocedure('public.dame_space_look_set(text, text, text)') is not null then
    raise exception '008 was already run. Do not run it twice.';
  end if;
end $$;

-- The icon and colour of a space's tile, for its admin page.
create function public.dame_space_look_get(p_space text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space_or_it(p_space);
begin
  return (select pg_catalog.jsonb_build_object('icon', s.icon, 'colour', s.colour) from core.spaces s where s.id = p_space);
end $$;

create function public.dame_space_look_set(p_space text, p_icon text, p_colour text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space_or_it(p_space);
begin
  perform core.check_card('x', '', p_icon, p_colour);
  update core.spaces set icon = core.clean_text(p_icon, 8), colour = coalesce(p_colour, '') where id = p_space;
  perform core.audit_add(v_uid, 'space.changed', null,
                         pg_catalog.jsonb_build_object('name', 'icon and colour'), p_space);
end $$;

-- Rights: nobody by default, then each function by name.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'dame\_%'
  loop
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute pg_catalog.format('grant execute on function %s to authenticated', f.sig);
    if f.proname = 'dame_site_info' then
      execute pg_catalog.format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;

commit;

-- Must show no rows.
select * from core.security_check();
