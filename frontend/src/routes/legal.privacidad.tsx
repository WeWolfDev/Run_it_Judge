import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/privacidad")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Aviso de privacidad | Run It" },
      {
        name: "description",
        content: "Cómo trata Run It los datos personales de quienes participan.",
      },
    ],
  }),
});

// Aviso de privacidad integral (Ley Federal de Protección de Datos Personales en
// Posesión de los Particulares). Describe lo que el sistema guarda de verdad:
// al cambiar qué datos se recaban o cuánto se conservan, actualizar este texto
// y la fecha. Los datos de contacto y domicilio del responsable están
// pendientes: se marcan a la vista hasta completarlos.
const UPDATED = "5 de octubre de 2026";
const CONTACT_EMAIL: string | null = null;
const ADDRESS: string | null = null;

function Pending({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-danger-soft px-1 text-danger" title="Dato pendiente de completar">
      {children}
    </mark>
  );
}

const contact = CONTACT_EMAIL ? (
  <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
    {CONTACT_EMAIL}
  </a>
) : (
  <Pending>[correo de contacto]</Pending>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <article>
      <h1 className="text-2xl font-semibold">Aviso de privacidad</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última actualización: {UPDATED}</p>

      <Section title="1. Responsable">
        <p>
          <b className="text-foreground">WeWolf</b>, organizador de Run It, con domicilio en{" "}
          {ADDRESS ?? <Pending>[domicilio]</Pending>}, es responsable del tratamiento de tus datos
          personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los
          Particulares. Para cualquier asunto sobre tus datos puedes escribir a {contact}.
        </p>
      </Section>

      <Section title="2. Datos que recabamos">
        <p>Run It no pide correo, teléfono ni documentos de identidad. Solo trata:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b className="text-foreground">Nombre de usuario</b> que eliges al registrarte. Puede
            ser un apodo.
          </li>
          <li>
            <b className="text-foreground">Código de acceso</b> que te entregó el organizador, para
            iniciar sesión.
          </li>
          <li>
            <b className="text-foreground">Personaje</b> que eliges para la pista.
          </li>
          <li>
            <b className="text-foreground">Código fuente que envías</b>, con su lenguaje, fecha y
            hora, y el resultado de las pruebas (tests pasados, tiempo de ejecución).
          </li>
          <li>
            <b className="text-foreground">Resultados del torneo</b>: puesto, penalizaciones, si
            clasificaste y los premios de la ceremonia.
          </li>
          <li>
            <b className="text-foreground">Dirección IP</b>, que el servidor usa para limitar los
            intentos fallidos de inicio de sesión y que queda en sus registros técnicos.
          </li>
        </ul>
        <p>No tratamos datos personales sensibles.</p>
      </Section>

      <Section title="3. Para qué los usamos">
        <p>Finalidades necesarias para el torneo:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Darte acceso, inscribirte en las rondas y evaluar tus envíos.</li>
          <li>
            Calcular el ranking, quién clasifica y los premios, y mostrarlos en las pantallas del
            evento.
          </li>
          <li>Mantener la seguridad del sistema y evitar accesos indebidos.</li>
        </ul>
        <p>
          <b className="text-foreground">Lo que se ve en público.</b> Durante el evento, tu nombre
          de usuario, tu personaje y tu avance (puesto, tests resueltos, si clasificaste) se
          muestran en la pista proyectada (/pista), en la vista del público (/publico) y en la
          ceremonia de premios, que cualquier persona con el enlace puede abrir. Tu código fuente
          nunca se muestra en público. Si no quieres aparecer con tu nombre real, usa un apodo.
        </p>
        <p>No usamos tus datos para publicidad ni para fines distintos de los descritos aquí.</p>
      </Section>

      <Section title="4. Con quién se comparten">
        <p>
          No vendemos ni transferimos tus datos a terceros. El sitio y la evaluación del código
          corren en un servidor propio del organizador: tu código no se envía a servicios externos.
        </p>
        <p>
          Para funcionar, tu navegador se conecta a dos servicios externos que reciben tu dirección
          IP como cualquier sitio web: <b className="text-foreground">Google Fonts</b>, que entrega
          las tipografías, y <b className="text-foreground">Tailscale</b>, la red que publica el
          sitio en internet. Ninguno recibe tu nombre de usuario ni tu código.
        </p>
      </Section>

      <Section title="5. Cuánto tiempo los conservamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Tu sesión dura un máximo de 8 horas o hasta que cierres sesión.</li>
          <li>
            Tus datos del torneo se conservan mientras el torneo exista en el historial del
            organizador, que puede eliminarlo.
          </li>
          <li>Las copias de seguridad del servidor se borran a los 14 días.</li>
        </ul>
      </Section>

      <Section title="6. Almacenamiento en tu navegador">
        <p>
          Run It no usa cookies de rastreo ni de publicidad. Guarda en el almacenamiento local de tu
          navegador solo lo necesario para funcionar: tu sesión, el personaje elegido, la paleta de
          colores, la preferencia de sonido y qué vista del público viste por última vez. Puedes
          borrarlo desde la configuración de tu navegador; al hacerlo se cierra tu sesión.
        </p>
      </Section>

      <Section title="7. Tus derechos (ARCO)">
        <p>
          Puedes pedir <b className="text-foreground">acceso</b> a tus datos,{" "}
          <b className="text-foreground">rectificarlos</b>,{" "}
          <b className="text-foreground">cancelarlos</b> u{" "}
          <b className="text-foreground">oponerte</b> a su tratamiento, y revocar tu consentimiento,
          escribiendo a {contact}. Indica tu nombre de usuario, el torneo y lo que solicitas.
          Responderemos en un plazo máximo de 20 días hábiles.
        </p>
        <p>
          Si cancelas tus datos mientras un torneo está en curso, ya no podrás seguir participando
          en él.
        </p>
      </Section>

      <Section title="8. Cambios a este aviso">
        <p>
          Si cambiamos este aviso, publicaremos la nueva versión en esta página con su fecha de
          actualización.
        </p>
      </Section>

      <Section title="9. Consentimiento">
        <p>
          Al registrarte y aceptar este aviso, consientes el tratamiento de tus datos para las
          finalidades descritas.
        </p>
      </Section>
    </article>
  );
}
