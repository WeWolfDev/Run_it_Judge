-- Run It Solo: moderación de apodos y suspensión de cuentas (después de 003).
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr.
--
-- 1. El servidor rechaza apodos con groserías, insultos o contenido ofensivo,
--    aunque se escondan con números o letras repetidas (pu7a, puuuta).
-- 2. Una cuenta suspendida (perfiles.bloqueado) no aparece en el ranking ni
--    guarda progreso. La pone el equipo; el usuario no puede cambiarla.
-- 3. El personaje elegido en el perfil se guarda en la cuenta (perfiles.personaje).
--
-- Las listas viven en tablas privadas: se agregan palabras sin tocar el sitio.
-- El sitio tiene una copia para avisar antes de enviar
-- (frontend/src/components/solo/account/nickname.ts): mantenerlas iguales.
--
-- Suspender a alguien:   update public.perfiles set bloqueado = true where apodo = 'X';
-- Levantar la suspensión: update public.perfiles set bloqueado = false where apodo = 'X';
-- Agregar una palabra:    insert into public.palabras_prohibidas values ('raiz');

-- 1. Listas (privadas: ni anon ni authenticated las pueden leer).
create table if not exists public.palabras_prohibidas (palabra text primary key);
create table if not exists public.palabras_permitidas (palabra text primary key);
alter table public.palabras_prohibidas enable row level security;
alter table public.palabras_permitidas enable row level security;
revoke all on public.palabras_prohibidas, public.palabras_permitidas from anon, authenticated;

insert into public.palabras_prohibidas (palabra) values
  ('puta'), ('puto'), ('pendej'), ('chinga'), ('verga'), ('culer'), ('culo'), ('mierda'),
  ('cabron'), ('joto'), ('marica'), ('pinche'), ('mamon'), ('mamada'), ('panocha'),
  ('naco'), ('pija'), ('cagar'), ('cagad'), ('estupid'), ('idiota'), ('imbecil'),
  ('sexo'), ('porno'), ('porn'), ('pene'), ('violad'), ('violacion'), ('pedofil'),
  ('pederast'), ('nazi'), ('hitler'), ('fuck'), ('shit'), ('bitch'), ('cunt'), ('pusy'),
  ('whore'), ('slut'), ('dick'), ('niga'), ('niger'), ('fagot'), ('retard'),
  -- Reservadas: hacerse pasar por el equipo.
  ('admin'), ('moderador'), ('soporte'), ('wewolf'), ('runit'), ('oficial')
on conflict do nothing;

insert into public.palabras_permitidas (palabra) values
  ('computa'), ('computo'), ('disputa'), ('reputa'), ('imputa'), ('diputa'), ('calcul'),
  ('articul'), ('vehicul'), ('ridicul'), ('curricul'), ('matricul'), ('cubicul'),
  ('penetr'), ('pijama')
on conflict do nothing;

-- 2. Normalización: minúsculas, números como letras (el 1 como i o como l), sin
--    guiones ni otros signos y sin letras repetidas.
create or replace function public.normalizar_apodo(apodo text, uno text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      translate(lower(apodo), '01345789áéíóúüñ', 'o' || uno || 'eastbgaeiouun'),
      '[^a-z]', '', 'g'),
    '(.)\1+', '\1', 'g');
$$;

create or replace function public.apodo_ofensivo(apodo text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uno text;
  texto text;
  ok record;
begin
  foreach uno in array array['i', 'l'] loop
    texto := public.normalizar_apodo(apodo, uno);
    for ok in select palabra from public.palabras_permitidas loop
      texto := replace(texto, ok.palabra, '');
    end loop;
    if exists (select 1 from public.palabras_prohibidas p where position(p.palabra in texto) > 0) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;
revoke all on function public.apodo_ofensivo(text) from public, anon, authenticated;

-- 3. Suspensión (solo la cambia el equipo, desde el panel o el SQL Editor) y
--    personaje elegido en el perfil (número de lib/characters.ts).
alter table public.perfiles add column if not exists bloqueado boolean not null default false;
alter table public.perfiles add column if not exists personaje smallint not null default 0;
alter table public.perfiles drop constraint if exists perfiles_personaje_rango;
alter table public.perfiles
  add constraint perfiles_personaje_rango check (personaje between 0 and 199);
revoke update on public.perfiles from authenticated;
grant update (apodo, en_ranking, personaje) on public.perfiles to authenticated;

-- 4. El trigger rechaza apodos ofensivos al crear o cambiar el apodo.
create or replace function public.revisar_apodo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.apodo_ofensivo(new.apodo) then
    raise exception 'apodo_no_permitido' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.revisar_apodo() from public, anon, authenticated;

drop trigger if exists perfiles_revisar_apodo on public.perfiles;
create trigger perfiles_revisar_apodo
  before insert or update of apodo on public.perfiles
  for each row execute function public.revisar_apodo();

-- Los apodos ofensivos que ya existían quedan suspendidos.
update public.perfiles set bloqueado = true where public.apodo_ofensivo(apodo) and not bloqueado;

-- 5. Una cuenta suspendida no guarda progreso.
drop policy if exists "progreso propio" on public.progreso;
create policy "progreso propio" on public.progreso
  for all to authenticated
  using ((select auth.uid()) = usuario)
  with check (
    (select auth.uid()) = usuario
    and not exists (
      select 1 from public.perfiles p where p.id = (select auth.uid()) and p.bloqueado
    )
  );

-- 6. Ranking sin cuentas suspendidas.
create or replace function public.ranking_global(limite integer default 100)
returns table (posicion bigint, apodo text, puntos bigint, resueltos bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    rank() over (order by sum(e.puntos) desc) as posicion,
    p.apodo,
    sum(e.puntos) as puntos,
    count(*) as resueltos
  from public.perfiles p
  join public.progreso pr on pr.usuario = p.id
  join public.ejercicios e on e.id = pr.tema
  where p.en_ranking and not p.bloqueado
  group by p.id, p.apodo
  order by puntos desc, max(pr.completado_en) asc
  limit least(greatest(limite, 1), 200);
$$;

drop function if exists public.mi_ranking();
create function public.mi_ranking()
returns table (posicion bigint, puntos bigint, resueltos bigint, en_ranking boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with mios as (
    select coalesce(sum(e.puntos), 0) as puntos, count(e.id) as resueltos
    from public.progreso pr
    join public.ejercicios e on e.id = pr.tema
    where pr.usuario = auth.uid()
  ),
  otros as (
    select sum(e.puntos) as puntos
    from public.perfiles p
    join public.progreso pr on pr.usuario = p.id
    join public.ejercicios e on e.id = pr.tema
    where p.en_ranking and not p.bloqueado and p.id <> auth.uid()
    group by p.id
  )
  select
    (select count(*) from otros where otros.puntos > mios.puntos) + 1,
    mios.puntos,
    mios.resueltos,
    coalesce((select en_ranking from public.perfiles where id = auth.uid()), false)
  from mios;
$$;
revoke all on function public.mi_ranking() from public, anon;
grant execute on function public.mi_ranking() to authenticated;
