// Reemplazo de socket.io-client para las demos: un bus en memoria. Mantiene la
// API que usa createSocketFeed en src/lib/runit.ts (io, on, onAny, emit,
// disconnect). El backend simulado emite con broadcast/toRoom.
type Listener = (payload?: unknown) => void;
type AnyListener = (event: string, payload?: unknown) => void;

export type Socket = FakeSocket;

export type FakeSocket = {
  on: (event: string, cb: Listener) => FakeSocket;
  onAny: (cb: (event: string, payload?: unknown) => void) => FakeSocket;
  emit: (event: string, payload?: unknown) => FakeSocket;
  disconnect: () => FakeSocket;
  deliver: (event: string, payload?: unknown) => void;
  connected: boolean;
};

const sockets = new Set<FakeSocket & { rooms: Set<string> }>();
let clientEmit: ((socket: FakeSocket, event: string, payload: unknown) => void) | null = null;

export function onClientEmit(handler: (socket: FakeSocket, event: string, payload: unknown) => void) {
  clientEmit = handler;
}

export function broadcast(event: string, payload: unknown) {
  sockets.forEach((s) => s.deliver(event, payload));
}

export function toRoom(roundId: string, event: string, payload: unknown) {
  sockets.forEach((s) => {
    if (s.rooms.has(`round:${roundId}`)) s.deliver(event, payload);
  });
}

export function io(_url?: string, _opts?: unknown): FakeSocket {
  const listeners = new Map<string, Listener[]>();
  const anyListeners: AnyListener[] = [];
  const socket = {
    rooms: new Set<string>(),
    connected: false,
    on(event: string, cb: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return socket;
    },
    onAny(cb: AnyListener) {
      anyListeners.push(cb);
      return socket;
    },
    emit(event: string, payload?: unknown) {
      if (event === "round:join" && typeof payload === "string") socket.rooms.add(`round:${payload}`);
      setTimeout(() => clientEmit?.(socket, event, payload), 30);
      return socket;
    },
    disconnect() {
      socket.connected = false;
      sockets.delete(socket);
      return socket;
    },
    deliver(event: string, payload?: unknown) {
      if (!socket.connected) return;
      setTimeout(() => {
        listeners.get(event)?.forEach((cb) => cb(payload));
        anyListeners.forEach((cb) => cb(event, payload));
      }, 20);
    },
  };
  sockets.add(socket);
  setTimeout(() => {
    socket.connected = true;
    listeners.get("connect")?.forEach((cb) => cb());
  }, 80);
  return socket;
}

export default { io };
