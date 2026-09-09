import { useMemo, useState } from "react";
import {
  formatClock,
  MOCK_PARTICIPANTS,
  MOCK_ROUND,
  MOCK_ROUNDS_PROGRESS,
  type Participant,
} from "@/lib/runit";
import { useRoundTimer } from "@/hooks/use-round-timer";
import { closeRound } from "@/lib/api";

const STATUS_LABEL: Record<Participant["status"], string> = {
  racing: "En curso",
  solved: "Resuelto",
  eliminated: "Eliminado",
  past: "Fuera (ronda previa)",
};

const STATUS_CLASS: Record<Participant["status"], string> = {
  racing: "bg-info-soft text-info",
  solved: "bg-success-soft text-success",
  eliminated: "bg-danger-soft text-danger",
  past: "bg-muted text-muted-foreground",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function AdminPanel({
  participants = MOCK_PARTICIPANTS,
  round = MOCK_ROUND,
}: {
  participants?: Participant[];
  round?: typeof MOCK_ROUND;
}) {
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("");
  const remaining = useRoundTimer(round.ends_at);

  const filtered = useMemo(
    () => participants.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [participants, query],
  );
  const solved = participants.filter((p) => p.solved).length;
  const active = participants.filter((p) => p.status === "racing").length;

  return (
    <div className="grid gap-5 lg:grid-cols-[7fr_3fr]">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Control de la ronda actual
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">{round.problem}</h2>
            </div>
            <p className="font-mono text-4xl font-semibold tabular-nums text-foreground">
              {formatClock(remaining)}
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Cupo" value={round.capacity} />
            <Stat label="Ya resolvieron" value={solved} />
            <Stat label="Activos" value={active} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => setPaused((v) => !v)}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {paused ? "Reanudar ronda" : "Pausar ronda"}
            </button>
            <button onClick={() => {
              if (!String(round.round_id).includes("-")) {
                setMessage("Configura una ronda real para poder cerrarla.");
                return;
              }
              void closeRound(String(round.round_id)).then(() => setMessage("Ronda cerrada")).catch((error) => setMessage(error.message));
            }} className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-danger-foreground transition-opacity hover:opacity-90">
              Forzar cierre
            </button>
            {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
            <h3 className="text-sm font-semibold text-foreground">Participantes en esta ronda</h3>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar participante…"
              className="w-56 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">Avance</th>
                <th className="px-5 py-3 font-medium">Intentos</th>
                <th className="px-5 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => {
                const pct = Math.round((p.test_cases_passed / p.test_cases_total) * 100);
                return (
                  <tr key={p.participant_id}>
                    <td className="px-5 py-3 font-mono text-foreground">{p.name}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full bg-silk-${p.silk}`}
                            style={{ width: `${pct}%`, transition: "width 0.55s ease" }}
                          />
                        </div>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-muted-foreground">{p.attempts}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[p.status]}`}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Configurar ronda</h3>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">
              <span className="text-muted-foreground">Problema</span>
              <select className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring">
                <option>Sliding Window Maximum</option>
                <option>Two Sum</option>
                <option>Word Ladder</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Dificultad</span>
              <select className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring">
                <option>Fácil</option>
                <option>Medio</option>
                <option>Difícil</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Cupo de clasificación</span>
              <input
                type="number"
                defaultValue={4}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Tiempo límite (min)</span>
              <input
                type="number"
                defaultValue={10}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
              />
            </label>
            <button className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              Guardar y aplicar a próxima ronda
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Progreso del torneo</h3>
          <ul className="mt-4 space-y-1">
            {MOCK_ROUNDS_PROGRESS.map((r) => (
              <li
                key={r.round}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  r.state === "active"
                    ? "bg-info-soft font-medium text-foreground"
                    : r.state === "upcoming"
                      ? "text-muted-foreground"
                      : "text-foreground"
                }`}
              >
                <span>Ronda {r.round}</span>
                <span className="font-mono tabular-nums">
                  {r.entered} → {r.advanced ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

export default AdminPanel;
