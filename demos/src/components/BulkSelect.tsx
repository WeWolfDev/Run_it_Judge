import { useEffect, useRef } from "react";

/**
 * Casilla maestra de una lista con selección múltiple. Marca todas las filas
 * seleccionables o las desmarca; queda indeterminada con una parte marcada. Las
 * filas que no se pueden borrar no entran en selectableIds: no tienen casilla.
 * El estado de la selección lo tiene quien la usa, no este componente.
 */
export function SelectAllCheckbox({
  selectableIds,
  selected,
  onChange,
  disabled,
  label,
}: {
  selectableIds: string[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const count = selectableIds.filter((id) => selected.has(id)).length;
  const all = selectableIds.length > 0 && count === selectableIds.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={all}
      disabled={disabled || selectableIds.length === 0}
      onChange={() => onChange(all ? new Set() : new Set(selectableIds))}
      className="h-4 w-4 accent-primary disabled:opacity-50"
    />
  );
}

/** Casilla de una fila. */
export function RowCheckbox({
  id,
  selected,
  onChange,
  disabled,
  label,
}: {
  id: string;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={selected.has(id)}
      disabled={disabled}
      onChange={(event) => {
        const next = new Set(selected);
        if (event.target.checked) next.add(id);
        else next.delete(id);
        onChange(next);
      }}
      className="h-4 w-4 accent-primary disabled:opacity-50"
    />
  );
}
