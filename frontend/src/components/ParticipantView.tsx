import { useEffect, useRef, useState } from "react";
import { createSocketFeed, formatClock, type RoundStatus } from "@/lib/runit";
import { useRoundTimer, useServerClockOffset } from "@/hooks/use-round-timer";
import { CharacterCarousel } from "@/components/CharacterCarousel";
import { ProblemStatement } from "@/components/ProblemStatement";
import { getActiveRound, getRoundLeaderboard, joinRound, submitRound } from "@/lib/api";
import {
  getCharacterConfirmed,
  getSelectedCharacter,
  getSession,
  setCharacterConfirmed,
} from "@/lib/session";

// Las claves coinciden con LANGUAGE_IDS de judge0-client.js. "cpp", no "c++".
// Sin JavaScript ni Java: el sandbox de Judge0 en este host no deja arrancar
// ni a Node ni a la JVM (TLE seguro o error de VM).
const LANGUAGES = {
  python: { label: "Python 3", file: "solution.py" },
  c: { label: "C", file: "solution.c" },
  cpp: { label: "C++", file: "solution.cpp" },
} as const;

type Language = keyof typeof LANGUAGES;

// Se muestran como placeholder del textarea vacío, nunca como su valor: así el
// participante no puede enviar la plantilla sin querer.
const PLACEHOLDERS: Record<Language, string> = {
  python: `import sys
def main():
    # Lee desde la entrada estándar (stdin)
    # --- ESCRIBE TU LÓGICA AQUÍ ---
    pass
if __name__ == '__main__':
    main()`,
  c: `#include <stdio.h>
int main() {
    // --- ESCRIBE TU LÓGICA AQUÍ ---
    return 0;
}`,
  cpp: `#include <iostream>
using namespace std;
int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    // --- ESCRIBE TU LÓGICA AQUÍ ---
    return 0;
}`,
};

// Casos marcados como ejemplo por el admin. El servidor ya los proyecta a
// stdin/expected: los demás casos nunca llegan al cliente.
type SampleCase = { stdin: string; expected: string };

type RoundInfo = {
  id: string;
  number: number | null;
  problem: string;
  capacity: number;
  statement: string;
  samples: SampleCase[];
};

// Estado vivo de la ronda. Lo siembra /public/rounds/active y desde ahí lo
// actualizan solo el snapshot y los eventos del socket: es la única fuente de
// verdad para el bloqueo del editor.
type LiveRound = { status: RoundStatus; paused: boolean; endsAt: number };

type Standing = { participant_id: string; name: string; rank: number; advanced: boolean };

type Load = "loading" | "none" | "error" | "ready";

export function ParticipantView() {
  const [load, setLoad] = useState<Load>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [live, setLive] = useState<LiveRound | null>(null);
  // Guarda la ronda junto al id: así nunca se envía con el participante de otra.
  const [participant, setParticipant] = useState<{ roundId: string; id: string } | null>(null);
  const [joinError, setJoinError] = useState("");
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState<Language>("python");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  // null hasta leer localStorage en el cliente: el SSR no sabe si ya eligió, y
  // renderizar cualquiera de las dos pantallas antes provocaría un salto visible.
  const [characterConfirmed, setConfirmedState] = useState<boolean | null>(null);
  const serverOffsetMs = useServerClockOffset(setMessage);
  const remaining = useRoundTimer(live?.endsAt ?? 0, serverOffsetMs);
  const username = getSession()?.username || "demo";
  const roundIdRef = useRef<string | null>(null);
  roundIdRef.current = round?.id ?? null;

  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    setConfirmedState(getCharacterConfirmed(username));
  }, [username]);

  // Detecta la ronda activa y se inscribe en ella. Sin la inscripción el socket
  // devuelve un snapshot null y el participante no aparece en la pista.
  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    setParticipant(null);
    setJoinError("");
    setStandings(null);
    void (async () => {
      let remote: Awaited<ReturnType<typeof getActiveRound>>;
      try {
        remote = await getActiveRound();
      } catch {
        if (!cancelled) setLoad("error");
        return;
      }
      if (cancelled) return;
      if (!remote) {
        setRound(null);
        setLive(null);
        setLoad("none");
        return;
      }
      // `samples` y `paused` vienen en /public/rounds/active; el tipo de api.ts no los declara.
      const extra = remote as { samples?: SampleCase[]; paused?: boolean; round_number?: number };
      setRound({
        id: remote.id,
        number: extra.round_number ?? null,
        problem: remote.problem_name,
        capacity: remote.capacity,
        statement: remote.statement,
        samples: Array.isArray(extra.samples) ? extra.samples : [],
      });
      setLive({
        status: "active",
        paused: Boolean(extra.paused),
        endsAt: new Date(remote.ends_at).getTime(),
      });
      setLoad("ready");
      // Sin personaje confirmado no se inscribe: lo hace confirmCharacter. Así el
      // admin nunca ve un inscripto con el personaje 0 que en realidad no eligió.
      // Se lee acá, después del await, por si confirmó mientras cargaba la ronda.
      if (!getCharacterConfirmed(username)) return;
      try {
        // Idempotente en el backend: ON CONFLICT en participants y en round_participants.
        const joined = await joinRound(remote.id, username, getSelectedCharacter(username));
        if (!cancelled) setParticipant({ roundId: remote.id, id: joined.id });
      } catch (error) {
        if (!cancelled) {
          setJoinError(error instanceof Error ? error.message : "No se pudo entrar a la ronda");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, username]);

  const joinedRoundId = participant?.roundId;
  const participantId = participant?.id;

  // Sin ronda el socket igual se conecta, para enterarse de round:started. Con
  // inscripción se une a la sala de la ronda y pide el snapshot.
  useEffect(() => {
    const feed = createSocketFeed(joinedRoundId);
    if (!feed) return;
    feed.on("round:snapshot", (snapshot) => {
      if (!snapshot || snapshot.id !== joinedRoundId) return;
      setLive({
        status: snapshot.status,
        paused: Boolean(snapshot.paused),
        endsAt: snapshot.ends_at ? new Date(snapshot.ends_at).getTime() : 0,
      });
    });
    feed.on("round:started", (event) => {
      if (event.round_id === roundIdRef.current) {
        setLive(
          (current) =>
            current && { ...current, status: "active", endsAt: new Date(event.ends_at).getTime() },
        );
        return;
      }
      // Otra ronda: se vuelve a detectar y a inscribir, sin recargar la página.
      setReloadKey((key) => key + 1);
    });
    feed.on("round:paused", (event) => {
      if (event.id !== roundIdRef.current) return;
      setLive((current) => current && { ...current, paused: Boolean(event.paused) });
    });
    feed.on("round:closed", (event) => {
      // round:closed no trae el id de la ronda: se reconoce por el participante.
      const mine = event.ranking.find((entry) => entry.participant_id === participantId);
      if (!mine) return;
      setLive((current) => current && { ...current, status: "closed" });
      const closedRoundId = joinedRoundId;
      const fallback = event.ranking.map((entry) => ({
        participant_id: entry.participant_id,
        name: entry.participant_id === participantId ? username : "—",
        rank: entry.final_rank,
        advanced: entry.final_status === "advanced",
      }));
      setStandings(fallback);
      if (!closedRoundId) return;
      // El evento solo trae ids; los nombres salen del ranking de la ronda.
      void getRoundLeaderboard(closedRoundId)
        .then((rows) => {
          const names = new Map(rows.map((row) => [row.participant_id, row.display_name]));
          setStandings(
            fallback.map((entry) => ({
              ...entry,
              name: names.get(entry.participant_id) ?? entry.name,
            })),
          );
        })
        .catch(() => undefined);
    });
    feed.on("participant:progress", (event) => {
      if (event.participant_id !== participantId) return;
      setMessage(
        event.solved
          ? `Resuelto: ${event.test_cases_passed}/${event.test_cases_total} casos.`
          : `Resultado: ${event.test_cases_passed}/${event.test_cases_total} casos.`,
      );
    });
    return () => feed.disconnect();
  }, [joinedRoundId, participantId, username]);

  const closed = live?.status === "closed" || live?.status === "closing";
  const paused = Boolean(live?.paused) && !closed;
  // Bloqueo real: deshabilita el textarea, no solo el botón. El texto se conserva.
  const locked = !live || live.status !== "active" || live.paused || remaining <= 0;
  const inscribed = Boolean(participant && round && participant.roundId === round.id);

  // CharacterCarousel ya guardó el personaje en localStorage antes de llamar acá.
  const confirmCharacter = (character: number) => {
    setCharacterConfirmed(username);
    setConfirmedState(true);
    // Sin ronda activa no hay dónde inscribirse: el efecto de carga lo hace con
    // este personaje cuando llegue round:started.
    const roundId = roundIdRef.current;
    if (!roundId) return;
    void joinRound(roundId, username, character)
      .then((joined) => {
        if (roundIdRef.current === roundId) setParticipant({ roundId, id: joined.id });
      })
      .catch((error) => {
        // El flag ya está escrito: pasa al panel igual, con el aviso y el reintento.
        setJoinError(error instanceof Error ? error.message : "No se pudo entrar a la ronda");
      });
  };

  const send = async () => {
    if (locked || !round || !participant || participant.roundId !== round.id) {
      setMessage("No puedes enviar ahora.");
      return;
    }
    if (!code.trim()) {
      setMessage("Escribe tu solución antes de enviar.");
      return;
    }
    setSending(true);
    setMessage("");
    try {
      const result = await submitRound(round.id, participant.id, code, language);
      setMessage(`Submission en cola: ${result.id || result.verdict || "ok"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  if (characterConfirmed === false) {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Tu corredor</p>
        <h1 className="mt-1 text-lg font-semibold text-foreground">Elige tu personaje</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Es tu caballo en la pista durante todo el torneo. Una vez confirmado no se puede cambiar.
        </p>
        <CharacterCarousel username={username} onSelect={confirmCharacter} />
      </section>
    );
  }

  if (characterConfirmed === null || load === "loading") {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-20 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        <p className="text-sm text-muted-foreground">Cargando la ronda…</p>
      </div>
    );
  }

  if (load === "none" || load === "error" || !round) {
    return (
      <section className="rounded-xl border border-border bg-card px-5 py-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">
          {load === "error"
            ? "No se pudo conectar con el servidor"
            : "Todavía no hay una ronda activa"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {load === "error"
            ? "Revisa tu conexión y vuelve a intentarlo."
            : "El organizador aún no abrió ninguna. La vista se actualiza sola cuando empiece."}
        </p>
        <button
          type="button"
          onClick={reload}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          {load === "error" ? "Reintentar" : "Recargar"}
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {round.number ? `Ronda ${round.number} · ` : ""}cupo {round.capacity}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">{round.problem}</h1>
        </div>
        <p className="font-mono text-4xl font-semibold tabular-nums text-foreground">
          {formatClock(remaining)}
        </p>
      </header>

      {joinError && (
        <section
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger bg-danger-soft px-5 py-3 text-sm text-danger"
        >
          <span>No quedaste inscripto en la ronda: {joinError}</span>
          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-danger px-3 py-1 text-xs font-medium"
          >
            Reintentar
          </button>
        </section>
      )}

      {paused && (
        <section
          role="status"
          className="rounded-xl border border-info bg-info-soft px-5 py-3 text-sm text-info"
        >
          <p className="font-semibold">Ronda pausada</p>
          <p className="mt-1">
            El editor se reactiva cuando el organizador la reanude. Tu código se conserva.
          </p>
        </section>
      )}

      {closed && (
        <section role="status" className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="font-semibold text-foreground">Ronda finalizada</p>
          {standings ? (
            <ol className="mt-3 space-y-1 text-sm">
              {standings.map((entry) => (
                <li
                  key={entry.participant_id}
                  className={`flex items-center justify-between rounded-lg px-3 py-1.5 ${
                    entry.participant_id === participantId ? "bg-info-soft font-medium" : ""
                  }`}
                >
                  <span className="font-mono">
                    {entry.rank}. {entry.name}
                  </span>
                  <span className={entry.advanced ? "text-success" : "text-danger"}>
                    {entry.advanced ? "Clasificado" : "Eliminado"}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              El ranking aparece cuando el servidor termine de calcularlo.
            </p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-card px-5 py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Estado de la evaluación
        </p>
        <p className="mt-2 text-sm text-foreground">
          Solo los casos de ejemplo son visibles; el resto de los casos de prueba es privado. El
          veredicto aparecerá después de que Judge0 procese tu envío.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Enunciado</h2>
            <ProblemStatement statement={round.statement} />
          </section>

          {round.samples.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Casos de ejemplo</h2>
              <div className="mt-3 space-y-3">
                {round.samples.map((sample, index) => (
                  <div key={index} className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium text-foreground">Ejemplo {index + 1}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Entrada</p>
                        <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
                          {sample.stdin}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Salida esperada</p>
                        <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
                          {sample.expected}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="overflow-hidden rounded-xl border border-border bg-editor">
          <div className="flex items-center justify-between border-b border-editor-border px-4 py-2.5">
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
              disabled={locked}
              className="rounded-md border border-editor-border bg-editor px-2 py-1 font-mono text-xs text-editor-foreground outline-none"
            >
              {(Object.keys(LANGUAGES) as Language[]).map((key) => (
                <option key={key} value={key}>
                  {LANGUAGES[key].label}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs text-editor-muted">{LANGUAGES[language].file}</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={PLACEHOLDERS[language]}
            spellCheck={false}
            disabled={locked}
            className="h-96 w-full resize-none bg-editor px-4 py-3 font-mono text-sm text-editor-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex justify-end gap-3 border-t border-editor-border px-4 py-3">
            <button
              type="button"
              onClick={() => setMessage("Prueba local pendiente de test cases del problema.")}
              disabled={locked}
              className="rounded-lg border border-editor-border px-4 py-2 text-sm font-medium text-editor-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              Probar
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || locked || !inscribed}
              className="rounded-lg bg-info px-4 py-2 text-sm font-medium text-info-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Enviar solución
            </button>
          </div>
          {message && (
            <p className="border-t border-editor-border px-4 py-2 text-xs text-editor-muted">
              {message}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export default ParticipantView;
