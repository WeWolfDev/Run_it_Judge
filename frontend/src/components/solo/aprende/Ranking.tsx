import { useCallback, useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import type { Account } from "@/components/solo/account/useAccount";
import { supabase } from "@/lib/solo-supabase";

import { tierOf } from "./rank";

// Ranking global: apodos y puntos de quienes lo activaron (perfiles.en_ranking).
// Lo calcula Supabase con los puntos del catálogo (ranking_global, mi_ranking):
// el navegador no los puede inflar. Como el juez corre en el navegador, sigue
// siendo de honor: lo dice la página.

type Row = { posicion: number; apodo: string; puntos: number; resueltos: number };
type Mine = { posicion: number; puntos: number; resueltos: number; en_ranking: boolean };

export function Ranking({ account }: { account: Account }) {
  const { state } = account;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const signedIn = state.status === "ready";

  const load = useCallback(async () => {
    setError(null);
    const { data, error: rankError } = await supabase.rpc("ranking_global", { limite: 100 });
    if (rankError) {
      setError("No se pudo cargar el ranking. Intenta de nuevo en un momento.");
      return;
    }
    setRows(data as Row[]);
    if (signedIn) {
      const { data: me } = await supabase.rpc("mi_ranking");
      setMine(((me as Mine[] | null) ?? [])[0] ?? null);
    } else setMine(null);
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (on: boolean) => {
    if (state.status !== "ready") return;
    // Se marca al instante; si falla, load() vuelve a lo que diga el servidor.
    setMine((current) => (current ? { ...current, en_ranking: on } : current));
    setSaving(true);
    const { error: upError } = await supabase
      .from("perfiles")
      .update({ en_ranking: on })
      .eq("id", state.userId);
    setSaving(false);
    if (upError) setError("No se pudo cambiar tu participación en el ranking.");
    await load();
  };

  const myName = state.status === "ready" ? state.apodo : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="min-w-0 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <PixelIcon name="trophy" className="h-5 w-5 text-silk-2" /> Ranking global
          </h1>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Actualizar
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        {rows === null && !error && <p className="mt-3 text-sm text-muted-foreground">Cargando…</p>}
        {rows?.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Todavía nadie se sumó al ranking. Resuelve ejercicios y activa tu participación para ser
            el primero.
          </p>
        )}
        {rows && rows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Apodo</th>
                  <th className="pb-2 pr-3 text-right font-medium">XP</th>
                  <th className="pb-2 text-right font-medium">Resueltos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.apodo} className={row.apodo === myName ? "bg-primary/10" : ""}>
                    <td className="py-2 pr-3 font-mono tabular-nums text-muted-foreground">
                      {row.posicion <= 3 ? ["🥇", "🥈", "🥉"][row.posicion - 1] : row.posicion}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className="font-mono font-semibold"
                        style={{ color: tierOf(row.puntos).color }}
                      >
                        {row.apodo}
                      </span>
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {tierOf(row.puntos).name}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-silk-2">
                      {row.puntos}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{row.resueltos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          El juez corre en el navegador de cada quien: el ranking es de práctica y de honor. Solo
          cuenta un ejercicio resuelto una vez, con los puntos que fija el catálogo.
        </p>
      </section>

      <aside className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Tu lugar</h2>
        {state.status !== "ready" ? (
          <p className="text-sm text-muted-foreground">
            Entra con GitHub o Google (botón de arriba) para guardar tu progreso y aparecer en el
            ranking.
          </p>
        ) : (
          <>
            {mine && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <Tile label="Puesto" value={mine.en_ranking ? `#${mine.posicion}` : "—"} />
                <Tile label="XP" value={String(mine.puntos)} />
                <Tile label="Resueltos" value={String(mine.resueltos)} />
              </div>
            )}
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                id="solo-en-ranking"
                type="checkbox"
                checked={mine?.en_ranking ?? false}
                disabled={saving || mine === null}
                onChange={(event) => void toggle(event.target.checked)}
                className="mt-1 h-4 w-4 accent-[var(--primary)]"
              />
              <span>
                Aparecer en el ranking global con mi apodo{" "}
                <b className="font-mono">{state.apodo}</b>
              </span>
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Si lo activas, cualquiera que abra el sitio verá tu apodo, tus XP y cuántos ejercicios
              resolviste. Nunca tu correo. Puedes desactivarlo cuando quieras.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
