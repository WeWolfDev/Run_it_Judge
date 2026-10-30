import { useState, type ReactNode } from "react";

import { PixelIcon } from "@/components/PixelIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { NICKNAME, useAccount, type Provider } from "./useAccount";

// Cuenta opcional del modo solo, en la barra de arriba: entrar con GitHub o
// Google, elegir un apodo, cerrar sesión y borrar la cuenta. Jugar no la
// necesita. Lo que guarda está descrito en el aviso (#privacidad).

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const CONTENT = "w-[calc(100%-2rem)] max-w-md rounded-xl border-border bg-card";
const BUTTON =
  "rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "github", label: "Entrar con GitHub" },
  { id: "google", label: "Entrar con Google" },
];

export function SoloAccount() {
  const account = useAccount();
  const { state } = account;
  const [open, setOpen] = useState(false);
  // El apodo se pide al volver del login; si se cierra, queda en el botón.
  const [askedNickname, setAskedNickname] = useState(false);
  const nicknameOpen = state.status === "needsNickname" && (open || !askedNickname);

  const label =
    state.status === "loading"
      ? "Cuenta…"
      : state.status === "ready"
        ? state.apodo
        : state.status === "needsNickname"
          ? "Elegir apodo"
          : state.status === "error"
            ? "Cuenta: error"
            : "Entrar";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={state.status === "loading"}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
      >
        <PixelIcon name="users" className="h-4 w-4 text-primary" />
        <span className="max-w-[10rem] truncate">{label}</span>
      </button>

      {state.status === "needsNickname" ? (
        <Dialog
          open={nicknameOpen}
          onOpenChange={(next) => {
            setAskedNickname(true);
            setOpen(next);
          }}
        >
          <DialogContent className={CONTENT}>
            <NicknameForm
              onSave={account.saveNickname}
              onSignOut={() => {
                setOpen(false);
                void account.signOut();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className={CONTENT}>
            {state.status === "ready" ? (
              <AccountPanel
                apodo={state.apodo}
                onSignOut={() => {
                  setOpen(false);
                  void account.signOut();
                }}
                onDelete={account.deleteAccount}
              />
            ) : state.status === "error" ? (
              <Header title="Tu cuenta">
                <p className="text-sm text-danger">{state.message}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={PRIMARY} onClick={() => void account.retry()}>
                    Reintentar
                  </button>
                  <button type="button" className={BUTTON} onClick={() => void account.signOut()}>
                    Cerrar sesión
                  </button>
                </div>
              </Header>
            ) : (
              <SignInPanel
                notice={state.status === "signedOut" ? state.notice : undefined}
                onSignIn={(provider) => void account.signIn(provider)}
                onLeave={() => setOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function Header({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-sm text-primary" style={PIXEL}>
          {title}
        </DialogTitle>
      </DialogHeader>
      {children}
    </div>
  );
}

function LegalLink({
  href,
  children,
  onLeave,
}: {
  href: string;
  children: ReactNode;
  onLeave: () => void;
}) {
  return (
    <a href={href} onClick={onLeave} className="text-primary hover:underline">
      {children}
    </a>
  );
}

function SignInPanel({
  notice,
  onSignIn,
  onLeave,
}: {
  notice: string | undefined;
  onSignIn: (provider: Provider) => void;
  onLeave: () => void;
}) {
  const [going, setGoing] = useState<Provider | null>(null);
  return (
    <Header title="Guarda tu progreso">
      <DialogDescription className="text-sm text-muted-foreground">
        La cuenta es opcional: puedes seguir jugando sin ella. Sirve para guardar tu avance y
        recuperarlo en otra computadora. Solo guardamos un apodo y tu progreso; tu código nunca sale
        de tu navegador.
      </DialogDescription>
      {notice && <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{notice}</p>}
      <div className="grid gap-2">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled={going !== null}
            onClick={() => {
              setGoing(provider.id);
              onSignIn(provider.id);
            }}
            className={provider.id === "github" ? PRIMARY : BUTTON}
          >
            {going === provider.id ? "Abriendo…" : provider.label}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Al entrar aceptas los{" "}
        <LegalLink href="#terminos" onLeave={onLeave}>
          términos y condiciones
        </LegalLink>{" "}
        y el{" "}
        <LegalLink href="#privacidad" onLeave={onLeave}>
          aviso de privacidad
        </LegalLink>
        . Si eres menor de 18 años, necesitas el permiso de tu madre, padre o tutor. En una
        computadora compartida, cierra sesión al terminar.
      </p>
    </Header>
  );
}

function NicknameForm({
  onSave,
  onSignOut,
}: {
  onSave: (apodo: string) => Promise<string | null>;
  onSignOut: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = NICKNAME.test(value);
  return (
    <Header title="Elige tu apodo">
      <DialogDescription className="text-sm text-muted-foreground">
        Es lo único que te identifica en el juego. Puede ser inventado: no uses tu nombre real.
      </DialogDescription>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || saving) return;
          setSaving(true);
          void onSave(value).then((message) => {
            setSaving(false);
            setError(message);
          });
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Apodo</span>
          <input
            id="solo-apodo"
            value={value}
            onChange={(event) => {
              setValue(event.target.value.trim());
              setError(null);
            }}
            maxLength={20}
            autoComplete="off"
            autoFocus
            aria-invalid={error !== null}
            aria-describedby="solo-apodo-ayuda"
            className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-foreground outline-none focus:border-ring"
          />
          <span
            id="solo-apodo-ayuda"
            className={error ? "text-danger" : "text-xs text-muted-foreground"}
          >
            {error ?? "De 3 a 20 caracteres: letras sin acentos, números, guion o guion bajo."}
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY} disabled={!valid || saving}>
            {saving ? "Guardando…" : "Guardar apodo"}
          </button>
          <button type="button" className={BUTTON} onClick={onSignOut}>
            Salir de la cuenta
          </button>
        </div>
      </form>
    </Header>
  );
}

function AccountPanel({
  apodo,
  onSignOut,
  onDelete,
}: {
  apodo: string;
  onSignOut: () => void;
  onDelete: () => Promise<string | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Header title="Tu cuenta">
      <DialogDescription className="text-sm text-muted-foreground">
        Entraste como <b className="font-mono text-foreground">{apodo}</b>. Tu progreso se guarda en
        tu cuenta.
      </DialogDescription>
      {!confirming ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} onClick={onSignOut}>
            Cerrar sesión
          </button>
          <button
            type="button"
            className="rounded-lg border border-danger px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft"
            onClick={() => setConfirming(true)}
          >
            Borrar mi cuenta
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
              disabled={deleting}
              className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-danger-foreground disabled:opacity-50"
              onClick={() => {
                setDeleting(true);
                void onDelete().then((message) => {
                  setDeleting(false);
                  setError(message);
                });
              }}
            >
              {deleting ? "Borrando…" : "Sí, borrar todo"}
            </button>
            <button type="button" className={BUTTON} onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Header>
  );
}
