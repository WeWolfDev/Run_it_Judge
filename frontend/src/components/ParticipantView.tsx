import { useEffect, useState } from "react";
import { formatClock, MOCK_ROUND } from "@/lib/runit";
import { useRoundTimer } from "@/hooks/use-round-timer";
import { getActiveRound, joinRound, submitRound } from "@/lib/api";
import { getSession } from "@/lib/session";

type TestState = "pass" | "fail" | "pending";

const TESTS: TestState[] = ["pass", "pass", "pass", "fail", "pass", "pending", "pending", "pending", "pending", "pending"];

const STARTER = `def max_sliding_window(nums, k):
    # tu solución aquí
    return []
`;

export function ParticipantView({ round = MOCK_ROUND }: { round?: typeof MOCK_ROUND }) {
  const [activeRound, setActiveRound] = useState(round);
  const [participantId, setParticipantId] = useState("");
  const displayedRound = activeRound;
  const remaining = useRoundTimer(displayedRound.ends_at);
  const [code, setCode] = useState(STARTER);
  const [language, setLanguage] = useState("python");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const passed = TESTS.filter((t) => t === "pass").length;
  const pct = Math.round((passed / TESTS.length) * 100);

  const send = async () => {
    setSending(true);
    setMessage("");
    try {
      const result = participantId
        ? await submitRound(String(displayedRound.round_id), participantId, code, language)
        : await joinRound(String(displayedRound.round_id), getSession()?.username || "demo").then(async (participant) => {
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
    void getActiveRound().then((remote) => {
      if (!remote) return;
      setActiveRound({
        round_id: remote.id,
        ends_at: new Date(remote.ends_at).getTime(),
        problem: remote.problem_name,
        capacity: remote.capacity,
      });
    }).catch(() => undefined);
  });

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

      <section className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="relative h-10">
          <div
            className="absolute -top-1 z-10 flex flex-col items-center"
            style={{ left: `calc(${pct}% - 1rem)`, transition: "left 0.55s cubic-bezier(0.22,1,0.36,1)" }}
          >
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
              tú
            </span>
            <svg viewBox="0 0 64 64" className="h-7 w-7 animate-gallop text-silk-4" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 46c0-9 5-14 12-17l4-9c1-3 4-6 8-7l6-2 3 5-4 3 2 4c4 2 6 6 6 11l4 3-3 4-4-2c-1 4-4 7-8 9l1 8h-5l-1-7-8 1-2 6h-5l1-7-4-1-3 4-3-2z"
              />
            </svg>
          </div>
          <div className="absolute bottom-0 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${pct}%`, transition: "width 0.55s ease" }}
            />
          </div>
        </div>
        <p className="mt-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {passed}/{TESTS.length} test cases · {pct}%
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Enunciado</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Dado un arreglo de enteros <code className="font-mono">nums</code> y una ventana de tamaño{" "}
              <code className="font-mono">k</code>, devuelve el valor máximo de cada ventana deslizante
              conforme avanza de izquierda a derecha.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Entrada</p>
                <pre className="mt-1 rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
nums = [1,3,-1,-3,5,3,6,7], k = 3</pre>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Salida</p>
                <pre className="mt-1 rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
[3,3,5,5,6,7]</pre>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Resultados de tus tests</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {TESTS.map((t, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 font-mono text-xs ${
                    t === "pass"
                      ? "bg-success-soft text-success"
                      : t === "fail"
                        ? "bg-danger-soft text-danger"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t === "pass" ? "✓" : t === "fail" ? "✕" : "•"} test {i + 1}
                </span>
              ))}
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-xl border border-border bg-editor">
          <div className="flex items-center justify-between border-b border-editor-border px-4 py-2.5">
            <select value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded-md border border-editor-border bg-editor px-2 py-1 font-mono text-xs text-editor-foreground outline-none">
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
            <button type="button" onClick={() => setMessage("Prueba local pendiente de test cases del problema.")} className="rounded-lg border border-editor-border px-4 py-2 text-sm font-medium text-editor-foreground transition-colors hover:bg-white/5">
              Probar
            </button>
            <button type="button" onClick={() => void send()} disabled={sending} className="rounded-lg bg-info px-4 py-2 text-sm font-medium text-info-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              Enviar solución
            </button>
          </div>
          {message && <p className="border-t border-editor-border px-4 py-2 text-xs text-editor-muted">{message}</p>}
        </section>
      </div>
    </div>
  );
}

export default ParticipantView;
