/** Bandeau « Un brouillon non enregistré a été retrouvé » — voir `brouillon.ts`. */
import { History } from "lucide-react";
import { instantFr } from "../api";
import { Bouton } from "./base";

export function BandeauBrouillon({
  le,
  reprendre,
  ignorer,
}: {
  le: string;
  reprendre: () => void;
  ignorer: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-attente/60 bg-attente-doux px-4 py-3 text-sm text-attente-encre"
    >
      <span className="flex items-center gap-2">
        <History className="size-4 shrink-0" aria-hidden />
        Un brouillon non enregistré du {instantFr(le)} a été retrouvé dans ce navigateur.
      </span>
      <span className="flex gap-2">
        <Bouton taille="sm" variante="primaire" onClick={reprendre}>
          Reprendre le brouillon
        </Bouton>
        <Bouton taille="sm" variante="discret" onClick={ignorer}>
          Ignorer
        </Bouton>
      </span>
    </div>
  );
}
