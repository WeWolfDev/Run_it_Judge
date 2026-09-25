import { useEffect, useState } from "react";
import { formatClock, MOCK_ROUND } from "@/lib/runit";
import { useRoundTimer } from "@/hooks/use-round-timer";
import { getActiveRound, joinRound, submitRound } from "@/lib/api";
import {
  getSelectedCharacter,
  getSession,
  setSelectedCharacter as saveSelectedCharacter,
} from "@/lib/session";

const STARTER = `def max_sliding_window(nums, k):
    # tu solución aquí
    return []
`;

const CHARACTERS = [
  { name: "Aurora", title: "La veloz", silk: 0 },
  { name: "Nilo", title: "El estratega", silk: 1 },
  { name: "Mango", title: "El constante", silk: 2 },
  { name: "Sol", title: "La precisa", silk: 3 },
  { name: "Pixel", title: "El veloz", silk: 4 },
  { name: "Nova", title: "La resistente", silk: 5 },
] as const;

function HorseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 46c0-9 5-14 12-17l4-9c1-3 4-6 8-7l6-2 3 5-4 3 2 4c4 2 6 6 6 11l4 3-3 4-4-2c-1 4-4 7-8 9l1 8h-5l-1-7-8 1-2 6h-5l1-7-4-1-3 4-3-2z"
      />
    </svg>
  );
}

export function ParticipantView({ round = MOCK_ROUND }: { round?: typeof MOCK_ROUND }) {
  const [activeRound, setActiveRound] = useState(round);
  const [statement, setStatement] = useState(
    "Dado un problema, resuelve la solución y envíala para evaluación.",
  );
  const [participantId, setParticipantId] = useState("");
  const displayedRound = activeRound;
  const remaining = useRoundTimer(displayedRound.ends_at);
  const [code, setCode] = useState(STARTER);
  const [language, setLanguage] = useState("python");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const username = getSession()?.username || "demo";
  const [selectedCharacter, setSelectedCharacterState] = useState(() =>
    getSelectedCharacter(username),
  );

  const send = async () => {
    setSending(true);
    setMessage("");
    try {
      const result = participantId
        ? await submitRound(String(displayedRound.round_id), participantId, code, language)
        : await joinRound(String(displayedRound.round_id), username).then(async (participant) => {
            setParticipantId(participant.id);
            return submitRound(String(displayedRound.round_id), participant.id, code, language);
          });
      setMessage(`Submission en cola: ${result.id || result.verdict || "ok"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    void getActiveRound()
      .then((remote) => {
        if (!remote) return;
        setStatement(remote.statement);
        setActiveRound({
          round_id: remote.id,
          ends_at: new Date(remote.ends_at).getTime(),
          problem: remote.problem_name,
          capacity: remote.capacity,
        });
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Ronda {displayedRound.round_id} · cupo {displayedRound.capacity}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">{displayedRound.problem}</h1>
        </div>
        <p className="font-mono text-4xl font-semibold tabular-nums text-foreground">
          {formatClock(remaining)}
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Tu corredor</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Elige tu personaje</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {CHARACTERS[selectedCharacter]?.name ?? "Personaje"} seleccionado
          </p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {CHARACTERS.map((character, index) => {
            const selected = selectedCharacter === index;
            return (
              <button
                key={character.name}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  saveSelectedCharacter(username, index);
                  setSelectedCharacterState(index);
                }}
                className={`group rounded-lg border p-3 text-center transition-colors ${
                  selected
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border bg-muted hover:border-primary/50"
                }`}
              >
                <HorseIcon
                  className={`mx-auto h-10 w-10 text-silk-${character.silk} transition-transform group-hover:-translate-y-1`}
                />
                <span className="mt-2 block text-xs font-semibold text-foreground">
                  {character.name}
                </span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {character.title}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card px-5 py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Estado de la evaluación
        </p>
        <p className="mt-2 text-sm text-foreground">
          Los casos de prueba son privados. El veredicto aparecerá después de que Judge0 procese tu
          envío.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Enunciado</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {statement}
            </p>
          </section>
        </div>

        <section className="overflow-hidden rounded-xl border border-border bg-editor">
          <div className="flex items-center justify-between border-b border-editor-border px-4 py-2.5">
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="rounded-md border border-editor-border bg-editor px-2 py-1 font-mono text-xs text-editor-foreground outline-none"
            >
              <option value="python">Python 3</option>
              <option value="javascript">JavaScript</option>
            </select>
            <span className="font-mono text-xs text-editor-muted">solution.py</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="h-96 w-full resize-none bg-editor px-4 py-3 font-mono text-sm text-editor-foreground outline-none"
          />
          <div className="flex justify-end gap-3 border-t border-editor-border px-4 py-3">
            <button
              type="button"
              onClick={() => setMessage("Prueba local pendiente de test cases del problema.")}
              className="rounded-lg border border-editor-border px-4 py-2 text-sm font-medium text-editor-foreground transition-colors hover:bg-white/5"
            >
              Probar
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending}
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
