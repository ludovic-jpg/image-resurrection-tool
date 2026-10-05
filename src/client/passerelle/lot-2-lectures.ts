/**
 * Lot 2 — lectures partagées entre plusieurs gestionnaires (formation visible, coffre d'une formation, identité de
 * l'organisme pour les documents). Aucune route n'est enregistrée ici.
 */
import type { FichierCoffre, Formation } from "../api";
import { bd } from "../bd";
import { exigerFormateurValide, exiger, interdit, lire, type Acteur } from "./lot-2-commun";
import type { IdentiteDocument } from "@/domaine/pedagogie/documents";

/**
 * Lecture d'une formation ouverte au formateur propriétaire ET à l'organisme (coffre-fort, parcours) — jamais à un
 * autre formateur ni à l'apprenant. L'organisme comme le propriétaire sont départagés par la RLS de `formation`.
 */
export function exigerFormateurOuAdmin(acteur: Acteur): void {
  if (acteur.role === "admin") return;
  if (acteur.role === "formateur") {
    exigerFormateurValide(acteur);
    return;
  }
  throw interdit();
}

export async function lireFormation(id: string): Promise<Formation> {
  return exiger(
    await bd.from("formation").select("*").eq("id", id).maybeSingle(),
    "Formation",
  ) as Formation;
}

/** La formation est-elle visible de l'appelant ? (404 « Formation introuvable » sinon.) */
export async function exigerFormationVisible(id: string): Promise<void> {
  exiger(await bd.from("formation").select("id").eq("id", id).maybeSingle(), "Formation");
}

/** Fichiers du coffre d'une formation : actifs, ou — avec `corbeille` — ceux mis à la corbeille. */
export async function listerCoffre(
  formationId: string,
  options: { corbeille?: boolean } = {},
): Promise<FichierCoffre[]> {
  const requete = bd.from("coffre_fichier").select("*").eq("formation_id", formationId);
  const filtree = options.corbeille
    ? requete.not("supprime_le", "is", null)
    : requete.is("supprime_le", null);
  return (lire(await filtree.order("cree_le", { ascending: true })) ?? []) as FichierCoffre[];
}

/** Nom et couleur de l'organisme, lus dans la vue `organisme_public` (ni IBAN, ni commission, ni signature). */
export async function identiteOrganisme(): Promise<IdentiteDocument> {
  const of = exiger(
    await bd.from("organisme_public").select("of_nom, couleur").maybeSingle(),
    "Organisme",
  ) as { of_nom: string; couleur: string };
  return { nom: of.of_nom || "Organisme de formation", couleur: of.couleur };
}
