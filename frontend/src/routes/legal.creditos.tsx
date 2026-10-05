import { createFileRoute } from "@tanstack/react-router";

import { CREDIT_SECTIONS } from "@/lib/credits";
import THIRD_PARTY from "@/lib/third-party.json";

export const Route = createFileRoute("/legal/creditos")({
  component: CreditsPage,
  head: () => ({
    meta: [
      { title: "Créditos y licencias | Run It" },
      {
        name: "description",
        content:
          "Autores y licencias de los recursos y del software de código abierto que usa Run It.",
      },
    ],
  }),
});

type Package = { name: string; version: string; license: string; url: string | null };

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC_TEXT = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

function CreditsPage() {
  return (
    <article className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Créditos y licencias</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Run It se construye con el trabajo de otros autores. Esta página reúne los recursos
          gráficos, las fuentes y el software de código abierto que usa, con su licencia.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold">Recursos gráficos, sonido y fuentes</h2>
        {CREDIT_SECTIONS.map((section) => (
          <div key={section.title} className="mt-5">
            <h3 className="text-sm font-semibold text-primary">{section.title}</h3>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {section.items.map((item) => (
                <li key={item.what} className="px-4 py-3 text-sm">
                  <p className="text-foreground">{item.what}</p>
                  <p className="text-muted-foreground">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {item.author}
                      </a>
                    ) : (
                      item.author
                    )}{" "}
                    · {item.license}
                  </p>
                  {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Software de código abierto</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Bibliotecas que usa la aplicación web y el servidor. Todas tienen licencias permisivas; su
          texto está al final de la página.
        </p>
        <PackageTable title="Aplicación web" packages={THIRD_PARTY.frontend} />
        <PackageTable title="Servidor" packages={THIRD_PARTY.backend} />
        <p className="mt-3 text-xs text-muted-foreground">
          La ejecución de código usa Judge0 (GPL-3.0) como un servicio aparte en el servidor: no se
          distribuye ni forma parte de esta aplicación. jszip se ofrece como MIT o GPL-3.0; Run It
          lo usa bajo MIT.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Textos de licencia</h2>
        <LicenseText title="Licencia MIT" text={MIT_TEXT}>
          Se aplica a las bibliotecas marcadas como MIT, a Pixelarticons, ZzFX y KaTeX. El aviso de
          copyright de cada autor está en su repositorio.
        </LicenseText>
        <LicenseText title="Licencia ISC" text={ISC_TEXT}>
          Se aplica a las bibliotecas marcadas como ISC.
        </LicenseText>
        <div className="mt-4 rounded-lg border border-border p-4 text-sm">
          <p className="font-semibold">Apache License 2.0 y SIL Open Font License 1.1</p>
          <p className="mt-1 text-muted-foreground">
            El texto completo está en{" "}
            <a
              href="https://www.apache.org/licenses/LICENSE-2.0"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              apache.org/licenses/LICENSE-2.0
            </a>{" "}
            y en{" "}
            <a
              href="https://openfontlicense.org"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              openfontlicense.org
            </a>
            . Los recursos CC0 (Kenney, ansimuz) son de dominio público y no requieren crédito: se
            nombran por cortesía.
          </p>
        </div>
      </section>
    </article>
  );
}

function PackageTable({ title, packages }: { title: string; packages: Package[] }) {
  return (
    <details className="mt-4 rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
        {title} · {packages.length} bibliotecas
      </summary>
      <table className="w-full text-left text-sm">
        <thead className="border-y border-border text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Biblioteca</th>
            <th className="px-4 py-2 font-medium">Versión</th>
            <th className="px-4 py-2 font-medium">Licencia</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {packages.map((pkg) => (
            <tr key={pkg.name}>
              <td className="px-4 py-2">
                {pkg.url ? (
                  <a href={pkg.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {pkg.name}
                  </a>
                ) : (
                  pkg.name
                )}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{pkg.version}</td>
              <td className="px-4 py-2 text-muted-foreground">{pkg.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function LicenseText({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <details className="mt-4 rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm">
        <span className="font-semibold">{title}</span>
        <span className="ml-2 text-muted-foreground">{children}</span>
      </summary>
      <pre className="whitespace-pre-wrap border-t border-border px-4 py-3 font-mono text-xs text-muted-foreground">
        {text}
      </pre>
    </details>
  );
}
