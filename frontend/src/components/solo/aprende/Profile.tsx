import { useEffect, useState, type ReactNode } from "react";

import { CharacterCarousel } from "@/components/CharacterCarousel";
import { PixelIcon } from "@/components/PixelIcon";
import { NicknameFields, SignInOptions } from "@/components/solo/account/SoloAccount";
import { PLAYER, type Account } from "@/components/solo/account/useAccount";
import { Sprite } from "@/components/Sprite";
import { characterAt } from "@/lib/characters";
import { getSelectedCharacter } from "@/lib/session";
import { supabase } from "@/lib/solo-supabase";

import { ALL_EXERCISES, levelOf, WORLDS } from "./content";
import { Activity } from "./Activity";
import { nextTier, tierOf } from "./rank";
import { topicState, type Progress } from "./useProgress";
import { XpChart } from "./XpChart";

// Perfil del jugador: personaje (se elige de la lista de siempre y, con cuenta,
// se guarda en ella), datos de la cuenta, avance por tema y acciones de la
// cuenta. Sin cuenta muestra el avance de este navegador y cómo entrar.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const PROVIDER: Record<string, string> = { github: "GitHub", google: "Google" };

export function Profile({
  account,
  progress,
  onRanking,
}: {
  account: Account;
  progress: Progress;
  onRanking: () => void;
}) {
  const { state } = account;
  const [character, setCharacter] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [place, setPlace] = useState<{ posicion: number; en_ranking: boolean } | null>(null);
  const ready = state.status === "ready" ? state : null;

  useEffect(() => setCharacter(getSelectedCharacter(PLAYER)), [state.status]);
  const userId = ready?.userId ?? null;
  useEffect(() => {
    if (!userId) return;
    void supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.app_metadata["provider"];
      setProvider(typeof id === "string" ? (PROVIDER[id] ?? id) : null);
    });
    void supabase.rpc("mi_ranking").then(({ data }) => {
      const row = ((data as { posicion: number; en_ranking: boolean }[] | null) ?? [])[0];
      setPlace(row ?? null);
    });
  }, [userId]);

  const topics = WORLDS[0]!.topics;
  const solvedCount = ALL_EXERCISES.filter((e) => e.id in progress.solved).length;
  const doneTopics = topics.filter(
    (_, i) => topicState(topics, i, progress.solved) === "done",
  ).length;
  const level = levelOf(progress.points);
  const tier = tierOf(progress.points);
  const next = nextTier(progress.points);

  return (
    <div className="grid gap-4">
      {ready?.bloqueado && (
        <p className="rounded-xl border border-danger bg-danger-soft px-4 py-3 text-sm leading-relaxed text-danger">
          Tu cuenta está suspendida por no cumplir los{" "}
          <a href="#terminos" className="underline">
            términos
          </a>{" "}
          (por ejemplo, un apodo ofensivo). No apareces en el ranking y tu avance ya no se guarda en
          la cuenta. Si crees que es un error, escribe a wolfdev.contacto@gmail.com.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Tarjeta del jugador: personaje, apodo, datos de la cuenta y acciones. */}
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
          <div
            className="grid h-40 place-items-end justify-center overflow-hidden rounded-lg border-2 bg-[#0b0613] pb-2"
            style={{ borderColor: tier.color, boxShadow: `0 0 18px ${tier.color}40` }}
          >
            {character !== null && <Sprite index={character} state="idle" scale={1} />}
          </div>
          <button
            type="button"
            onClick={() => setChoosing((open) => !open)}
            className="-mt-2 rounded-lg border border-border px-2 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            {choosing ? "Cerrar la lista de personajes" : "Cambiar personaje"}
          </button>

          <div className="min-w-0 text-center">
            <span
              className="inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              style={{ color: tier.color, borderColor: `${tier.color}80` }}
            >
              {tier.name}
            </span>
            <h1
              className="mt-2 break-all text-lg leading-snug"
              style={{ ...PIXEL, color: tier.color }}
            >
              {ready ? ready.apodo : "Sin cuenta"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {character !== null ? `${characterAt(character).name} · ` : ""}Nivel {level}
            </p>
            {ready && !ready.bloqueado && !renaming && (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="mt-1 text-xs text-primary hover:underline"
              >
                Cambiar apodo
              </button>
            )}
          </div>

          {ready && renaming && (
            <div className="rounded-lg border border-border p-3">
              <NicknameFields
                initial={ready.apodo}
                submitLabel="Guardar"
                cancelLabel="Cancelar"
                onSave={async (apodo) => {
                  const error = await account.renameNickname(apodo);
                  if (!error) setRenaming(false);
                  return error;
                }}
                onSignOut={() => setRenaming(false)}
              />
            </div>
          )}

          {ready && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border pt-3 text-sm">
              <Row icon="users" label="Entras con">
                {provider ?? "—"}
              </Row>
              <Row icon="clock" label="Desde">
                {ready.desde
                  ? new Date(ready.desde).toLocaleDateString("es-MX", { dateStyle: "medium" })
                  : "—"}
              </Row>
              <Row icon="flag" label="Estado">
                {ready.bloqueado ? (
                  <span className="text-danger">Suspendida</span>
                ) : (
                  <span className="text-success">Activa</span>
                )}
              </Row>
            </dl>
          )}

          {!ready && state.status !== "loading" && (
            <div className="grid gap-3 border-t border-border pt-3">
              <p className="text-sm text-muted-foreground">
                Tu avance vive solo en este navegador. Entra para guardarlo, elegir un apodo y
                aparecer en el ranking.
              </p>
              {signingIn || (state.status === "signedOut" && state.notice) ? (
                <SignInOptions
                  notice={state.status === "signedOut" ? state.notice : undefined}
                  onSignIn={(p) => void account.signIn(p)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setSigningIn(true)}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Entrar con mi cuenta
                </button>
              )}
            </div>
          )}

          {ready && <AccountActions account={account} />}
        </section>

        <div className="grid min-w-0 content-start gap-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat icon="zap" label="XP">
              <p className="font-mono text-2xl font-semibold" style={{ color: tier.color }}>
                {progress.points}
              </p>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${next ? ((progress.points - tier.min) / (next.min - tier.min)) * 100 : 100}%`,
                    background: next?.color ?? tier.color,
                  }}
                />
              </span>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {next ? (
                  <>
                    {next.min - progress.points} para{" "}
                    <span style={{ color: next.color }}>{next.name}</span>
                  </>
                ) : (
                  "Rango máximo"
                )}
              </p>
            </Stat>
            <Stat icon="star" label="Nivel">
              <p className="font-mono text-2xl font-semibold text-foreground">{level}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {100 - (progress.points % 100)} XP para el {level + 1}
              </p>
            </Stat>
            <Stat icon="check" label="Resueltos">
              <p className="font-mono text-2xl font-semibold text-foreground">
                {solvedCount}
                <span className="text-sm text-muted-foreground">/{ALL_EXERCISES.length}</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {doneTopics} de {topics.length} temas completos
              </p>
            </Stat>
            <Stat icon="trophy" label="Ranking global">
              <p className="font-mono text-2xl font-semibold text-foreground">
                {place?.en_ranking ? `#${place.posicion}` : "—"}
              </p>
              <button
                type="button"
                onClick={onRanking}
                className="mt-1 text-[11px] text-primary hover:underline"
              >
                {!ready ? "Ver ranking" : place?.en_ranking ? "Ver ranking" : "Participar"}
              </button>
            </Stat>
          </div>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-sm font-semibold text-foreground">Historial de XP</h2>
              <p className="text-xs text-muted-foreground">
                Cada cuadro es un ejercicio resuelto; pasa el mouse para verlo.
              </p>
            </div>
            <XpChart solved={progress.solved} character={character} />
          </section>
        </div>
      </div>

      {choosing && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Elige tu personaje</h2>
          <CharacterCarousel
            username={PLAYER}
            onSelect={(index) => {
              setCharacter(index);
              setChoosing(false);
              void account.saveCharacter(index);
            }}
          />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Actividad</h2>
          <Activity solved={progress.solved} />
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Mundo 1 · {WORLDS[0]!.title}
          </h2>
          <ul className="grid gap-2.5">
            {topics.map((topic, i) => {
              const solved = topic.exercises.filter((e) => e.id in progress.solved).length;
              const stateOf = topicState(topics, i, progress.solved);
              return (
                <li
                  key={topic.id}
                  className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
                >
                  <span
                    className={`truncate ${stateOf === "locked" ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {i + 1}. {topic.title}
                  </span>
                  <span className="flex gap-1">
                    {topic.exercises.map((e) => (
                      <span
                        key={e.id}
                        className={`h-2.5 flex-1 rounded-sm ${e.id in progress.solved ? "bg-[#2dd4bf]" : "bg-muted"}`}
                      />
                    ))}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {solved}/{topic.exercises.length}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  children,
}: {
  icon: "zap" | "star" | "check" | "trophy";
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-3">
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <PixelIcon name={icon} className="h-3.5 w-3.5 text-primary" /> {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: "users" | "clock" | "flag";
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <PixelIcon name={icon} className="h-3.5 w-3.5 text-primary" /> {label}
      </dt>
      <dd className="truncate text-right text-foreground">{children}</dd>
    </>
  );
}

function AccountActions({ account }: { account: Account }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-auto border-t border-border pt-3">
      {!confirming ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void account.signOut()}
            className="rounded-lg border border-border px-2 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-danger px-2 py-1.5 text-xs text-danger hover:bg-danger-soft"
          >
            Borrar cuenta
          </button>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border border-danger p-3">
          <p className="text-sm text-foreground">
            Se borran para siempre tu cuenta, tu apodo y tu progreso. No se puede deshacer.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void account.deleteAccount().then((message) => {
                  setBusy(false);
                  setError(message);
                });
              }}
              className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-danger-foreground disabled:opacity-50"
            >
              {busy ? "Borrando…" : "Sí, borrar todo"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
