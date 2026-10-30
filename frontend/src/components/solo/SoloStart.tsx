import { ArcadeDeck } from "@/components/ArcadeDeck";
import { LoginBackdrop } from "@/components/LoginBackdrop";
import { useArcadeDeck } from "@/hooks/use-arcade-deck";
import { play } from "@/lib/sfx";

import { NicknameFields, SignInOptions } from "./account/SoloAccount";
import type { Account } from "./account/useAccount";

// Pantalla de inicio del modo solo publicado: el mismo gabinete arcade del
// login del torneo (routes/login.tsx, estilos login-* en styles.css). Solo usa
// el fondo "arcade", dibujado por código: los otros fondos son de terceros y no
// se publican en este sitio. Se puede jugar sin cuenta.

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

const LEGAL = [
  { href: "#privacidad", label: "Privacidad" },
  { href: "#terminos", label: "Términos" },
  { href: "#seguridad", label: "Seguridad" },
  { href: "#creditos", label: "Créditos" },
];

export function SoloStart({ account, onPlay }: { account: Account; onPlay: () => void }) {
  const deck = useArcadeDeck();
  const { state } = account;
  const start = () => {
    play("coin");
    onPlay();
  };

  return (
    <main className="login-cabinet flex min-h-dvh flex-col overflow-x-clip">
      <div className="login-bezel flex flex-1 p-3 sm:p-6 lg:px-12 lg:pt-8">
        <section className="login-screen relative flex min-h-[480px] flex-1 items-center justify-center overflow-hidden">
          <div className="login-glass pointer-events-none absolute inset-0">
            <LoginBackdrop id="arcade" />
            <div className="absolute inset-0 bg-black/35" />
            <div className="login-scanlines absolute inset-0" />
            <div className="run-it-crt-sweep" />
            <div className="login-vignette absolute inset-0" />
          </div>

          <div className="relative z-10 flex w-full flex-col items-center gap-6 px-4 py-10">
            <h1
              className="login-title text-center text-4xl text-primary sm:text-6xl lg:text-7xl"
              style={PIXEL}
            >
              Run It
            </h1>

            <div
              className="w-full max-w-[340px] space-y-4 border-2 border-primary bg-card/85 p-4 shadow-[6px_6px_0_0_var(--primary)] backdrop-blur-sm"
              onKeyDown={() => deck.pulse(Math.random() < 0.5 ? "left" : "right")}
            >
              <p className="text-center text-[10px] text-accent" style={PIXEL}>
                {state.status === "needsNickname" ? "Nuevo jugador" : "Modo solo"}
              </p>

              {state.status === "needsNickname" ? (
                <>
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    Elige tu apodo: es lo único que te identifica en el juego. Puede ser inventado;
                    no uses tu nombre real.
                  </p>
                  <NicknameFields
                    onSave={account.saveNickname}
                    onSignOut={() => void account.signOut()}
                  />
                </>
              ) : (
                <>
                  {state.status === "ready" && (
                    <p className="text-center text-sm text-foreground">
                      Hola, <b className="font-mono">{state.apodo}</b>
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={start}
                    className="login-start w-full bg-primary py-2.5 text-[11px] text-primary-foreground"
                    style={PIXEL}
                  >
                    Press start
                  </button>
                  {state.status === "ready" ? (
                    <button
                      type="button"
                      onClick={() => void account.signOut()}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Cerrar sesión
                    </button>
                  ) : state.status === "loading" ? (
                    <p className="text-center text-xs text-muted-foreground">
                      Revisando tu cuenta…
                    </p>
                  ) : (
                    <>
                      <p className="text-center text-xs text-muted-foreground">
                        Juega sin cuenta, o entra para guardar tu progreso
                      </p>
                      {state.status === "error" && (
                        <p className="text-xs text-danger">{state.message}</p>
                      )}
                      <SignInOptions
                        notice={state.status === "signedOut" ? state.notice : undefined}
                        onSignIn={(provider) => void account.signIn(provider)}
                      />
                    </>
                  )}
                </>
              )}

              <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {LEGAL.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="hover:text-foreground hover:underline"
                  >
                    {link.label}
                  </a>
                ))}
              </p>
            </div>
          </div>
        </section>
      </div>
      <ArcadeDeck stick={deck.stick} pressed={deck.pressed} />
    </main>
  );
}
