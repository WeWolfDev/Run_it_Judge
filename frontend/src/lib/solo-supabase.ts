import { createClient } from "@supabase/supabase-js";

// Cuentas del modo solo publicado en GitHub Pages (MODO_SOLO_PAGES.md). Solo lo
// importa el modo solo: el Run It del torneo no usa Supabase.
//
// La URL y la clave publishable son públicas por diseño: viajan en el sitio y no
// dan acceso a nada sin las políticas RLS de las tablas (perfiles, progreso).
// La clave secreta (service_role) nunca va aquí.
export const SUPABASE_URL = "https://qyqodhnhltiyzzzdekoy.supabase.co";
const SUPABASE_KEY = "sb_publishable_ZY9_iGfr1W9mzxGY--17ww_KhLlKeS9";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // PKCE devuelve ?code= en la URL: el hash queda libre para #privacidad y
    // las demás páginas legales.
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
