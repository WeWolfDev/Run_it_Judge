import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import { ProblemStatement } from "@/components/ProblemStatement";
import { ProjectedTrack } from "@/components/ProjectedTrack";
import { useBoard } from "@/hooks/use-board";
import { useLiveRace } from "@/hooks/use-live-race";
import { useRoundTimer } from "@/hooks/use-round-timer";
import { getCasterOverview, type CasterOverview } from "@/lib/caster";
import { formatLeft, useHits } from "@/lib/hits";
import { createSocketFeed, formatClock } from "@/lib/runit";
import { cn } from "@/lib/utils";

import { CasterSubmissions } from "./CasterSubmissions";
import { CasterVote } from "./CasterVote";
import { Whiteboard } from "./Whiteboard";

// Vista del caster (/caster): quien narra el torneo ve el enunciado de la ronda
// con sus ejemplos, la pista (o una pizarra para explicar), los envíos con su
// veredicto y su código, y la votación de la grada con el QR. Solo lee.
// Entre rondas todo queda en espera y los envíos muestran la ronda anterior.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
/** Cuánto se ve el podio al cerrar la ronda antes de pasar a "Esperando ronda". */
const PODIUM_MS = 10_000;

/** /caster/overview al montar, cada 5 s y cuando la ronda empieza o termina. */
function useOverview() {
  const [overview, setOverview] = useState<CasterOverview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void getCasterOverview()
        .then((next) => {
          if (!cancelled) {
            setOverview(next);
            setError("");
          }
        })
        .catch((loadError: Error) => {
          if (!cancelled) setError(loadError.message);
        });
    load();
    const poll = setInterval(load, 5000);
    // Todo lo que cambia la ronda o su problema, y cada (re)conexión o vuelta a
    // la pestaña: la vista se actualiza sola, sin recargar.
    const feed = createSocketFeed("");
    feed?.on("feed:connected", load);
    feed?.on("round:started", load);
    feed?.on("round:closed", load);
    feed?.on("round:updated", load);
    feed?.on("round:created", load);
    feed?.on("rounds:planned", load);
    feed?.on("problem:updated", load);
    return () => {
      cancelled = true;
      clearInterval(poll);
      feed?.disconnect();
    };
  }, []);
  return { overview, error };
}

export function CasterView() {
  const { overview, error } = useOverview();
  const race = useLiveRace();
  const hits = useHits();
  const board = useBoard();
  const [view, setView] = useState<"pista" | "pizarra">("pista");
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // La pista conserva la ronda cerrada (useLiveRace): se ve el podio un rato.
  const raceClosed = race.round?.closed ?? false;
  useEffect(() => {
    setClosedAt(raceClosed ? Date.now() : null);
  }, [raceClosed, race.round?.id]);

  const active = overview?.active ?? null;
  const waiting = overview !== null && !active;
  const showPodium = !active && raceClosed && closedAt !== null && now - closedAt < PODIUM_MS;
  const endsAt = race.round && race.round.id === active?.id ? race.round.endsAt : 0;
  const remaining = useRoundTimer(
    endsAt || (active ? new Date(active.ends_at).getTime() : 0),
    race.serverOffsetMs,
  );
  const live = active && race.round?.id === active.id ? race : null;
  const solved = live ? live.board.filter((entry) => entry.solved_at).length : 0;
  const fog = hits.isOn("niebla");
  const clockHidden = hits.isOn("reloj-oculto");
  const hint = active && hits.isOn("pista") ? hits.state?.hint : null;

  return (
    <div className="space-y-5">
      {error && !overview && (
        <p className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Barra: ronda · problema · clasificados · reloj. */}
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {active
              ? `Ronda ${active.round_number} · Cupo ${active.capacity}`
              : overview?.previous
                ? `Ronda ${overview.previous.round_number} terminada · sin ronda activa`
                : "Sin ronda activa"}
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">
            {active ? active.problem_name : overview ? "Esperando problema" : "Cargando…"}
          </h1>
        </div>
        {active && (
          <>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <PixelIcon name="users" className="h-4 w-4 text-primary" />
              Participantes: <b className="text-foreground">{live?.board.length ?? "—"}</b>
            </p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <PixelIcon name="trophy" className="h-4 w-4 text-primary" />
              Clasificados:{" "}
              <b className="text-foreground">
                {Math.min(solved, active.capacity)}/{active.capacity}
              </b>
            </p>
          </>
        )}
        <div className="text-right">
          <p
            className={cn(
              "flex items-center gap-2 font-mono text-4xl font-semibold tabular-nums",
              !active
                ? "text-muted-foreground"
                : remaining <= 10_000
                  ? "animate-run-it-hurry text-danger"
                  : remaining <= 60_000
                    ? "text-danger"
                    : "text-foreground",
            )}
            role="timer"
          >
            <PixelIcon name="clock" className="h-7 w-7" />
            {active ? formatClock(remaining) : "--:--"}
          </p>
          {active && clockHidden && (
            <p className="mt-1 text-xs text-danger">
              Reloj oculto al público · {formatLeft(hits.left("reloj-oculto"))}
            </p>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="flex max-h-[38rem] flex-col rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Enunciado
            </h2>
            {hint && (
              <p className="mt-3 rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-sm text-success">
                <b>Pista del organizador</b> (la ven los participantes): {hint}
              </p>
            )}
            {active ? (
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                <ProblemStatement statement={active.statement ?? ""} />
              </div>
            ) : (
              <Waiting
                title="Esperando problema"
                text="El enunciado aparece cuando el organizador inicie la próxima ronda."
              />
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <PixelIcon name="check" className="h-4 w-4 text-primary" /> Casos de prueba
              </h2>
              {active && (
                <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                  Ejemplos ({active.samples.length})
                </span>
              )}
            </div>
            {active ? (
              <div className="mt-3 space-y-3 text-xs">
                {active.samples.map((sample, index) => (
                  <div key={index} className="rounded-lg border border-border p-3">
                    <p className="font-medium text-foreground">Ejemplo {index + 1}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Sample label="Entrada" text={sample.stdin} />
                      <Sample label="Salida esperada" text={sample.expected} />
                    </div>
                  </div>
                ))}
                {!active.samples.length && (
                  <p className="text-muted-foreground">Este problema no tiene ejemplos.</p>
                )}
              </div>
            ) : (
              <Waiting title="Esperando problema" text="Los ejemplos llegan con el enunciado." />
            )}
          </section>

          <CasterVote hits={hits} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section className="rounded-xl border border-border bg-card p-3">
            <h2 className="flex flex-wrap items-center gap-2 px-2 pb-2 text-sm font-semibold text-foreground">
              {/* Pestañas: solo cambia esta escena; los envíos quedan debajo. */}
              <span
                role="tablist"
                aria-label="Escena"
                className="flex gap-1 rounded-lg bg-muted p-1"
              >
                {(
                  [
                    ["pista", "Pista", "play"],
                    ["pizarra", "Pizarra", "code"],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={view === id}
                    onClick={() => setView(id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium",
                      view === id
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <PixelIcon name={icon} className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </span>
              <span className="font-normal text-muted-foreground">
                {view === "pizarra" ? "· para explicar la solución" : "· la carrera en vivo"}
              </span>
              {view === "pista" && active && hits.isOn("apagon") && (
                <span className="ml-auto rounded-md bg-danger-soft px-2 py-0.5 text-xs text-danger">
                  Apagón en las pantallas del público · {formatLeft(hits.left("apagon"))}
                </span>
              )}
            </h2>
            {view === "pizarra" ? (
              <Whiteboard board={board} />
            ) : (active || showPodium) && race.round ? (
              <Scaled>
                <ProjectedTrack
                  round={race.round}
                  board={race.board}
                  events={race.events}
                  serverOffsetMs={race.serverOffsetMs}
                  fog={
                    fog ? `Niebla · el ranking vuelve en ${formatLeft(hits.left("niebla"))}` : null
                  }
                  clockHidden={clockHidden}
                />
              </Scaled>
            ) : (
              <TrackStandby loading={!overview || (Boolean(active) && race.load === "loading")} />
            )}
            <CasterSubmissions
              live={active ? { id: active.id, round_number: active.round_number } : null}
              previous={overview?.previous ?? null}
              onToBoard={(title, code) => {
                board.addCode(title, code);
                setView("pizarra");
              }}
            />
          </section>
        </div>
      </div>
      {waiting && (
        <p className="sr-only" role="status">
          No hay ronda activa
        </p>
      )}
    </div>
  );
}

function Sample({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-foreground">
        {text}
      </pre>
    </div>
  );
}

/** Recuadro de espera entre rondas (enunciado y casos). */
function Waiting({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid flex-1 place-items-center py-10 text-center">
      <div>
        <span className="run-it-spinner mx-auto" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <p className="mt-4 text-sm text-foreground" style={PIXEL}>
          {title}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

/** La pista entre rondas: como /pista cuando no hay ronda activa. */
function TrackStandby({ loading }: { loading: boolean }) {
  return (
    <div className="grid aspect-video place-items-center rounded-lg border border-border bg-background px-6 text-center">
      <div>
        <p className="text-[clamp(1.2rem,2.4vw,2.6rem)] text-primary" style={PIXEL}>
          Run&nbsp;It
        </p>
        <p className="animate-run-it-blink mt-5 text-sm text-foreground" style={PIXEL}>
          {loading ? "Cargando la pista…" : "Esperando ronda"}
        </p>
        {!loading && (
          <p className="mt-3 text-sm text-muted-foreground">
            La pista vuelve sola cuando el organizador inicie la próxima ronda.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * La pista de /pista ocupa la pantalla entera (position: fixed y medidas en vw).
 * Acá se dibuja con el ancho de la ventana y alto 16:9 (como un proyector) y se
 * achica al ancho del recuadro: el transform hace que lo fixed quede adentro.
 */
function Scaled({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, vw: 1280 });
  useLayoutEffect(() => {
    const measure = () => setBox({ width: ref.current?.clientWidth ?? 0, vw: window.innerWidth });
    measure();
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const scale = box.width / box.vw;
  const height = (box.vw * 9) / 16;
  return (
    <div
      ref={ref}
      className="caster-pista relative overflow-hidden rounded-lg border border-border"
      style={{ height: height * scale }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: box.vw,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}
