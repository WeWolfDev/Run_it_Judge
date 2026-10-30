-- Run It Solo: límites de las tablas de cuentas (después de 001).
-- Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr.
--
-- La clave publishable es pública: cualquiera con una cuenta podría llamar a la
-- API a mano. RLS ya impide tocar datos ajenos; esto impide llenar la base o
-- guardar datos absurdos en los propios.

-- 1. Progreso: el tema es un identificador corto (ej. "busqueda-binaria") y el
--    tiempo, de 1 ms a 24 h.
alter table public.progreso drop constraint if exists progreso_tema_formato;
alter table public.progreso
  add constraint progreso_tema_formato check (tema ~ '^[a-z0-9-]{1,40}$');

alter table public.progreso drop constraint if exists progreso_mejor_ms_rango;
alter table public.progreso
  add constraint progreso_mejor_ms_rango check (mejor_ms is null or mejor_ms between 1 and 86400000);

-- 2. Progreso: como mucho 300 temas por cuenta (el roadmap tiene unos 30).
create or replace function public.limitar_progreso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.progreso where usuario = new.usuario) >= 300 then
    raise exception 'Límite de temas alcanzado' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.limitar_progreso() from public, anon, authenticated;

drop trigger if exists progreso_limite on public.progreso;
create trigger progreso_limite
  before insert on public.progreso
  for each row execute function public.limitar_progreso();

-- 3. Perfiles: el usuario solo puede cambiar su apodo, no la fecha de alta.
revoke update on public.perfiles from authenticated;
grant update (apodo) on public.perfiles to authenticated;

-- 4. Progreso: no se puede cambiar de dueño ni de tema al actualizar.
revoke update on public.progreso from authenticated;
grant update (completado_en, mejor_ms) on public.progreso to authenticated;
