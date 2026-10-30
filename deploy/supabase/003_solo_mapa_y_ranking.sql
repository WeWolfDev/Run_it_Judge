-- Run It Solo: catálogo de ejercicios del mapa y ranking global (después de 002).
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr.
--
-- progreso.tema pasa a ser el id de un ejercicio del catálogo (clave foránea):
-- nadie puede guardar ejercicios inventados, y los puntos los pone el servidor,
-- no el navegador. Al agregar ejercicios en frontend/src/components/solo/aprende/
-- content.ts, agregarlos aquí con los mismos puntos (en un archivo nuevo).

-- 1. Catálogo de ejercicios: lo puede leer cualquiera, nadie lo escribe por la API.
create table if not exists public.ejercicios (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  tema text not null,
  puntos integer not null check (puntos between 1 and 1000)
);
alter table public.ejercicios enable row level security;
revoke all on public.ejercicios from anon, authenticated;
grant select on public.ejercicios to anon, authenticated;
drop policy if exists "catalogo publico" on public.ejercicios;
create policy "catalogo publico" on public.ejercicios for select to anon, authenticated using (true);

insert into public.ejercicios (id, tema, puntos) values
  ('ini-saludo', 'primer-programa', 10),
  ('ini-suma', 'primer-programa', 10),
  ('ini-producto', 'tipos', 20),
  ('ini-tiempo', 'tipos', 20),
  ('ini-paridad', 'condicionales', 20),
  ('ini-mayor', 'condicionales', 20),
  ('ini-suma-n', 'bucles', 20),
  ('ini-tabla', 'bucles', 20),
  ('ini-maximo', 'arreglos', 30),
  ('ini-invertir', 'arreglos', 30),
  ('ini-vocales', 'strings', 30),
  ('ini-palindromo', 'strings', 30),
  ('ini-mcd', 'funciones', 30),
  ('ini-primos', 'funciones', 40),
  ('ini-pares', 'complejidad', 50),
  ('ini-distintos', 'complejidad', 40),
  ('ini-entrada-grande', 'entrada-rapida', 40)
on conflict (id) do update set tema = excluded.tema, puntos = excluded.puntos;

-- 2. progreso.tema solo admite ejercicios del catálogo.
delete from public.progreso where tema not in (select id from public.ejercicios);
alter table public.progreso drop constraint if exists progreso_ejercicio_fk;
alter table public.progreso
  add constraint progreso_ejercicio_fk foreign key (tema) references public.ejercicios (id);

-- 3. Ranking opcional: solo aparece quien lo activa desde su perfil.
alter table public.perfiles add column if not exists en_ranking boolean not null default false;
revoke update on public.perfiles from authenticated;
grant update (apodo, en_ranking) on public.perfiles to authenticated;

-- 4. Ranking global: apodo, puntos y ejercicios resueltos de quienes lo activaron.
--    Nunca devuelve correos ni ids de cuenta. Lo puede leer cualquiera.
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
  where p.en_ranking
  group by p.id, p.apodo
  order by puntos desc, max(pr.completado_en) asc
  limit least(greatest(limite, 1), 200);
$$;
revoke all on function public.ranking_global(integer) from public;
grant execute on function public.ranking_global(integer) to anon, authenticated;

-- 5. Mi posición, aunque no esté en el top ni tenga el ranking activado.
create or replace function public.mi_ranking()
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
    where p.en_ranking and p.id <> auth.uid()
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
