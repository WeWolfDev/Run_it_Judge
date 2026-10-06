import { useCallback, useEffect, useState } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import {
  announcePoll,
  cancelHit,
  cancelPoll,
  closePollNow,
  formatLeft,
  getAdminHits,
  hitInfo,
  ms,
  type AdminHitsState,
} from "@/lib/hits";
import { createSocketFeed } from "@/lib/runit";
import { cn } from "@/lib/utils";

/**
 * Control del voto del público para la ronda en curso: anunciar un par (15 s
 * de aviso y 40 s de votación), cancelar el anuncio, cerrar antes, cortar un
 * hit activo e historial. Las reglas las decide el servidor; acá se muestra el
 * motivo de cada par bloqueado.
 */
export function HitsPanel({ roundId }: { roundId: string }) {
  const [state, setState] = useState<AdminHitsState | null>(null);
  const [pair, setPair] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      void getAdminHits(roundId)
        .then((next) => {
          setState(next);
          setOffset(next.server_now - Date.now());
        })
        .catch((error) => setMessage(error instanceof Error ? error.message : "Error")),
    [roundId],
  );

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const feed = createSocketFeed("");
    feed?.on("hits:update", (event) => event.round_id === roundId && load());
    feed?.on("hits:tally", load);
    return () => {
      clearInterval(poll);
      feed?.disconnect();
    };
  }, [load, roundId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const act = (task: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage("");
    void task()
      .then(() => {
        setMessage(done);
        load();
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Error"))
      .finally(() => setBusy(false));
  };

  if (!state) return null;
  const serverNow = now + offset;
  const poll = state.poll?.status === "open" ? state.poll : null;
  const announced = poll && serverNow < (ms(poll.opens_at) ?? 0);
  const blocked = state.pairs[pair]?.blocked ?? null;
  const live = state.active.filter((hit) => {
    const end = ms(hit.ends_at);
    return end === null || end > serverNow;
  });

  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <PixelIcon name="users" className="h-4 w-4 text-primary" /> Voto del público
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Votaciones en esta ronda:{" "}
        <b className="text-foreground">
          {state.polls_used} de {state.max_polls}
        </b>{" "}
        (se recomienda 1). La grada vota con el QR de la pista en /votar. Sin votaciones en el
        primer minuto ni en los últimos 2.
      </p>

      <div className="mt-3 space-y-1.5">
        {state.pairs.map((option) => (
          <label
            key={option.index}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
              pair === option.index ? "border-primary" : "border-border",
            )}
          >
            <input
              type="radio"
              name="hit-pair"
              checked={pair === option.index}
              onChange={() => setPair(option.index)}
            />
            <span className="w-14 shrink-0 text-xs text-muted-foreground">
              Peso {option.weight}
            </span>
            <span className="flex-1 text-sm">
              <b className="text-success">{hitInfo(option.good).name}</b>{" "}
              <span className="text-muted-foreground">contra</span>{" "}
              <b className="text-danger">{hitInfo(option.bad).name}</b>
            </span>
            {option.blocked && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {option.blocked}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || Boolean(blocked)}
          onClick={() => act(() => announcePoll(roundId, pair), "Votación anunciada")}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Anunciar votación (15 s + 40 s)
        </button>
        {poll && announced && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => cancelPoll(poll.id), "Anuncio cancelado")}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
          >
            Cancelar anuncio (abre en {formatLeft((ms(poll.opens_at) ?? 0) - serverNow)})
          </button>
        )}
        {poll && !announced && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => closePollNow(poll.id), "Votación cerrada")}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
          >
            Cerrar ya ({formatLeft((ms(poll.closes_at) ?? 0) - serverNow)} ·{" "}
            {poll.tally.good + poll.tally.bad} votos)
          </button>
        )}
        {blocked && <span className="text-xs text-muted-foreground">{blocked}</span>}
      </div>

      {live.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-foreground">Hits activos</p>
          {live.map((hit) => (
            <p key={hit.id} className="mt-1.5 flex items-center gap-3 text-xs">
              <b className={hitInfo(hit.hit).kind === "malo" ? "text-danger" : "text-success"}>
                {hitInfo(hit.hit).name}
              </b>
              <span className="text-muted-foreground">{hitInfo(hit.hit).scope}</span>
              <span className="ml-auto font-mono tabular-nums">
                {hit.ends_at ? formatLeft((ms(hit.ends_at) ?? 0) - serverNow) : "hasta el cierre"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => cancelHit(hit.id), "Hit cancelado")}
                className="rounded border border-border px-2 py-0.5"
              >
                Cancelar
              </button>
            </p>
          ))}
        </div>
      )}

      {state.history.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-foreground">Historial</p>
          {state.history.map((entry, i) => (
            <p key={entry.id} className="mt-1 text-xs text-muted-foreground">
              {i + 1}. {hitInfo(entry.good).name} {entry.good_votes} · {hitInfo(entry.bad).name}{" "}
              {entry.bad_votes} ·{" "}
              {entry.status === "cancelled" ? (
                "cancelada"
              ) : entry.winner ? (
                <b className="text-foreground">ganó {hitInfo(entry.winner).name}</b>
              ) : (
                "en curso"
              )}
            </p>
          ))}
        </div>
      )}
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}

export default HitsPanel;
