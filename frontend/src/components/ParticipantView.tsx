import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  createSocketFeed,
  formatClock,
  formatTime,
  mergeSubmissions,
  upsertSubmission,
  verdictLabel,
  verdictTone,
  type RoundStatus,
} from "@/lib/runit";
import { useRoundTimer, useServerClockOffset } from "@/hooks/use-round-timer";
import { CharacterCarousel } from "@/components/CharacterCarousel";
import { CodeEditor } from "@/components/CodeEditor";
import { WaitingScreen } from "@/components/WaitingScreen";
import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { confetti } from "@/lib/confetti";
import { play } from "@/lib/sfx";
import { ProblemStatement } from "@/components/ProblemStatement";
import { Ceremony } from "@/components/Ceremony";
import { Eliminated } from "@/components/Eliminated";
import { useCeremony } from "@/hooks/use-ceremony";
import {
  getActiveRound,
  getMySubmissions,
  getRoundLeaderboard,
  getUpcomingRound,
  getMyParticipation,
  joinRound,
  logout,
  runCode,
  submitRound,
  type MySubmission,
  type RunResult,
} from "@/lib/api";
import {
  clearSession,
  getCharacterConfirmed,
  getSelectedCharacter,
  getSession,
  setCharacterConfirmed,
  setSelectedCharacter,
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

// Código inicial de cada lenguaje, copiado tal cual de plantillas_lenguajes/*.md
// (test/judge-contract.test.js verifica que sigan idénticos). Es el valor del
// editor, no un placeholder: probar o enviar la plantilla sin cambios se rechaza
// en el cliente, para no gastar un envío ni sumar penalización por error.
const TEMPLATES: Record<Language, string> = {
  python: `import sys
input = sys.stdin.readline

def solve():
  # solucion
  # ejemplo de entrada rapida:
  # # n = int(input())
  pass


def main():
  t = 1
  # t = int(input())  # Descomentar si hay varios casos de prueba
  for _ in range(t):
    solve()


if __name__ == "__main__":
  main()`,
  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>


typedef long long ll;

void solve(void) {
    // Código de la solución aquí

}

int main(void) {
    int t = 1;
    // Descomentar si el problema tiene múltiples casos de prueba:
    // if (scanf("%d", &t) != 1) return 0;

    while (t--) {
        solve();
    }

    return 0;
}`,
  cpp: `#include <bits/stdc++.h>
using namespace std;
#define fast_io ios_base::sync_with_stdio(false); cin.tie(NULL); cout.tie(NULL);

void solve(){
    // Código de la solución aquí
}

int main() {
    fast_io;

    int t=1;
    //Descomentar si el problema tiene múltiples casos de prueba:
    //cin>>t;

    while(t--){
        solve();
    }
    
    return 0;
}`,
};

// La plantilla de cualquier lenguaje, sin tocar. Se compara sin espacios al
// borde: un salto de línea de más no cuenta como solución.
const isUntouchedTemplate = (text: string) =>
  Object.values(TEMPLATES).some((template) => template.trim() === text.trim());

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
// verdad para el bloqueo del editor. startsAt es el fin de la cuenta regresiva
// (timestamp del servidor); 0 si la ronda no tiene, como las anteriores a ella.
type LiveRound = { status: RoundStatus; paused: boolean; endsAt: number; startsAt: number };

const toMs = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

const VERDICT_TONE_CLASS = {
  pending: "text-info",
  success: "text-success",
  danger: "text-danger",
} as const;

type Standing = { participant_id: string; name: string; rank: number; advanced: boolean };

// Posiciones mientras la ronda está abierta, en el orden del servidor.
type LiveStanding = Awaited<ReturnType<typeof getRoundLeaderboard>>[number];

type Load = "loading" | "none" | "error" | "ready";

// Pestañas del panel de prueba, debajo del editor.
type RunTab = "samples" | "custom";

// Si ya eligió personaje, según el servidor: está inscripto en el torneo de la
// ronda, o la ronda no es la primera (el personaje quedó fijo en la primera y
// el join decide si juega). El aviso de este navegador solo cuenta si el
// servidor no responde: guardado por nombre de usuario, salteaba el carrusel en
// otro torneo o a otra persona con el mismo nombre.
async function characterChosen(roundId: string, username: string) {
  try {
    const me = await getMyParticipation(roundId);
    if (me.participant) {
      // El personaje que cuenta es el del servidor; el local se alinea.
      setSelectedCharacter(username, me.participant.character);
      setCharacterConfirmed(username);
      return true;
    }
    return me.has_previous;
  } catch {
    return getCharacterConfirmed(username);
  }
}

export function ParticipantView() {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [live, setLive] = useState<LiveRound | null>(null);
  // Guarda la ronda junto al id: así nunca se envía con el participante de otra.
  const [participant, setParticipant] = useState<{ roundId: string; id: string } | null>(null);
  const [joinError, setJoinError] = useState("");
  const [standings, setStandings] = useState<Standing[] | null>(null);
  // aviso animado del último veredicto propio ("+2 tests", "¡Resuelto!", fallo).
  const [moment, setMoment] = useState<{
    kind: "pass" | "fail" | "solved";
    text: string;
    key: number;
  } | null>(null);
  const bestPassedRef = useRef(0);
  const [code, setCode] = useState(TEMPLATES.python);
  const [language, setLanguage] = useState<Language>("python");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [runTab, setRunTab] = useState<RunTab>("samples");
  const [customInput, setCustomInput] = useState("");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState("");
  // Se acumula: cada envío es una fila y los eventos solo actualizan la suya.
  const [history, setHistory] = useState<MySubmission[]>([]);
  const [liveStandings, setLiveStandings] = useState<LiveStanding[]>([]);
  // null hasta leer localStorage en el cliente: el SSR no sabe si ya eligió, y
  // renderizar cualquiera de las dos pantallas antes provocaría un salto visible.
  const [characterConfirmed, setConfirmedState] = useState<boolean | null>(null);
  // ronda pendiente en la que espera (sala de espera), si no hay activa.
  const [upcoming, setUpcoming] = useState<Awaited<ReturnType<typeof getUpcomingRound>>>(null);
  const serverOffsetMs = useServerClockOffset(setMessage);
  const remaining = useRoundTimer(live?.endsAt ?? 0, serverOffsetMs);
  // Mismo reloj corregido que el cronómetro: todos cuentan hacia el mismo
  // instante del servidor aunque el reloj local esté corrido.
  const untilStart = useRoundTimer(live?.startsAt ?? 0, serverOffsetMs);
  const username = getSession()?.username || "demo";
  const roundIdRef = useRef<string | null>(null);
  roundIdRef.current = round?.id ?? null;

  const reload = () => setReloadKey((key) => key + 1);

  // Eligió en el carrusel durante esta visita: una recarga de la ronda no lo
  // vuelve a mostrar aunque la inscripción todavía no haya llegado al servidor.
  const choseNowRef = useRef(false);

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
        if (!cancelled) {
          setConfirmedState(true);
          setLoad("error");
        }
        return;
      }
      if (cancelled) return;
      if (!remote) {
        setRound(null);
        setLive(null);
        // sin ronda activa, la próxima pendiente es la sala de espera. Se
        // inscribe ya, así el admin lo ve conectado antes de iniciar.
        const next = await getUpcomingRound().catch(() => null);
        if (cancelled) return;
        // Sin ninguna ronda todavía no hay torneo donde elegir: espera.
        const chosen = next ? await characterChosen(next.id, username) : true;
        if (cancelled) return;
        setConfirmedState(chosen || choseNowRef.current);
        setUpcoming(next);
        setLoad("none");
        if (next && chosen) {
          void joinRound(next.id, username, getSelectedCharacter(username)).catch(() => undefined);
        }
        return;
      }
      setUpcoming(null);
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
        startsAt: toMs(remote.starts_at),
      });
      // Sin personaje elegido no se inscribe: lo hace confirmCharacter. Así el
      // admin nunca ve un inscripto con el personaje 0 que en realidad no eligió.
      const chosen = await characterChosen(remote.id, username);
      if (cancelled) return;
      setConfirmedState(chosen || choseNowRef.current);
      setLoad("ready");
      if (!chosen) return;
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
    let cancelled = false;
    setHistory([]);
    setLiveStandings([]);
    bestPassedRef.current = 0;
    setMoment(null);
    // Ids de la ronda en pantalla: participant:progress no trae la ronda y sale
    // a todos los sockets, así que se ignora el de participantes ajenos.
    let standingIds = new Set<string>();
    let standingsTimer: ReturnType<typeof setTimeout> | undefined;
    const loadStandings = () => {
      if (!joinedRoundId) return;
      void getRoundLeaderboard(joinedRoundId)
        .then((rows) => {
          if (cancelled) return;
          standingIds = new Set(rows.map((row) => row.participant_id));
          setLiveStandings(rows);
        })
        .catch(() => undefined);
    };
    // participant:progress llega dos veces por envío (sala y global): se agrupa.
    const refreshStandings = () => {
      clearTimeout(standingsTimer);
      standingsTimer = setTimeout(loadStandings, 300);
    };
    // Historial desde la base, en cada (re)conexión: lo enviado antes de
    // recargar y lo que se perdió con el socket caído vuelve a aparecer.
    const seedHistory = () => {
      if (!joinedRoundId) return;
      void getMySubmissions(joinedRoundId)
        .then((rows) => {
          if (!cancelled) setHistory((current) => mergeSubmissions(current, rows));
        })
        .catch((error) => {
          if (!cancelled) {
            setMessage(error instanceof Error ? error.message : "No se pudo cargar tu historial");
          }
        });
    };
    const feed = createSocketFeed(joinedRoundId);
    if (!feed) {
      seedHistory();
      return () => {
        cancelled = true;
      };
    }
    feed.on("feed:connected", () => {
      seedHistory();
      loadStandings();
      // round:started sale una sola vez: si el socket estaba caído en el corte
      // entre rondas (laptop cerrada, red caída), se perdió, y la reconexión solo
      // repide la ronda vieja. Se vuelve a preguntar cuál es la activa.
      void getActiveRound()
        .then((active) => {
          if (!cancelled && active && active.id !== roundIdRef.current) {
            setReloadKey((key) => key + 1);
          }
        })
        .catch(() => undefined);
    });
    feed.on("participant:joined", (event) => {
      if (event.round_id === joinedRoundId) refreshStandings();
    });
    feed.on("round:snapshot", (snapshot) => {
      if (!snapshot || snapshot.id !== joinedRoundId) return;
      setLive({
        status: snapshot.status,
        paused: Boolean(snapshot.paused),
        endsAt: snapshot.ends_at ? new Date(snapshot.ends_at).getTime() : 0,
        startsAt: toMs(snapshot.starts_at),
      });
    });
    feed.on("round:started", (event) => {
      if (event.round_id === roundIdRef.current) {
        setLive(
          (current) =>
            current && {
              ...current,
              status: "active",
              endsAt: new Date(event.ends_at).getTime(),
              startsAt: toMs(event.starts_at),
            },
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
      if (standingIds.has(event.participant_id)) refreshStandings();
      if (event.participant_id !== participantId) return;
      setMessage(
        event.solved
          ? `Resuelto: ${event.test_cases_passed}/${event.test_cases_total} casos.`
          : `Resultado: ${event.test_cases_passed}/${event.test_cases_total} casos.`,
      );
    });
    // La sala de la ronda recibe los veredictos de todos: solo cuenta el propio.
    // participantId es el que devolvió el join, resuelto por el backend desde el token.
    feed.on("submission:judged", (event) => {
      if (event.participant_id !== participantId || event.round_id !== joinedRoundId) return;
      // animación y sonido según el veredicto, como en el demo animado.
      const accepted = event.verdict === "accepted" || event.verdict === "Accepted";
      const gained = event.test_cases_passed - bestPassedRef.current;
      bestPassedRef.current = Math.max(bestPassedRef.current, event.test_cases_passed);
      if (accepted) {
        setMoment({ kind: "solved", text: "¡Resuelto! Todos los casos", key: Date.now() });
        play("win");
        confetti({ x: 0.7, y: 0.35 });
      } else if (gained > 0) {
        setMoment({
          kind: "pass",
          text: `+${gained} ${gained === 1 ? "test" : "tests"} · ${event.test_cases_passed}/${event.test_cases_total}`,
          key: Date.now(),
        });
        play("coin");
      } else {
        setMoment({
          kind: "fail",
          text: `${verdictLabel(event.verdict)} · +30 s`,
          key: Date.now(),
        });
        play("error");
      }
      setHistory((current) =>
        upsertSubmission(current, {
          id: event.id,
          participant_id: event.participant_id,
          language: event.language,
          verdict: event.verdict,
          test_cases_passed: event.test_cases_passed,
          test_cases_total: event.test_cases_total,
          submitted_at: event.submitted_at,
        }),
      );
    });
    return () => {
      cancelled = true;
      clearTimeout(standingsTimer);
      feed.disconnect();
    };
  }, [joinedRoundId, participantId, username]);

  const closed = live?.status === "closed" || live?.status === "closing";
  // solo el puesto propio al cerrar la ronda.
  const myStanding = standings?.find((entry) => entry.participant_id === participantId) ?? null;
  const celebratedRef = useRef("");
  useEffect(() => {
    if (!myStanding || !round || celebratedRef.current === round.id) return;
    celebratedRef.current = round.id;
    if (myStanding.advanced) {
      play("win");
      confetti();
    } else {
      play("over");
    }
  }, [myStanding, round]);
  // Al terminar el torneo, la ceremonia de premios reemplaza la sala de espera
  // y el resultado de la última ronda (se ve igual que en la pista).
  const ceremony = useCeremony();
  const paused = Boolean(live?.paused) && !closed;
  const countingDown = live?.status === "active" && untilStart > 0;
  // Bloqueo real: deja el editor en solo lectura, no solo el botón. El texto se conserva.
  const locked = !live || live.status !== "active" || live.paused || remaining <= 0 || countingDown;
  const inscribed = Boolean(participant && round && participant.roundId === round.id);
  // Ya resolvió todos los casos: clasificó y no envía más en esta ronda (el
  // backend también lo rechaza). Sale del historial o del ranking, así
  // sobrevive a recargar la página.
  const qualified =
    inscribed &&
    (history.some((entry) => entry.verdict === "accepted" || entry.verdict === "Accepted") ||
      Boolean(liveStandings.find((entry) => entry.participant_id === participantId)?.solved_at));

  // CharacterCarousel ya guardó el personaje en localStorage antes de llamar acá.
  const confirmCharacter = (character: number) => {
    choseNowRef.current = true;
    setCharacterConfirmed(username);
    setConfirmedState(true);
    // Sin ronda activa no hay dónde inscribirse: el efecto de carga lo hace con
    // este personaje cuando llegue round:started.
    const roundId = roundIdRef.current ?? upcoming?.id ?? null;
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

  // Con la plantilla intacta (o el editor vacío) se cambia a la del nuevo
  // lenguaje; si ya escribió algo, el código se conserva tal cual.
  const changeLanguage = (next: Language) => {
    setLanguage(next);
    setCode((current) =>
      isUntouchedTemplate(current) || !current.trim() ? TEMPLATES[next] : current,
    );
  };

  const send = async () => {
    if (qualified) {
      setMessage("Ya clasificaste: no hace falta enviar más en esta ronda.");
      return;
    }
    if (locked || !round || !participant || participant.roundId !== round.id) {
      setMessage("No puedes enviar ahora.");
      return;
    }
    if (!code.trim()) {
      setMessage("Escribe tu solución antes de enviar.");
      return;
    }
    if (isUntouchedTemplate(code)) {
      setMessage("Tu código todavía es la plantilla: escribe tu solución antes de enviar.");
      return;
    }
    setSending(true);
    setMessage("");
    try {
      const result = (await submitRound(round.id, participant.id, code, language)) as MySubmission;
      setHistory((current) =>
        upsertSubmission(current, {
          id: result.id,
          participant_id: result.participant_id,
          language: result.language,
          verdict: result.verdict,
          test_cases_passed: 0,
          test_cases_total: 0,
          submitted_at: result.submitted_at,
        }),
      );
      setMessage("Envío en cola. El veredicto aparece en tu historial.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  // Probar no es enviar: no queda en el historial ni suma penalización.
  const run = async (mode: RunTab = runTab) => {
    if (running || qualified) return;
    if (locked || !round || !participant || participant.roundId !== round.id) {
      setRunError("No puedes probar ahora.");
      return;
    }
    if (!code.trim()) {
      setRunError("Escribe tu solución antes de probarla.");
      return;
    }
    if (isUntouchedTemplate(code)) {
      setRunError("Tu código todavía es la plantilla: escribe tu solución antes de probarla.");
      return;
    }
    setRunTab(mode);
    setRunning(true);
    setRunError("");
    setRunResult(null);
    try {
      const result = await runCode(
        round.id,
        participant.id,
        code,
        language,
        mode === "custom" ? customInput : undefined,
      );
      setRunResult(result);
      play(result.mode === "custom" || result.passed === result.total ? "coin" : "error");
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "No se pudo probar el código");
    } finally {
      setRunning(false);
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

  if (load === "error") {
    return (
      <section className="rounded-xl border border-border bg-card px-5 py-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">
          No se pudo conectar con el servidor
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Revisa tu conexión y vuelve a intentarlo.
        </p>
        <button
          type="button"
          onClick={reload}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Reintentar
        </button>
      </section>
    );
  }

  const character = getSelectedCharacter(username);

  const eliminated = closed && myStanding?.advanced === false;
  if (ceremony && !eliminated && (load === "none" || !round || closed)) {
    return <Ceremony ceremony={ceremony} compact />;
  }

  // sala de espera (CRT) hasta que el organizador inicia la ronda.
  if (load === "none" || !round) {
    return (
      <WaitingScreen
        roundNumber={upcoming?.round_number ?? null}
        tournamentName={upcoming?.tournament_name}
        character={character}
        countdownMs={null}
        note={
          upcoming
            ? undefined
            : "Todavía no hay una ronda para vos. La pantalla se actualiza sola cuando haya una."
        }
      />
    );
  }

  // No clasificó: animación de eliminado y pantalla de despedida con salida al
  // login. Desde ahí puede seguir mirando la carrera (y la ceremonia) en /pista.
  if (eliminated && myStanding) {
    const mine = liveStandings.find((entry) => entry.participant_id === participantId);
    return (
      <Eliminated
        name={myStanding.name || username}
        character={character}
        roundNumber={round.number ?? 0}
        rank={myStanding.rank}
        total={standings?.length ?? liveStandings.length}
        capacity={round.capacity}
        bestPct={Math.round(Number(mine?.best_pass_percentage ?? 0))}
        fails={mine?.failed_attempts_count ?? 0}
        onExit={() => {
          void logout()
            .catch(() => undefined)
            .finally(() => {
              clearSession();
              void navigate({ to: "/login" });
            });
        }}
        onSpectate={() => void navigate({ to: "/pista" })}
      />
    );
  }

  // al iniciar la ronda, "RUN IT" deja lugar a la cuenta regresiva.
  if (countingDown) {
    return (
      <WaitingScreen roundNumber={round.number} character={character} countdownMs={untilStart} />
    );
  }

  // Posición en la tabla, con el orden del servidor.
  const myIndex = liveStandings.findIndex((entry) => entry.participant_id === participantId);
  const sampleResults = runResult?.mode === "samples" ? runResult : null;
  const customResult = runResult?.mode === "custom" ? runResult.results[0] : undefined;

  return (
    <div className="space-y-5">
      {/* Barra: nombre del problema · posición en tabla · reloj. */}
      <header className="grid grid-cols-1 items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-8">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {round.number ? `Ronda ${round.number} · ` : ""}cupo {round.capacity}
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">{round.problem}</h1>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <PixelIcon name="trophy" className="h-4 w-4 text-primary" />
          Posición en tabla:{" "}
          <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
            {myIndex >= 0 ? `#${myIndex + 1}` : "—"}
          </span>
          {liveStandings.length > 0 && (
            <span className="font-mono tabular-nums"> / {liveStandings.length}</span>
          )}
        </p>
        <p
          className={`flex items-center gap-2 font-mono text-4xl font-semibold tabular-nums ${
            !closed && remaining <= 10_000
              ? "animate-run-it-hurry text-danger"
              : !closed && remaining <= 60_000
                ? "text-danger"
                : "text-foreground"
          }`}
        >
          <PixelIcon name="clock" className="h-7 w-7" />
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

      {/* al cerrar la ronda el participante ve solo su puesto, no todo el ranking. */}
      {closed && (
        <section
          role="status"
          className={`relative overflow-hidden rounded-xl border px-5 py-6 ${
            myStanding && !myStanding.advanced
              ? "animate-run-it-shake border-danger bg-danger-soft"
              : "border-primary bg-card"
          }`}
        >
          {myStanding && !myStanding.advanced && (
            <div
              aria-hidden="true"
              className="animate-run-it-flash pointer-events-none absolute inset-0 bg-danger"
            />
          )}
          <div className="relative flex flex-wrap items-center gap-6">
            <Sprite
              index={character}
              state={myStanding?.advanced === false ? "out" : "run"}
              scale={0.75}
            />
            <div className="min-w-0 flex-1">
              {!myStanding ? (
                <>
                  <p className="font-semibold text-foreground">Ronda finalizada</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tu puesto aparece cuando el servidor termine de calcularlo.
                  </p>
                </>
              ) : myStanding.advanced ? (
                <>
                  <p className="animate-run-it-zoom flex items-center gap-2 text-3xl font-bold text-primary">
                    <PixelIcon name="trophy" className="h-8 w-8" /> ¡Clasificaste!
                  </p>
                  <p className="mt-1 text-lg text-foreground">
                    Quedaste en el puesto <b className="font-mono">#{myStanding.rank}</b> de{" "}
                    {standings?.length ?? "—"}.
                  </p>
                </>
              ) : (
                <>
                  <p className="animate-run-it-zoom flex items-center gap-2 text-3xl font-bold text-danger">
                    <PixelIcon name="skull" className="h-8 w-8" /> Game Over
                  </p>
                  <p className="mt-1 text-lg text-foreground">
                    Quedaste en el puesto <b className="font-mono">#{myStanding.rank}</b> de{" "}
                    {standings?.length ?? "—"}. ¡Gracias por correr!
                  </p>
                </>
              )}
            </div>
            {myStanding?.advanced && (
              <button
                type="button"
                onClick={reload}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Ir a la sala de espera de la ronda siguiente
              </button>
            )}
          </div>
        </section>
      )}

      {/* Distribución: enunciado | IDE arriba, casos de prueba | envíos abajo. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="flex max-h-[34rem] flex-col rounded-xl border border-border bg-card p-5 lg:order-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Enunciado
          </h2>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            <ProblemStatement statement={round.statement} />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-editor lg:order-2">
          <div className="flex items-end justify-between gap-3 border-b border-editor-border pl-2 pr-4 pt-2">
            {/* Pestaña del archivo, como en un IDE. */}
            <div
              role="tablist"
              aria-label="Archivo"
              className="flex items-center gap-2 rounded-t-md border border-b-0 border-editor-border bg-editor px-3 py-1.5"
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
              <span
                role="tab"
                aria-selected="true"
                className="font-mono text-xs text-editor-foreground"
              >
                {LANGUAGES[language].file}
              </span>
            </div>
            <select
              value={language}
              onChange={(event) => changeLanguage(event.target.value as Language)}
              disabled={locked || qualified}
              aria-label="Lenguaje"
              className="mb-1.5 rounded-md border border-editor-border bg-editor px-2 py-1 font-mono text-xs text-editor-foreground outline-none"
            >
              {(Object.keys(LANGUAGES) as Language[]).map((key) => (
                <option key={key} value={key}>
                  {LANGUAGES[key].label}
                </option>
              ))}
            </select>
          </div>
          {qualified && (
            <div
              role="status"
              className="run-it-qualified flex items-center gap-4 border-b border-editor-border px-4 py-3"
            >
              <Sprite index={character} state="run" scale={0.6} />
              <div className="min-w-0">
                <p className="animate-run-it-zoom flex items-center gap-2 text-lg font-bold text-success">
                  <PixelIcon name="trophy" className="h-5 w-5" /> ¡Ya clasificaste!
                </p>
                <p className="mt-0.5 text-sm text-editor-foreground">
                  Completaste todos los casos y tu lugar está asegurado. No hace falta enviar más en
                  esta ronda: espera el cierre.
                </p>
              </div>
            </div>
          )}
          <CodeEditor
            value={code}
            onChange={(value) => setCode(value)}
            language={language}
            readOnly={locked || qualified}
            onRunShortcut={() => void run()}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-editor-border px-4 py-3">
            <p className="text-xs text-editor-muted">
              Probar no cuenta como envío · Ctrl/Cmd + Enter
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void run()}
                disabled={running || locked || !inscribed || qualified}
                className="rounded-lg border border-editor-border px-4 py-2 text-sm font-medium text-editor-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <PixelIcon name="play" className="h-4 w-4" />
                  {running ? "Probando…" : "Probar"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || locked || !inscribed || qualified}
                className="rounded-lg bg-info px-4 py-2 text-sm font-medium text-info-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <PixelIcon name="zap" className="h-4 w-4" /> Enviar solución
                </span>
              </button>
            </div>
          </div>
          {message && (
            <p className="border-t border-editor-border px-4 py-2 text-xs text-editor-muted">
              {message}
            </p>
          )}
        </section>

        {/* Casos de prueba: los ejemplos, con el resultado de "Probar" al lado. */}
        <section className="rounded-xl border border-border bg-card p-5 lg:order-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PixelIcon name="check" className="h-4 w-4 text-primary" /> Casos de prueba
            </h2>
            <div
              role="tablist"
              aria-label="Casos de prueba"
              className="flex gap-1 rounded-lg bg-muted p-1"
            >
              {(
                [
                  ["samples", `Ejemplos (${round.samples.length})`],
                  ["custom", "Entrada propia"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={runTab === key}
                  onClick={() => setRunTab(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    runTab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1 text-xs">
            {running && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <span className="run-it-spinner" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                Ejecutando en el juez…
              </p>
            )}
            {runError && <p className="text-danger">{runError}</p>}
            {runTab === "samples" && (
              <>
                {sampleResults && (
                  <p
                    className={`font-semibold ${
                      sampleResults.passed === sampleResults.total ? "text-success" : "text-danger"
                    }`}
                  >
                    {sampleResults.passed}/{sampleResults.total} ejemplos correctos
                  </p>
                )}
                {round.samples.length === 0 && (
                  <p className="text-muted-foreground">
                    Este problema no tiene casos de ejemplo. Usa una entrada propia.
                  </p>
                )}
                {round.samples.map((sample, index) => {
                  const result = sampleResults?.results[index];
                  return (
                    <div key={index} className="rounded-lg border border-border p-3">
                      <p className="flex items-center justify-between gap-2 font-medium text-foreground">
                        Ejemplo {index + 1}
                        {result && (
                          <span className={result.passed ? "text-success" : "text-danger"}>
                            {result.passed ? "Correcto" : verdictLabel(result.status)}
                            {result.time ? ` · ${result.time} s` : ""}
                          </span>
                        )}
                      </p>
                      <div
                        className={`mt-2 grid gap-2 ${result ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
                      >
                        <div>
                          <p className="text-muted-foreground">Entrada</p>
                          <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-foreground">
                            {sample.stdin}
                          </pre>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Salida esperada</p>
                          <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-foreground">
                            {sample.expected}
                          </pre>
                        </div>
                        {result && (
                          <div>
                            <p className="text-muted-foreground">Tu salida</p>
                            <pre
                              className={`mt-1 overflow-x-auto rounded-md px-3 py-2 font-mono ${
                                result.passed
                                  ? "bg-success-soft text-success"
                                  : "bg-danger-soft text-danger"
                              }`}
                            >
                              {result.stdout || "(vacía)"}
                            </pre>
                          </div>
                        )}
                      </div>
                      {(result?.compile_output || result?.stderr) && (
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-danger-soft px-3 py-2 font-mono text-danger">
                          {result.compile_output || result.stderr}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {runTab === "custom" && (
              <>
                <label className="block">
                  <span className="text-muted-foreground">Entrada (stdin)</span>
                  <textarea
                    value={customInput}
                    onChange={(event) => setCustomInput(event.target.value)}
                    spellCheck={false}
                    rows={4}
                    placeholder="Escribe aquí la entrada que leerá tu programa"
                    className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring"
                  />
                </label>
                {customResult && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="flex justify-between font-medium text-foreground">
                      Tu salida
                      <span className="text-muted-foreground">
                        {verdictLabel(customResult.status)}
                        {customResult.time ? ` · ${customResult.time} s` : ""}
                      </span>
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-foreground">
                      {customResult.stdout || "(vacía)"}
                    </pre>
                    {(customResult.compile_output || customResult.stderr) && (
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-danger-soft px-3 py-2 font-mono text-danger">
                        {customResult.compile_output || customResult.stderr}
                      </pre>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void run("custom")}
                  disabled={running || locked || !inscribed || qualified}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  Probar con esta entrada
                </button>
              </>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 lg:order-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="zap" className="h-4 w-4 text-primary" /> Tus envíos
          </h2>
          {moment && (
            <p
              key={moment.key}
              className={`animate-run-it-rise mt-2 flex items-center gap-2 text-sm font-bold ${
                moment.kind === "fail" ? "text-danger" : "text-success"
              }`}
            >
              <PixelIcon
                name={
                  moment.kind === "fail" ? "close" : moment.kind === "solved" ? "trophy" : "check"
                }
                className="h-4 w-4"
              />
              {moment.text}
            </p>
          )}
          {history.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Todavía no enviaste nada. Cada envío fallido suma 30 s de penalización.
            </p>
          ) : (
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Hora</th>
                    <th className="pb-2 font-medium">Lenguaje</th>
                    <th className="pb-2 font-medium">Estado</th>
                    <th className="pb-2 text-right font-medium">Casos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 font-mono tabular-nums text-muted-foreground">
                        {formatTime(row.submitted_at)}
                      </td>
                      <td className="py-2">
                        {LANGUAGES[row.language as Language]?.label ?? row.language}
                      </td>
                      <td
                        className={`py-2 font-medium ${VERDICT_TONE_CLASS[verdictTone(row.verdict)]}`}
                      >
                        {verdictLabel(row.verdict)}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {row.test_cases_total
                          ? `${row.test_cases_passed}/${row.test_cases_total}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default ParticipantView;
