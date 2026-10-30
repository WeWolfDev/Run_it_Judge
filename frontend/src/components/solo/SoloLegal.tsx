import type { ReactNode } from "react";

import { CreditsContent } from "@/components/legal/CreditsContent";
import { Contact, Pending, Section } from "@/components/legal/LegalParts";
import { ADDRESS } from "@/lib/legal";

// Páginas legales del modo solo publicado en GitHub Pages (src/solo-main.tsx).
// El sitio no tiene servidor propio ni cuentas: estos textos describen eso y
// difieren de /legal/privacidad del torneo. Al cambiar qué guarda el navegador
// o a qué servicios se conecta, actualizar el texto y la fecha.

export type LegalPage = "privacidad" | "seguridad" | "creditos";

const UPDATED = "30 de octubre de 2026";
const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const REPO = "https://github.com/WeWolfDev/Run_it_Judge";

const PAGES: { id: LegalPage; label: string }[] = [
  { id: "privacidad", label: "Aviso de privacidad" },
  { id: "seguridad", label: "Seguridad y protección" },
  { id: "creditos", label: "Créditos y licencias" },
];

/** Enlaces al pie del juego. Cambian el hash: el juego sigue montado detrás. */
export function SoloFooter() {
  return (
    <footer className="border-t border-border">
      <nav
        aria-label="Información legal"
        className="mx-auto flex max-w-7xl flex-wrap gap-x-5 gap-y-2 px-5 py-4 text-xs text-muted-foreground"
      >
        {PAGES.map((page) => (
          <a key={page.id} href={`#${page.id}`} className="hover:text-foreground hover:underline">
            {page.label}
          </a>
        ))}
        <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-foreground">
          Código en GitHub
        </a>
        <span className="ml-auto">Run It · WeWolf</span>
      </nav>
    </footer>
  );
}

/** Mismo marco que /legal del torneo, con enlaces por hash en vez de rutas. */
export function SoloLegal({ page }: { page: LegalPage }) {
  return (
    <div className="run-it-statement min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <a href="#" className="text-primary" style={PIXEL}>
            Run&nbsp;It
          </a>
          <span className="text-sm text-muted-foreground">Demo solo · Legal</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-8 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Secciones legales" className="flex flex-row flex-wrap gap-2 md:flex-col">
          {PAGES.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={item.id === page ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm hover:bg-muted hover:text-foreground ${
                item.id === page
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {item.label}
            </a>
          ))}
          <a
            href="#"
            className="mt-auto rounded-md px-3 py-2 text-sm text-primary hover:underline md:mt-6"
          >
            Volver al juego
          </a>
        </nav>
        <main className="min-w-0">
          {page === "privacidad" && <Privacy />}
          {page === "seguridad" && <Security />}
          {page === "creditos" && <CreditsContent />}
        </main>
      </div>
    </div>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">{children}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última actualización: {UPDATED}</p>
    </>
  );
}

const B = ({ children }: { children: ReactNode }) => <b className="text-foreground">{children}</b>;

function Privacy() {
  return (
    <article>
      <Title>Aviso de privacidad</Title>

      <Section title="1. Responsable">
        <p>
          <B>WeWolf</B>, organizador de Run It, con domicilio en{" "}
          {ADDRESS ?? <Pending>[domicilio]</Pending>}, publica esta demo. Para cualquier asunto
          sobre tus datos puedes escribir a <Contact />.
        </p>
      </Section>

      <Section title="2. Qué datos recabamos">
        <p>
          <B>Ninguno.</B> La demo solo no tiene cuentas, no pide tu nombre, correo ni teléfono y no
          tiene un servidor propio que reciba información tuya.
        </p>
        <p>
          <B>Tu código no sale de tu computadora.</B> Se compila y se ejecuta dentro de tu
          navegador. Los casos de prueba se descargan del sitio y la comparación también ocurre en
          tu equipo. Nadie, tampoco el organizador, ve lo que escribes ni tus resultados.
        </p>
      </Section>

      <Section title="3. Lo que se guarda en tu navegador">
        <p>
          La demo no usa cookies. Guarda en el almacenamiento local de tu navegador, solo en tu
          equipo:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>el personaje que elegiste,</li>
          <li>la paleta de colores y si el sonido está activado,</li>
          <li>tu mejor tiempo en cada ejercicio.</li>
        </ul>
        <p>
          Puedes borrarlo cuando quieras desde la configuración de tu navegador (datos de sitios).
          Si usas una computadora compartida, como la del laboratorio, cualquiera que la use después
          verá tu personaje y tus tiempos.
        </p>
      </Section>

      <Section title="4. Servicios externos">
        <p>
          Para funcionar, tu navegador se conecta a servicios de terceros. Como con cualquier sitio
          web, reciben tu dirección IP y los datos técnicos de tu navegador, pero{" "}
          <B>no reciben tu código ni tus resultados</B>:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>GitHub Pages</B> (GitHub, Inc.), que aloja el sitio. Puede registrar las visitas
            según la{" "}
            <a
              href="https://docs.github.com/es/site-policy/privacy-policies/github-general-privacy-statement"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              declaración de privacidad de GitHub
            </a>
            .
          </li>
          <li>
            <B>Google Fonts</B>, que entrega las tipografías.
          </li>
          <li>
            <B>jsDelivr</B>, desde donde se descargan el compilador de C y C++ y, si eliges Python,
            Pyodide.
          </li>
        </ul>
      </Section>

      <Section title="5. Menores de edad">
        <p>
          La demo está pensada para alumnos del club, incluidos menores de edad. Como no pide ni
          guarda datos personales, se puede usar sin registrarse y sin dar información de nadie.
        </p>
      </Section>

      <Section title="6. Tus derechos">
        <p>
          Como no guardamos datos tuyos, no hay nada que consultar, corregir o borrar de nuestro
          lado: lo único que existe está en tu navegador y lo controlas tú. Si tienes dudas, escribe
          a <Contact />.
        </p>
      </Section>

      <Section title="7. Cambios a este aviso">
        <p>
          Si la demo empieza a guardar datos en un servidor (por ejemplo, un ranking del club),
          actualizaremos este aviso antes de hacerlo y lo publicaremos aquí con su fecha.
        </p>
      </Section>
    </article>
  );
}

function Security() {
  return (
    <article>
      <Title>Seguridad y protección</Title>

      <Section title="Sin cuentas ni contraseñas">
        <p>
          La demo no tiene inicio de sesión, así que no hay contraseñas ni cuentas que puedan
          filtrarse. No te pediremos datos personales: si alguna página que dice ser Run It te pide
          una contraseña o un pago, no es nuestra.
        </p>
      </Section>

      <Section title="Tu código corre aislado en tu navegador">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>C y C++</B> se compilan con Clang a WebAssembly y corren en segundo plano, aparte de
            la página (un Web Worker). El programa solo puede leer la entrada del caso y escribir su
            salida: no tiene acceso a tus archivos ni a internet.
          </li>
          <li>
            <B>Python</B> corre con Pyodide, también en un Web Worker aparte de la página.
          </li>
          <li>
            Cada caso tiene un límite de tiempo. Si un programa se cuelga, el navegador lo detiene y
            el juego sigue.
          </li>
        </ul>
        <p>
          Lo que se ejecuta es el código que tú escribes. Si pegas código de otra persona, revísalo
          antes de enviarlo, como harías con cualquier programa.
        </p>
      </Section>

      <Section title="Cómo protegemos el sitio">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Conexión cifrada.</B> GitHub Pages sirve el sitio por HTTPS: nadie en la red del
            laboratorio puede ver ni modificar lo que descargas.
          </li>
          <li>
            <B>Política de seguridad de contenido.</B> La página solo acepta código del propio sitio
            y de jsDelivr. Un script inyectado desde otro lugar no se ejecuta.
          </li>
          <li>
            <B>Versiones fijas.</B> El compilador y Pyodide se descargan siempre en la misma
            versión, fijada en el código. Una actualización de esas bibliotecas no cambia la demo
            sin que la revisemos.
          </li>
          <li>
            <B>Código abierto.</B> Todo el código del sitio está en{" "}
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              GitHub
            </a>
            , y cada publicación sale de la rama principal por un proceso automático.
          </li>
        </ul>
      </Section>

      <Section title="Juego limpio">
        <p>
          Como el juez corre en tu navegador, los tiempos de la demo son de práctica: sirven para
          medirte a ti mismo y no cuentan para el torneo. Las competencias oficiales se juegan en el
          servidor del torneo, donde el código se evalúa con Judge0.
        </p>
      </Section>

      <Section title="Reportar un problema de seguridad">
        <p>
          Si encuentras una falla de seguridad, escríbenos a <Contact /> con los pasos para
          reproducirla. No la publiques en un issue de GitHub hasta que la hayamos corregido.
        </p>
      </Section>
    </article>
  );
}
