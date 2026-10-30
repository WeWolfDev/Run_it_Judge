import type { ReactNode } from "react";

import { CONTACT_EMAIL } from "@/lib/legal";

/** Un dato que falta completar, marcado a la vista. */
export function Pending({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-danger-soft px-1 text-danger" title="Dato pendiente de completar">
      {children}
    </mark>
  );
}

export function Contact() {
  return CONTACT_EMAIL ? (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
      {CONTACT_EMAIL}
    </a>
  ) : (
    <Pending>[correo de contacto]</Pending>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}
