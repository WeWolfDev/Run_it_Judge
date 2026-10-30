import type { ReactNode } from "react";

import { CreditsContent } from "@/components/legal/CreditsContent";
import { Contact, Pending, Section } from "@/components/legal/LegalParts";
import { ADDRESS } from "@/lib/legal";

// Páginas legales del modo solo publicado en GitHub Pages (src/solo-main.tsx).
// Se juega sin cuenta; la cuenta (GitHub o Google, vía Supabase) es opcional y
// solo guarda un apodo y el progreso del roadmap. Difieren de /legal del torneo.
// Al cambiar qué se guarda, dónde o con qué servicios, actualizar el texto y la
// fecha. Los enlaces #privacidad y #terminos están en la pantalla de
// consentimiento de Google: no cambiarlos.

export type LegalPage = "privacidad" | "terminos" | "seguridad" | "creditos";

const UPDATED = "31 de octubre de 2026";
const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };
const REPO = "https://github.com/WeWolfDev/Run_it_Judge";

const PAGES: { id: LegalPage; label: string }[] = [
  { id: "privacidad", label: "Aviso de privacidad" },
  { id: "terminos", label: "Términos y condiciones" },
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
          {page === "terminos" && <Terms />}
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

function Link({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className="text-primary hover:underline"
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
}

function Privacy() {
  return (
    <article>
      <Title>Aviso de privacidad</Title>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Aviso de privacidad integral conforme a la Ley Federal de Protección de Datos Personales en
        Posesión de los Particulares. Resumen: <B>puedes jugar sin cuenta y sin dar ningún dato</B>.
        Si decides crear una cuenta, solo guardamos lo necesario para conservar tu progreso.
      </p>

      <Section title="1. Responsable">
        <p>
          <B>WeWolf</B>, organizador de Run It, con domicilio en{" "}
          {ADDRESS ?? <Pending>[domicilio]</Pending>}, es responsable del tratamiento de tus datos
          personales. Para cualquier asunto sobre tus datos escribe a <Contact />.
        </p>
      </Section>

      <Section title="2. Si juegas sin cuenta">
        <p>
          <B>No recabamos ningún dato personal.</B> No pedimos nombre, correo ni teléfono.
        </p>
        <p>
          <B>Tu código no sale de tu computadora.</B> Se compila y se ejecuta dentro de tu
          navegador, y la comparación con los casos de prueba también ocurre en tu equipo. Nadie,
          tampoco el organizador, ve lo que escribes.
        </p>
      </Section>

      <Section title="3. Si creas una cuenta (opcional)">
        <p>
          La cuenta sirve para guardar tu avance en el roadmap y recuperarlo en otra computadora.
          Entras con <B>GitHub</B> o <B>Google</B>; no creamos ni guardamos contraseñas. Tratamos:
        </p>
        <List>
          <li>
            <B>Datos que entrega GitHub o Google al iniciar sesión</B>: tu correo, el identificador
            de tu cuenta en ese servicio y, si los tiene, tu nombre de perfil y tu foto. Los usamos
            solo para identificarte al entrar; <B>no se muestran en el juego</B>.
          </li>
          <li>
            <B>Apodo</B> que eliges. Es lo único que te identifica dentro del juego. Puede ser
            inventado; te pedimos no usar tu nombre real.
          </li>
          <li>
            <B>Progreso</B>: qué ejercicios del mapa resolviste y la fecha. Con eso se calculan tus
            XP.
          </li>
          <li>
            <B>Si lo activas, tu participación en el ranking global</B> (sí o no).
          </li>
          <li>
            <B>Datos técnicos</B> del inicio de sesión (fecha, dirección IP, navegador), que el
            proveedor de cuentas registra por seguridad.
          </li>
        </List>
        <p>
          Tu código fuente <B>nunca</B> se guarda en la cuenta. No tratamos datos personales
          sensibles.
        </p>
      </Section>

      <Section title="4. Para qué los usamos">
        <List>
          <li>Crear tu cuenta, iniciar tu sesión y mantenerla segura.</li>
          <li>Guardar y sincronizar tu progreso entre dispositivos.</li>
        </List>
        <p>
          Son finalidades necesarias: sin ellas la cuenta no funciona. No usamos tus datos para
          publicidad, no los vendemos y no hacemos perfiles.
        </p>
        <p>
          <B>Ranking global (opcional).</B> Solo si lo activas en la sección Ranking, cualquier
          persona que abra el sitio ve tu <B>apodo</B>, tus <B>XP</B> y cuántos ejercicios
          resolviste. Nunca tu correo ni tu nombre de perfil. Viene desactivado y puedes apagarlo
          cuando quieras: tu apodo deja de aparecer en ese momento.
        </p>
      </Section>

      <Section title="5. Con quién se comparten">
        <p>
          No vendemos ni transferimos tus datos a terceros para sus propios fines. Usamos estos
          proveedores, que los tratan por cuenta nuestra o solo para que el sitio funcione:
        </p>
        <List>
          <li>
            <B>Supabase</B>, que guarda las cuentas y el progreso. Sus servidores pueden estar fuera
            de México. <Link href="https://supabase.com/privacy">Aviso de Supabase</Link>.
          </li>
          <li>
            <B>GitHub</B> y <B>Google</B>, solo si eliges entrar con ellos: confirman tu identidad y
            nos entregan los datos del punto 3.
          </li>
          <li>
            <B>GitHub Pages</B>, que aloja el sitio y puede registrar visitas (
            <Link href="https://docs.github.com/es/site-policy/privacy-policies/github-general-privacy-statement">
              declaración de GitHub
            </Link>
            ).
          </li>
          <li>
            <B>Google Fonts</B> y <B>jsDelivr</B>, que entregan las tipografías y el compilador.
            Reciben tu dirección IP como cualquier sitio web, pero no tus datos de cuenta.
          </li>
        </List>
        <p>
          Las remisiones a estos encargados no requieren tu consentimiento, pero te las informamos.
          Solo entregaríamos datos a una autoridad si una ley o una orden judicial nos obliga.
        </p>
      </Section>

      <Section title="6. Cuánto tiempo los conservamos">
        <List>
          <li>Mientras tengas tu cuenta.</li>
          <li>
            Con <B>Borrar mi cuenta</B> eliminamos de inmediato tu cuenta, tu apodo y tu progreso.
            Si el proveedor guarda copias de respaldo, se eliminan en sus ciclos normales.
          </li>
          <li>
            Podemos borrar cuentas sin actividad por más de 2 años, avisándote antes al correo.
          </li>
        </List>
      </Section>

      <Section title="7. Lo que se guarda en tu navegador">
        <p>
          No usamos cookies de rastreo ni de publicidad. En el almacenamiento local de tu navegador
          se guardan tu personaje, la paleta, el sonido, tus mejores tiempos, los ejercicios que
          resolviste en el mapa, el borrador de tu código en cada ejercicio y, si entraste, tu
          sesión. Al cerrar sesión se borra de este navegador el progreso de tu cuenta. Si usas una
          computadora compartida, como la del laboratorio, <B>cierra sesión al terminar</B>. Puedes
          borrar todo desde la configuración del navegador.
        </p>
      </Section>

      <Section title="8. Menores de edad">
        <p>
          La demo está pensada para alumnos del club, incluidos menores de edad. Jugar sin cuenta no
          requiere dar ningún dato.{" "}
          <B>
            Si eres menor de 18 años, necesitas el permiso de tu madre, padre o tutor para crear una
            cuenta
          </B>
          . GitHub y Google, además, tienen su propia edad mínima. Si un tutor quiere borrar la
          cuenta de un menor, puede escribir a <Contact />.
        </p>
      </Section>

      <Section title="9. Tus derechos (ARCO)">
        <p>
          Puedes pedir <B>acceso</B> a tus datos, <B>rectificarlos</B>, <B>cancelarlos</B> u{" "}
          <B>oponerte</B> a su tratamiento, y revocar tu consentimiento o limitar su uso.
        </p>
        <List>
          <li>
            La forma más rápida de cancelar: <B>Borrar mi cuenta</B>, dentro del juego.
          </li>
          <li>
            Para todo lo demás, escribe a <Contact /> desde el correo de tu cuenta, con tu apodo y
            lo que solicitas. Te respondemos en un máximo de 20 días hábiles.
          </li>
        </List>
        <p>
          Si consideras que tu derecho a la protección de datos fue vulnerado, puedes acudir a la
          autoridad de protección de datos personales competente en México.
        </p>
      </Section>

      <Section title="10. Cambios a este aviso">
        <p>
          Publicaremos cualquier cambio en esta página con su fecha. Si un cambio agrega una
          finalidad nueva para tus datos, te lo pediremos al iniciar sesión antes de aplicarlo.
        </p>
      </Section>

      <Section title="11. Consentimiento">
        <p>
          Al crear tu cuenta confirmas que leíste este aviso y aceptas el tratamiento de tus datos
          para las finalidades descritas, y los <Link href="#terminos">términos y condiciones</Link>
          .
        </p>
      </Section>
    </article>
  );
}

function Terms() {
  return (
    <article>
      <Title>Términos y condiciones</Title>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Estas reglas aplican a Run It Solo, la demo de práctica publicada por <B>WeWolf</B> (
        {ADDRESS ?? <Pending>[domicilio]</Pending>}). Al usar el sitio las aceptas; si no estás de
        acuerdo, no lo uses.
      </p>

      <Section title="1. Qué es">
        <p>
          Un sitio gratuito para practicar programación competitiva contra el reloj, con un roadmap
          de aprendizaje. Es de práctica: los resultados <B>no cuentan</B> para los torneos de Run
          It ni para ninguna calificación, salvo que el organizador del club lo diga por escrito.
        </p>
      </Section>

      <Section title="2. Cuenta">
        <List>
          <li>La cuenta es opcional, personal y gratuita. Una por persona.</li>
          <li>
            Si eres menor de 18 años, necesitas el permiso de tu madre, padre o tutor para crearla.
          </li>
          <li>
            Eres responsable de tu cuenta de GitHub o Google y de cerrar sesión en computadoras
            compartidas.
          </li>
          <li>
            El <B>apodo</B> no puede ser ofensivo, discriminatorio, sexual, ni hacerse pasar por
            otra persona. Podemos cambiarlo o pedir que lo cambies.
          </li>
        </List>
      </Section>

      <Section title="3. Uso permitido">
        <p>Puedes usar el sitio para aprender y practicar. No está permitido:</p>
        <List>
          <li>intentar acceder a datos de otras personas o vulnerar la seguridad del sitio;</li>
          <li>
            automatizar envíos, saturar el servicio o manipular el progreso con herramientas
            externas;
          </li>
          <li>usar el sitio para algo ilegal o que dañe a otras personas.</li>
        </List>
        <p>
          Si encuentras una falla de seguridad, repórtala como dice la página de{" "}
          <Link href="#seguridad">seguridad</Link>: no la aproveches.
        </p>
      </Section>

      <Section title="4. Tu código y nuestro contenido">
        <List>
          <li>
            <B>El código que escribes es tuyo.</B> No lo guardamos ni lo vemos: se queda en tu
            navegador.
          </li>
          <li>
            Los enunciados, ejercicios, textos y diseño del juego son de WeWolf o de sus autores.
            Puedes usarlos para estudiar; no para copiarlos y publicarlos como tuyos.
          </li>
          <li>
            Los personajes, fuentes y bibliotecas de terceros tienen sus propias licencias, listadas
            en <Link href="#creditos">créditos y licencias</Link>.
          </li>
        </List>
      </Section>

      <Section title="5. Ranking global">
        <p>
          El ranking es de práctica y de honor: el juez corre en tu navegador. Inflar puntos con
          herramientas externas o resolver con la cuenta de otra persona va contra estas reglas.
          Podemos quitar del ranking una cuenta que lo haga. Aparecer en el ranking es opcional.
        </p>
      </Section>

      <Section title="6. Suspensión y baja">
        <p>
          Puedes borrar tu cuenta cuando quieras desde el juego. Podemos suspender o borrar una
          cuenta que incumpla estos términos; salvo en casos graves, primero te avisaremos.
        </p>
      </Section>

      <Section title="7. Sin garantías">
        <p>
          El sitio se ofrece gratis y <B>tal como está</B>. Hacemos lo posible para que funcione,
          pero puede tener errores, pausarse (por ejemplo, si el servicio de cuentas se suspende por
          inactividad), cambiar o dejar de existir. El juez del navegador puede no dar los mismos
          resultados que un juez oficial. Guarda por tu cuenta lo que no quieras perder, como tu
          código.
        </p>
      </Section>

      <Section title="8. Responsabilidad">
        <p>
          En la medida que lo permita la ley, WeWolf no responde por daños derivados del uso del
          sitio, de su indisponibilidad o de la pérdida de progreso. Nada de esto limita los
          derechos que la ley te reconoce y que no se pueden renunciar.
        </p>
      </Section>

      <Section title="9. Privacidad">
        <p>
          Cómo tratamos tus datos está en el <Link href="#privacidad">aviso de privacidad</Link>,
          que forma parte de estos términos.
        </p>
      </Section>

      <Section title="10. Cambios">
        <p>
          Podemos actualizar estos términos. Publicaremos la nueva versión aquí con su fecha; si el
          cambio es importante, lo avisaremos en el sitio. Seguir usándolo después significa que lo
          aceptas.
        </p>
      </Section>

      <Section title="11. Ley aplicable y contacto">
        <p>
          Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier
          controversia, las partes se someten a los tribunales de Mérida, Yucatán. Dudas o reclamos:{" "}
          <Contact />.
        </p>
      </Section>
    </article>
  );
}

function Security() {
  return (
    <article>
      <Title>Seguridad y protección</Title>

      <Section title="Cuentas sin contraseñas">
        <List>
          <li>
            Se juega sin cuenta. Si creas una, entras con <B>GitHub</B> o <B>Google</B>: nosotros
            nunca vemos ni guardamos una contraseña.
          </li>
          <li>
            Las cuentas y el progreso los guarda <B>Supabase</B>. Reglas en la base de datos (RLS)
            hacen que cada cuenta solo pueda leer y modificar <B>sus propios</B> datos; nadie sin
            sesión puede leer nada.
          </li>
          <li>
            La clave que aparece en el código del sitio es pública por diseño: no da acceso a los
            datos de nadie sin esas reglas.
          </li>
          <li>Puedes borrar tu cuenta y todo tu progreso en cualquier momento, desde el juego.</li>
        </List>
        <p>
          Nunca te pediremos tu contraseña de GitHub o Google, un pago ni datos personales por
          correo o mensaje. Si alguien lo hace en nombre de Run It, no somos nosotros.
        </p>
      </Section>

      <Section title="Tu código corre aislado en tu navegador">
        <List>
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
        </List>
        <p>
          Lo que se ejecuta es el código que tú escribes. Si pegas código de otra persona, revísalo
          antes de enviarlo, como harías con cualquier programa.
        </p>
      </Section>

      <Section title="Cómo protegemos el sitio">
        <List>
          <li>
            <B>Conexión cifrada.</B> El sitio y el servicio de cuentas funcionan solo por HTTPS:
            nadie en la red del laboratorio puede ver ni modificar lo que envías o descargas.
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
            <B>Datos mínimos.</B> Solo guardamos un apodo y qué ejercicios resolviste. Los puntos
            del ranking los calcula el servidor con un catálogo fijo. Lo que no se guarda no se
            puede filtrar.
          </li>
          <li>
            <B>Código abierto.</B> Todo el código del sitio está en <Link href={REPO}>GitHub</Link>,
            y cada publicación sale de la rama principal por un proceso automático.
          </li>
        </List>
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
          reproducirla. No la publiques en un issue de GitHub ni la aproveches hasta que la hayamos
          corregido; te responderemos lo antes posible.
        </p>
      </Section>
    </article>
  );
}
