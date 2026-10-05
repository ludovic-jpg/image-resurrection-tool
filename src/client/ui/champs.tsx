/**
 * Champs à menu déroulant (« Modification 1 » : « quand tu peux, fais des entrées à menu déroulant »).
 * `ListeOuAutre` : une liste fermée, plus « Autre… » qui ouvre un champ libre — la liste guide sans enfermer.
 * `ChoixMultiples` : des pastilles à cocher (domaines d'intervention…).
 */
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { cx, Selecteur } from "./base";

const AUTRE = "__autre__";

export function ListeOuAutre({
  libelle,
  options,
  value,
  onChange,
  aide,
  erreur,
  vide = "— Choisir —",
  autre = true,
  disabled,
}: {
  libelle: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  aide?: string;
  erreur?: string;
  vide?: string;
  autre?: boolean;
  disabled?: boolean;
}) {
  const horsListe = value !== "" && !options.includes(value);
  const [libre, setLibre] = useState(horsListe);
  const idLibre = useId();
  return (
    <div className="min-w-0 space-y-2">
      <Selecteur
        libelle={libelle}
        aide={libre ? undefined : aide}
        erreur={libre ? undefined : erreur}
        disabled={disabled}
        value={libre ? AUTRE : value}
        onChange={(e) => {
          if (e.target.value === AUTRE) {
            setLibre(true);
            onChange("");
          } else {
            setLibre(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{vide}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {autre && <option value={AUTRE}>Autre… (saisir)</option>}
      </Selecteur>
      {libre && (
        <div>
          <label htmlFor={idLibre} className="sr-only">
            {libelle} — précisez
          </label>
          <input
            id={idLibre}
            autoFocus
            disabled={disabled}
            value={value}
            placeholder="Précisez…"
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-full rounded-sm border border-trait-fort bg-carte px-3 text-sm focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
          />
          {(erreur || aide) && (
            <p className={cx("mt-1.5 text-[13px]", erreur ? "text-danger" : "text-encre-3")}>
              {erreur ?? aide}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ChoixMultiples({
  libelle,
  options,
  valeurs,
  onChange,
  aide,
  max = 20,
}: {
  libelle: string;
  options: readonly string[];
  valeurs: string[];
  onChange: (v: string[]) => void;
  aide?: string;
  max?: number;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 block text-[13px] font-medium text-encre-2">{libelle}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const actif = valeurs.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={actif}
              disabled={!actif && valeurs.length >= max}
              onClick={() => onChange(actif ? valeurs.filter((x) => x !== o) : [...valeurs, o])}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors duration-150 disabled:opacity-40",
                actif
                  ? "border-accent bg-accent-doux font-medium text-accent-fort"
                  : "border-trait-fort bg-carte text-encre-2 hover:border-accent",
              )}
            >
              {actif && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
              {o}
            </button>
          );
        })}
      </div>
      {aide && <p className="mt-1.5 text-[13px] text-encre-3">{aide}</p>}
    </fieldset>
  );
}

/** Convertit une saisie française (« 3,5 ») en nombre, ou `null` si vide. */
export const nombreSaisi = (x: string | number | null | undefined): number | null => {
  const t = String(x ?? "")
    .trim()
    .replace(",", ".")
    .replace(/\s/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Euros saisis → centimes (entier), ou `null`. */
export const centimesSaisis = (x: string): number | null => {
  const n = nombreSaisi(x);
  return n === null ? null : Math.round(n * 100);
};

export const eurosEnSaisie = (c: number | null | undefined): string =>
  c === null || c === undefined ? "" : String(c / 100).replace(".", ",");
