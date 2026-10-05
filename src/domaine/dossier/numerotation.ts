/** Numérotation continue par organisme et par année : `ADF-2026-0001`, `FA-2026-0001`, `FF-2026-0001`. */
export type PrefixeNumero = "ADF" | "FA" | "FF";

/** Clé du compteur (colonne `compteur.cle`) : un compteur par préfixe et par année. */
export const cleCompteur = (prefixe: PrefixeNumero, annee: number): string => `${prefixe}-${annee}`;

export function formaterNumero(prefixe: PrefixeNumero, annee: number, valeur: number): string {
  return `${cleCompteur(prefixe, annee)}-${String(valeur).padStart(4, "0")}`;
}
