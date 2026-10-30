import { useEffect, useState } from "react";

import { SoloAccount } from "@/components/solo/account/SoloAccount";
import { useAccount } from "@/components/solo/account/useAccount";
import { SoloDemo } from "@/components/solo/SoloDemo";
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
// (SoloStart), como al login del torneo; "Volver al login" regresa a ella.
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
            <SoloDemo
              onExit={() => setScreen("start")}
              account={<SoloAccount account={account} />}
            />
            <SoloFooter />
          </>
        )}
      </div>
      {legal && <SoloLegal page={legal} />}
    </>
  );
}
