import { useEffect, useMemo, useRef, useState } from "react";

import { createSocketFeed } from "@/lib/runit";

// Voto del público: la grada elige por QR (/votar) un hit bueno o uno malo que
// cae sobre la ronda en vivo. Las reglas y los efectos viven en el servidor
// (run-it-backend/hits.js); acá están los textos, la API y el estado en vivo.

export type HitId =
  | "extra"
  | "amnistia"
  | "cupo-mas"
  | "pista"
  | "aliento"
  | "penal-doble"
  | "reloj-oculto"
  | "apagon"
  | "niebla"
  | "cupo-menos";

export type HitInfo = {
  kind: "bueno" | "malo";
  name: string;
  /** Lo que lee el público en el celular. */
  text: string;
  /** A quién afecta, para el admin. */
  scope: string;
};

export const HITS: Record<HitId, HitInfo> = {
  extra: {
    kind: "bueno",
    name: "Minuto extra",
    text: "Suma 1 minuto al reloj de la ronda para todos.",
    scope: "Reloj de la ronda",
  },
  amnistia: {
    kind: "bueno",
    name: "Amnistía",
    text: "Durante 1:30 los envíos fallidos no suman penalización.",
    scope: "Penalización de todos",
  },
  "cupo-mas": {
    kind: "bueno",
    name: "Cupo +1",
    text: "Clasifica uno más en esta ronda.",
    scope: "Cupo de la ronda",
  },
  pista: {
    kind: "bueno",
    name: "Pista del organizador",
    text: "Los participantes reciben una pista del problema.",
    scope: "Aviso junto al enunciado",
  },
  aliento: {
    kind: "bueno",
    name: "Aliento de la grada",
    text: "Confeti y un mensaje de la grada en cada pantalla.",
    scope: "Cosmético",
  },
  "penal-doble": {
    kind: "malo",
    name: "Penalización doble",
    text: "Durante 2 minutos cada envío fallido cuesta +60 s en vez de +30 s.",
    scope: "Penalización de todos",
  },
  "reloj-oculto": {
    kind: "malo",
    name: "Reloj oculto",
    text: "El cronómetro desaparece durante 60 s.",
    scope: "Pista y vista del participante",
  },
  apagon: {
    kind: "malo",
    name: "Apagón",
    text: "La pantalla del público se apaga durante 45 s.",
    scope: "Solo /pista y /publico",
  },
  niebla: {
    kind: "malo",
    name: "Niebla",
    text: "Oculta el ranking a todos durante 75 s.",
    scope: "Ranking de la pista y del participante",
  },
  "cupo-menos": {
    kind: "malo",
    name: "Cupo −1",
    text: "Clasifica uno menos en esta ronda.",
    scope: "Cupo de la ronda",
  },
};

export const hitInfo = (id: string): HitInfo =>
  HITS[id as HitId] ?? { kind: "bueno", name: id, text: "", scope: "" };

export type HitPoll = {
  id: string;
  good: HitId;
  bad: HitId;
  announced_at: string;
  opens_at: string;
  closes_at: string;
  status: "open" | "closed" | "cancelled";
  winner: HitId | null;
  tally: { good: number; bad: number };
  mine: "good" | "bad" | null;
};

export type ActiveHit = { id: string; hit: HitId; starts_at: string; ends_at: string | null };

export type HitsState = {
  round_id: string;
  server_now: number;
  polls_used: number;
  max_polls: number;
  poll: HitPoll | null;
  active: ActiveHit[];
  hint: string | null;
};

export type AdminHitsState = HitsState & {
  pairs: Array<{ index: number; weight: number; good: HitId; bad: HitId; blocked: string | null }>;
  history: Array<{
    id: string;
    good: HitId;
    bad: HitId;
    status: HitPoll["status"];
    winner: HitId | null;
    announced_at: string;
    good_votes: number;
    bad_votes: number;
  }>;
};

const API_URL = import.meta.env["VITE_API_URL"] ?? "";
const VOTER_KEY = "run-it-votante";

function authHeaders(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem("run-it-session");
    const session = raw ? (JSON.parse(raw) as { token?: string }) : {};
    return session.token ? { authorization: `Bearer ${session.token}` } : {};
  } catch {
    return {};
  }
}

/** Token anónimo de este navegador: un voto por persona y por votación. */
export function voterId() {
  try {
    let id = window.localStorage.getItem(VOTER_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      window.localStorage.setItem(VOTER_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || fallback);
  return body as T;
}

export async function getPublicHits() {
  const response = await fetch(`${API_URL}/public/hits`, { headers: { "x-voter": voterId() } });
  return json<HitsState | null>(response, "No se pudo cargar la votación");
}

export async function voteHit(pollId: string, choice: "good" | "bad") {
  const response = await fetch(`${API_URL}/public/hits/vote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-voter": voterId() },
    body: JSON.stringify({ pollId, choice }),
  });
  return json<{ voted: string }>(response, "No se pudo votar");
}

export async function getAdminHits(roundId: string) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/hits`, { headers: authHeaders() });
  return json<AdminHitsState>(response, "No se pudo cargar el voto del público");
}

export async function announcePoll(roundId: string, pair: number) {
  const response = await fetch(`${API_URL}/rounds/${roundId}/hits/polls`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ pair }),
  });
  return json<unknown>(response, "No se pudo anunciar la votación");
}

async function adminPost(url: string, fallback: string) {
  const response = await fetch(`${API_URL}${url}`, { method: "POST", headers: authHeaders() });
  return json<unknown>(response, fallback);
}

export const cancelPoll = (pollId: string) =>
  adminPost(`/hits/polls/${pollId}/cancel`, "No se pudo cancelar el anuncio");
export const closePollNow = (pollId: string) =>
  adminPost(`/hits/polls/${pollId}/close`, "No se pudo cerrar la votación");
export const cancelHit = (hitId: string) =>
  adminPost(`/round-hits/${hitId}/cancel`, "No se pudo cancelar el hit");

export const ms = (value: string | null) => (value ? new Date(value).getTime() : null);

/** Porcentaje de una opción en el recuento; sin votos, mitad y mitad. */
export const percent = (poll: HitPoll, side: "good" | "bad") => {
  const total = poll.tally.good + poll.tally.bad;
  return total ? Math.round((poll.tally[side] / total) * 100) : 50;
};

export function formatLeft(msLeft: number) {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Estado del voto en vivo: GET /public/hits al cargar, con cada evento del
 * socket y cada 5 s. `now` es la hora del servidor (corrige el reloj local),
 * así todos cuentan hacia el mismo instante.
 */
export function useHits() {
  const [state, setState] = useState<HitsState | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const reloadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void getPublicHits()
        .then((next) => {
          if (cancelled) return;
          setState(next);
          if (next) setOffset(next.server_now - Date.now());
        })
        .catch(() => undefined);
    reloadRef.current = load;
    load();
    const poll = setInterval(load, 5000);
    const feed = createSocketFeed("");
    feed?.on("feed:connected", load);
    feed?.on("hits:update", load);
    feed?.on("round:started", load);
    feed?.on("round:closed", load);
    feed?.on("hits:tally", (event) =>
      setState((current) =>
        current?.poll?.id === event.poll_id
          ? { ...current, poll: { ...current.poll, tally: { good: event.good, bad: event.bad } } }
          : current,
      ),
    );
    return () => {
      cancelled = true;
      clearInterval(poll);
      feed?.disconnect();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const serverNow = now + offset;
  return useMemo(() => {
    const poll = state?.poll ?? null;
    const opensAt = ms(poll?.opens_at ?? null) ?? 0;
    const closesAt = ms(poll?.closes_at ?? null) ?? 0;
    const phase: "none" | "announced" | "open" | "result" = !poll
      ? "none"
      : poll.status === "open" && serverNow < opensAt
        ? "announced"
        : poll.status === "open"
          ? "open"
          : "result";
    const active = (state?.active ?? []).filter((hit) => {
      const end = ms(hit.ends_at);
      return end === null || end > serverNow;
    });
    const left = (id: HitId) => {
      const hit = active.find((entry) => entry.hit === id);
      const end = hit ? ms(hit.ends_at) : null;
      return end === null ? 0 : Math.max(0, end - serverNow);
    };
    return {
      state,
      poll,
      phase,
      now: serverNow,
      opensIn: Math.max(0, opensAt - serverNow),
      closesIn: Math.max(0, closesAt - serverNow),
      /** Recién cerrada: el cartel "La grada eligió" dura unos segundos. */
      justDecided: phase === "result" && serverNow - closesAt < 8000,
      active,
      isOn: (id: HitId) => active.some((entry) => entry.hit === id),
      left,
      reload: () => reloadRef.current(),
      setMine: (choice: "good" | "bad") =>
        setState((current) =>
          current?.poll
            ? {
                ...current,
                poll: {
                  ...current.poll,
                  mine: choice,
                  tally: { ...current.poll.tally, [choice]: current.poll.tally[choice] + 1 },
                },
              }
            : current,
        ),
    };
  }, [state, serverNow]);
}

export type LiveHits = ReturnType<typeof useHits>;
