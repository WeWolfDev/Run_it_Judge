import { useEffect, useState } from "react";

import { SoloAccount } from "@/components/solo/account/SoloAccount";
import { SoloDemo } from "@/components/solo/SoloDemo";
import { SoloFooter, SoloLegal, type LegalPage } from "@/components/solo/SoloLegal";

const LEGAL: readonly string[] = ["privacidad", "terminos", "seguridad", "creditos"];

function legalFromHash(): LegalPage | null {
  const hash = window.location.hash.slice(1);
  return LEGAL.includes(hash) ? (hash as LegalPage) : null;
}

// Las páginas legales van por hash (#privacidad, #terminos, #seguridad, #creditos) porque
// GitHub Pages no reescribe rutas. El juego queda montado detrás: abrir el aviso
// a mitad de una partida no la pierde.
export function SoloApp() {
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
        <SoloDemo account={<SoloAccount />} />
        <SoloFooter />
      </div>
      {legal && <SoloLegal page={legal} />}
    </>
  );
}
