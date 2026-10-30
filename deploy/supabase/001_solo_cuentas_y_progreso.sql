-- Run It Solo: cuentas y progreso del roadmap.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr.
--
-- Qué guarda: un apodo por cuenta y los temas completados. Nada más.
-- Seguridad: RLS en las dos tablas; cada usuario solo ve y edita lo suyo.
-- El rol anon (sin sesión) no tiene ningún permiso.

-- 1. Perfiles: un apodo visible por cuenta (nunca el correo).
create table if not exists public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  apodo text not null
    check (char_length(apodo) between 3 and 20 and apodo ~ '^[A-Za-z0-9_-]+$'),
  creado_en timestamptz not null default now()
);
-- Apodo único sin importar mayúsculas: "Leo" y "leo" no pueden convivir.
create unique index if not exists perfiles_apodo_unico on public.perfiles (lower(apodo));

-- 2. Progreso: un registro por tema completado.
create table if not exists public.progreso (
  usuario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tema text not null check (char_length(tema) between 1 and 40),
  completado_en timestamptz not null default now(),
  mejor_ms integer check (mejor_ms > 0),
  primary key (usuario, tema)
);

-- 3. RLS encendido (aunque el trigger automático ya lo haga).
alter table public.perfiles enable row level security;
alter table public.progreso enable row level security;

-- 4. Permisos explícitos: "Automatically expose new tables" está apagado.
revoke all on public.perfiles, public.progreso from anon, authenticated;
grant select, insert, update, delete on public.perfiles to authenticated;
grant select, insert, update, delete on public.progreso to authenticated;

-- 5. Políticas: cada quien solo lo suyo.
drop policy if exists "perfil propio" on public.perfiles;
create policy "perfil propio" on public.perfiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "progreso propio" on public.progreso;
create policy "progreso propio" on public.progreso
  for all to authenticated
  using ((select auth.uid()) = usuario)
  with check ((select auth.uid()) = usuario);

-- 6. "Borrar mi cuenta": elimina al usuario y, en cascada, su perfil y progreso.
create or replace function public.borrar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.borrar_mi_cuenta() from public, anon;
grant execute on function public.borrar_mi_cuenta() to authenticated;
