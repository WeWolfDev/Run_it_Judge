import { useCallback, useEffect, useRef, useState } from "react";

import { CodeEditor } from "@/components/CodeEditor";
import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import {
  getCasterSubmission,
  getCasterSubmissions,
  verdictStyle,
  type CasterSubmission,
  type CasterSubmissionDetail,
  type CasterSubmissionList,
} from "@/lib/caster";
import { characterAt } from "@/lib/characters";
import { createSocketFeed, formatClock, LANGUAGE_LABEL, verdictLabel } from "@/lib/runit";
import { cn } from "@/lib/utils";

// Envíos de la ronda para el caster: en qué falló cada uno (WA, TLE, CE, RE) y
// su código, para contarle al público por qué pasó una parte de los casos.
// Entre rondas muestra la anterior, con sus códigos.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const FILTERS = ["Todos", "WA", "TLE", "CE", "RE", "AC"] as const;
const FILTER_VERDICT: Record<(typeof FILTERS)[number], string> = {
  Todos: "",
  WA: "Wrong Answer",
  TLE: "Time Limit Exceeded",
  CE: "Compilation Error",
  RE: "Runtime Error",
  AC: "accepted",
};

type RoundRef = { id: string; round_number: number };

/** Envíos de una ronda: al montar, cada 4 s y con cada avance que llega por socket. */
function useRoundSubmissions(roundId: string | null) {
  const [list, setList] = useState<CasterSubmissionList | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setList(null);
    setError("");
    if (!roundId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void getCasterSubmissions(roundId)
        .then((next) => {
          if (!cancelled) {
            setList(next);
            setError("");
          }
        })
        .catch((loadError: Error) => {
          if (!cancelled) setError(loadError.message);
        });
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    load();
    const poll = setInterval(load, 4000);
    const feed = createSocketFeed("");
    feed?.on("participant:progress", soon);
    feed?.on("round:closed", soon);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(poll);
      feed?.disconnect();
    };
  }, [roundId]);

  return { list, error };
}

export function CasterSubmissions({
  live,
  previous,
  onToBoard,
}: {
  /** La ronda en curso; null entre rondas. */
  live: RoundRef | null;
  /** La última ronda cerrada, para repasar sus códigos. */
  previous: RoundRef | null;
  onToBoard: (title: string, code: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Todos");
  const [viewing, setViewing] = useState<string | null>(null);
  const round = live && !(showPast && previous) ? live : previous;
  const { list, error } = useRoundSubmissions(round?.id ?? null);
  const subs = list?.submissions ?? [];
  const startedAt = new Date(list?.round.starts_at ?? list?.round.started_at ?? 0).getTime();

  useEffect(() => {
    if (!live) setShowPast(false);
  }, [live]);

  const counts = new Map<string, number>();
  subs.forEach((sub) => {
    const code = verdictStyle(sub.verdict).code;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  });
  const shown = subs.filter(
    (sub) => filter === "Todos" || verdictStyle(sub.verdict).code === filter,
  );

  return (
    <div className="relative mt-3 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <PixelIcon name="code" className="h-4 w-4 text-primary" /> Envíos
          {round && (
            <span className="text-sm font-normal text-muted-foreground">
              · ronda {round.round_number}
              {round === live ? "" : " (anterior)"} · {subs.length}
            </span>
          )}
        </h3>
        {live && previous && (
          <span
            role="tablist"
            aria-label="Ronda"
            className="flex gap-1 rounded-lg bg-muted p-1 text-xs"
          >
            {(
              [
                [false, "Ronda actual"],
                [true, `Ronda ${previous.round_number} (anterior)`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={showPast === value}
                onClick={() => setShowPast(value)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium",
                  showPast === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </span>
        )}
        <div role="tablist" aria-label="Filtrar envíos" className="flex flex-wrap gap-1.5">
          {FILTERS.map((key) => {
            const color =
              key === "Todos" ? "var(--primary)" : verdictStyle(FILTER_VERDICT[key]).color;
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(key)}
                className="rounded-md border px-2.5 py-1 font-mono text-sm font-semibold"
                style={{
                  borderColor: color,
                  background: active ? color : "transparent",
                  color: active ? "var(--background)" : color,
                }}
              >
                {key}
                {key !== "Todos" && (
                  <span className="ml-1.5 opacity-80">{counts.get(key) ?? 0}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!live && (
        <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm">
          <p className="font-semibold text-foreground">No hay ronda activa</p>
          <p className="mt-0.5 text-muted-foreground">
            {previous
              ? `Abajo están los envíos de la ronda ${previous.round_number}: con "Ver" puedes repasar los códigos.`
              : "Los envíos aparecen cuando empiece la ronda."}
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {round && (
        <div className="mt-3 max-h-[26rem] overflow-y-auto pr-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Minuto</th>
                <th className="py-2 pr-3 font-medium">Participante</th>
                <th className="py-2 pr-3 font-medium">Veredicto</th>
                <th className="py-2 pr-3 font-medium">Tests</th>
                <th className="py-2 pr-3 text-right font-medium">Penalización</th>
                <th className="py-2 text-right font-medium">Código</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((sub) => (
                <Row
                  key={sub.id}
                  sub={sub}
                  startedAt={startedAt}
                  onView={() => setViewing(sub.id)}
                />
              ))}
            </tbody>
          </table>
          {list && !shown.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {subs.length ? "No hay envíos con ese veredicto." : "Todavía no hay envíos."}
            </p>
          )}
        </div>
      )}

      {list?.fog && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-background/85 text-center backdrop-blur-sm">
          <p className="px-4 text-sm text-foreground" style={PIXEL}>
            Niebla · los envíos vuelven cuando se disipe
          </p>
        </div>
      )}

      {viewing && (
        <CodeViewer
          id={viewing}
          onClose={() => setViewing(null)}
          onToBoard={(title, code) => {
            setViewing(null);
            onToBoard(title, code);
          }}
        />
      )}
    </div>
  );
}

function Row({
  sub,
  startedAt,
  onView,
}: {
  sub: CasterSubmission;
  startedAt: number;
  onView: () => void;
}) {
  const style = verdictStyle(sub.verdict);
  const total = Math.max(1, sub.test_cases_total);
  return (
    <tr className="animate-run-it-rise border-t border-border">
      <td className="py-2 pr-3 font-mono text-muted-foreground">
        {formatClock(Math.max(0, new Date(sub.submitted_at).getTime() - startedAt))}
      </td>
      <td className="py-2 pr-3">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <MiniSprite index={sub.character} />
          <span className="truncate">{sub.display_name}</span>
        </span>
      </td>
      <td className="py-2 pr-3">
        <span className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 font-mono text-sm font-bold text-background"
            style={{ background: style.color }}
          >
            {style.code}
          </span>
          <span style={{ color: style.color }}>{verdictLabel(sub.verdict)}</span>
        </span>
      </td>
      <td className="py-2 pr-3">
        <span className="flex items-center gap-2 font-mono text-foreground">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(sub.test_cases_passed / total) * 100}%`,
                background: style.color,
              }}
            />
          </span>
          {sub.test_cases_passed}/{sub.test_cases_total}
        </span>
      </td>
      <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
        {sub.penalty_seconds ? `+${sub.penalty_seconds} s` : "—"}
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
        >
          <PixelIcon name="code" className="h-3.5 w-3.5" /> Ver
        </button>
      </td>
    </tr>
  );
}

/**
 * Personaje chico para la lista. Sprite no baja de su tamaño real (factor 1) y
 * cada hoja tiene otro cuadro: se dibuja a tamaño real y se achica con
 * transform hasta entrar en la casilla de 40 px.
 */
export function MiniSprite({ index }: { index: number }) {
  const character = characterAt(index);
  const width = character.gif ? character.gif.width : character.fw;
  const height = character.gif ? character.gif.height : character.fh;
  const zoom = 48 / Math.max(height, width * 0.8);
  return (
    <span className="relative block h-10 w-10 shrink-0 overflow-hidden">
      <span
        className="absolute bottom-0 left-1/2 block"
        style={{
          width,
          height,
          transform: `translateX(-50%) scale(${zoom})`,
          transformOrigin: "bottom center",
        }}
      >
        <Sprite index={index} scale={0.01} />
      </span>
    </span>
  );
}

/**
 * Código de un envío: el editor en solo lectura y el resultado de cada caso. El
 * de un Aceptado con la ronda en curso no llega del servidor (locked).
 */
function CodeViewer({
  id,
  onClose,
  onToBoard,
}: {
  id: string;
  onClose: () => void;
  onToBoard: (title: string, code: string) => void;
}) {
  const [detail, setDetail] = useState<CasterSubmissionDetail | null>(null);
  const [error, setError] = useState("");
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let cancelled = false;
    getCasterSubmission(id)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onKey = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") close.current();
  }, []);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const style = detail ? verdictStyle(detail.verdict) : null;
  const firstFail = detail ? detail.case_results.findIndex((result) => !result.passed) : -1;
  const closed = detail?.round_status === "closed";

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Código del envío"
        className="max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-xl border border-border bg-card text-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4">
          {detail && style ? (
            <>
              <MiniSprite index={detail.character} />
              <div className="min-w-0">
                <p className="text-lg font-semibold">{detail.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  Ronda {detail.round_number} · envío {detail.attempt} ·{" "}
                  {LANGUAGE_LABEL[detail.language] ?? detail.language}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <span
                  className="rounded px-2 py-0.5 font-mono text-sm font-bold text-background"
                  style={{ background: style.color }}
                >
                  {style.code}
                </span>
                <span style={{ color: style.color }}>{verdictLabel(detail.verdict)}</span>
              </span>
              <span className="font-mono text-sm">
                {detail.test_cases_passed}/{detail.test_cases_total} tests
              </span>
              <button
                type="button"
                onClick={() =>
                  detail.code !== null &&
                  onToBoard(
                    `${detail.display_name} · ${style.code} ${detail.test_cases_passed}/${detail.test_cases_total} · ${LANGUAGE_LABEL[detail.language] ?? detail.language}`,
                    detail.code,
                  )
                }
                disabled={detail.locked || detail.code === null}
                title={
                  detail.locked
                    ? "Una solución aceptada se revela al cerrar la ronda"
                    : "Pega el código en la pizarra para explicarlo"
                }
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PixelIcon name="code" className="h-3.5 w-3.5" /> Llevar a la pizarra
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{error || "Cargando el envío…"}</p>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className={cn(
              "rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground",
              !detail && "ml-auto",
            )}
          >
            <PixelIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        {detail && style && (
          <>
            <p
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 text-sm",
                closed ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
              )}
            >
              <PixelIcon name={closed ? "check" : "skull"} className="h-4 w-4 shrink-0" />
              {closed
                ? "Ronda cerrada: ya puedes mostrar este código en la transmisión."
                : "Ronda en curso: puedes llevarlo a la pizarra para explicar el error, sin dar la solución completa."}
            </p>

            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
              <div className="caster-code overflow-hidden rounded-lg border border-editor-border bg-editor">
                <div className="flex items-center gap-2 border-b border-editor-border px-3 py-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
                  <span className="font-mono text-xs text-editor-foreground">
                    solution.{detail.language === "python" ? "py" : detail.language}
                  </span>
                  <span className="ml-auto text-xs text-editor-muted">Solo lectura</span>
                </div>
                {detail.locked || detail.code === null ? (
                  <div className="grid h-96 place-items-center px-6 text-center">
                    <div>
                      <PixelIcon name="trophy" className="mx-auto h-8 w-8 text-success" />
                      <p className="mt-3 text-sm text-editor-foreground">
                        Es una solución aceptada: se revela cuando cierre la ronda.
                      </p>
                      <p className="mt-1 text-xs text-editor-muted">
                        Así nadie la ve antes de terminar, ni siquiera de rebote en la transmisión.
                      </p>
                    </div>
                  </div>
                ) : (
                  <CodeEditor
                    key={detail.id}
                    value={detail.code}
                    onChange={() => undefined}
                    language={detail.language}
                    readOnly
                  />
                )}
              </div>

              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <PixelIcon name="check" className="h-4 w-4 text-primary" /> Casos
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {!detail.case_results.length
                    ? detail.verdict === "Compilation Error"
                      ? "No compiló: no corrió ningún caso."
                      : "Este envío no tiene resultado por caso."
                    : firstFail === -1
                      ? `Pasó los ${detail.case_results.length} casos.`
                      : `Pasó ${detail.test_cases_passed} de ${detail.test_cases_total}. El primer caso que falla es el ${firstFail + 1}.`}
                </p>
                <div className="mt-3 grid grid-cols-6 gap-1.5">
                  {detail.case_results.map((result, index) => (
                    <span
                      key={index}
                      title={`Caso ${index + 1}: ${result.passed ? "correcto" : verdictLabel(result.status)}`}
                      className={cn(
                        "grid h-9 place-items-center rounded-md font-mono text-xs font-semibold",
                        result.passed ? "bg-success-soft text-success" : "text-background",
                        index === firstFail && "ring-2 ring-foreground",
                      )}
                      style={
                        result.passed
                          ? undefined
                          : { background: verdictStyle(result.status).color }
                      }
                    >
                      {index + 1}
                    </span>
                  ))}
                </div>
                <p className="mt-4 rounded-lg border border-border p-3 text-xs text-muted-foreground">
                  Ningún caso muestra su entrada, igual que para los participantes. Si falla desde
                  la mitad, suele ser un borde o el tamaño de la entrada.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
