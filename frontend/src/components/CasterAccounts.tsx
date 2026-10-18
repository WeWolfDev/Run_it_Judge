import { useEffect, useState } from "react";

import { createCaster, deleteCaster, listCasters, type CasterAccount } from "@/lib/caster";

// Cuentas de caster en Accesos del panel: quien narra el torneo entra por /login
// con su nombre y este código, y ve /caster (enunciado, pista, envíos, votación).
// El código es más largo que el PIN de los participantes: el caster lee el
// código de todos los envíos.

export function CasterAccounts() {
  const [casters, setCasters] = useState<CasterAccount[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = () =>
    listCasters()
      .then(setCasters)
      .catch((error: Error) => setMessage(error.message));

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const created = await createCaster(name, code.trim() || undefined);
      setName("");
      setCode("");
      setMessage(`Caster ${created.username} creado. Entra en /login con su nombre y su código.`);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (caster: CasterAccount) => {
    if (!window.confirm(`¿Borrar la cuenta de ${caster.username}? Pierde el acceso en el acto.`))
      return;
    setMessage("");
    try {
      await deleteCaster(caster.id);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">Casters</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Cuentas de solo lectura para quien narra el torneo: ven el enunciado, la pista, los envíos
        con su código y la votación. El código de un envío aceptado se ve recién al cerrar la ronda.
      </p>

      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block flex-1 text-xs">
          <span className="text-muted-foreground">Nombre del caster</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="Ej.: caster"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </label>
        <label className="block flex-1 text-xs">
          <span className="text-muted-foreground">Código (opcional, 8 a 64 letras o dígitos)</span>
          <input
            id="caster-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={64}
            autoComplete="off"
            placeholder="Vacío: se genera uno"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
          />
        </label>
        <button
          type="submit"
          disabled={busy || name.trim().length < 3}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Creando…" : "Crear caster"}
        </button>
      </form>

      {casters.length > 0 ? (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Nombre</th>
              <th className="py-2 pr-3 font-medium">Código</th>
              <th className="py-2 pr-3 font-medium">Creado</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {casters.map((caster) => (
              <tr key={caster.id} className="border-t border-border">
                <td className="py-2 pr-3 text-foreground">{caster.username}</td>
                <td className="py-2 pr-3 font-mono text-foreground">{caster.access_code}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {new Date(caster.created_at).toLocaleString()}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void remove(caster)}
                    className="text-xs text-danger hover:underline"
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">Todavía no hay casters.</p>
      )}

      {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
