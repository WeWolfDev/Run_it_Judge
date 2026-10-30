import { useEffect, useState } from "react";

import { useAccount } from "@/components/solo/account/useAccount";
import { SoloHub } from "@/components/solo/aprende/SoloHub";
import { SoloFooter, SoloLegal, type LegalPage } from "@/components/solo/SoloLegal";
import { SoloStart } from "@/components/solo/SoloStart";

const LEGAL: readonly string[] = ["privacidad", "terminos", "seguridad", "creditos"];

function legalFromHash(): LegalPage | null {
  const hash = window.location.hash.slice(1);
  return LEGAL.includes(hash) ? (hash as LegalPage) : null;
}

// Las páginas legales van por hash (#privacidad, #terminos, #seguridad, #creditos) porque
// GitHub Pages no reescribe rutas. El juego queda montado detrás: abrir el aviso
// a mitad de una partida no la pierde. Se entra por la pantalla de inicio
// (SoloStart), como al login del torneo; el logo de arriba regresa a ella.
export function SoloApp() {
  const account = useAccount();
  const [screen, setScreen] = useState<"start" | "play">("start");
  const [legal, setLegal] = useState(legalFromHash);
  useEffect(() => {
    const onHash = () => {
      setLegal(legalFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      <div hidden={legal !== null}>
        {screen === "start" ? (
          <SoloStart account={account} onPlay={() => setScreen("play")} />
        ) : (
          <>
            <SoloHub account={account} onExit={() => setScreen("start")} />
            <SoloFooter />
          </>
        )}
      </div>
      {legal && <SoloLegal page={legal} />}
    </>
  );
}

/** Lo único que se muestra si el sitio está dentro de un iframe (solo-main.tsx). */
export function SoloFramed() {
  return (
    <p className="grid min-h-dvh place-items-center bg-background p-6 text-center text-sm text-foreground">
      <a href={window.location.href} target="_top" className="text-primary underline">
        Abre Run It Solo en su propia pestaña
      </a>
    </p>
  );
}
