import { useEffect, useState } from "react";
import { formatClock, MOCK_ROUND } from "@/lib/runit";
import { useRoundTimer, useServerClockOffset } from "@/hooks/use-round-timer";
import { CharacterCarousel } from "@/components/CharacterCarousel";
import { ProblemStatement } from "@/components/ProblemStatement";
import { getActiveRound, joinRound, submitRound } from "@/lib/api";
import { getSession } from "@/lib/session";

// Las claves coinciden con LANGUAGE_IDS de judge0-client.js. "cpp", no "c++".
const LANGUAGES = {
  python: { label: "Python 3", file: "solution.py" },
  javascript: { label: "JavaScript", file: "solution.js" },
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
  javascript: `const fs = require('fs');
function main() {
    // Lee desde la entrada estándar (stdin)
    const input = fs.readFileSync(0, 'utf-8').trim().split(/\\s+/);
    if (input.length === 0 || input[0] === '') return;
    // --- ESCRIBE TU LÓGICA AQUÍ ---
}
main();`,
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

export function ParticipantView({ round = MOCK_ROUND }: { round?: typeof MOCK_ROUND }) {
  const [activeRound, setActiveRound] = useState(round);
  const [statement, setStatement] = useState(
    "Dado un problema, resuelve la solución y envíala para evaluación.",
  );
  const [samples, setSamples] = useState<SampleCase[]>([]);
  const [participantId, setParticipantId] = useState("");
  const displayedRound = activeRound;
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState<Language>("python");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const serverOffsetMs = useServerClockOffset(setMessage);
  const remaining = useRoundTimer(displayedRound.ends_at, serverOffsetMs);
  const username = getSession()?.username || "demo";

  const send = async () => {
    if (!code.trim()) {
      setMessage("Escribe tu solución antes de enviar.");
      return;
    }
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
        // `samples` es aditivo en /public/rounds/active; el tipo de api.ts no lo declara.
        const remoteSamples = (remote as { samples?: SampleCase[] }).samples;
        setSamples(Array.isArray(remoteSamples) ? remoteSamples : []);
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
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Tu corredor</p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Elige tu personaje</h2>
        <CharacterCarousel username={username} />
      </section>

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
            <ProblemStatement statement={statement} />
          </section>

          {samples.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Casos de ejemplo</h2>
              <div className="mt-3 space-y-3">
                {samples.map((sample, index) => (
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
