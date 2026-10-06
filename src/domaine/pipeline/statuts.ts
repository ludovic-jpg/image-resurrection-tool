/**
 * Pipeline « Mes dossiers » — section 8 du cahier des charges.
 * Sept étapes macro (A à G), treize sous-statuts. L'ordre des tableaux est l'ordre d'affichage,
 * de gauche à droite (F-CRM-01).
 */

export const ETAPES = [
  { cle: "A", titre: "Création du dossier Formation" },
  { cle: "B", titre: "Demande de financement" },
  { cle: "C", titre: "Début de la Formation" },
  { cle: "D", titre: "Fin de la Formation" },
  { cle: "E", titre: "Demande de paiement" },
  { cle: "F", titre: "Paiement réceptionné" },
  { cle: "G", titre: "Formateur payé / Dossier archivé" },
] as const;

export type CleEtape = (typeof ETAPES)[number]["cle"];

export const SOUS_STATUTS = [
  { cle: "brouillon", etape: "A", libelle: "Brouillon" },
  { cle: "en_cours_validation", etape: "A", libelle: "En cours de validation" },
  { cle: "dossier_valide", etape: "B", libelle: "Dossier validé" },
  { cle: "dossier_depose", etape: "B", libelle: "Dossier Formation déposé" },
  { cle: "accord_financement", etape: "B", libelle: "Accord de financement" },
  { cle: "refus_financement", etape: "B", libelle: "Refus de financement" },
  { cle: "envoi_elements_pedagogiques", etape: "B", libelle: "AF — Envoi des éléments pédagogiques à l'apprenant" },
  { cle: "formation_debutee", etape: "C", libelle: "Formation en cours" },
  { cle: "fin_dossier_incomplet", etape: "D", libelle: "Dossier incomplet" },
  { cle: "fin_dossier_complet", etape: "D", libelle: "Dossier complet" },
  { cle: "demande_paiement", etape: "E", libelle: "Demande de paiement" },
  { cle: "paiement_receptionne", etape: "F", libelle: "Paiement réceptionné" },
  { cle: "archive", etape: "G", libelle: "Formateur payé / Dossier archivé" },
] as const satisfies ReadonlyArray<{ cle: string; etape: CleEtape; libelle: string }>;

export type SousStatut = (typeof SOUS_STATUTS)[number]["cle"];

const RANG = new Map<SousStatut, number>(SOUS_STATUTS.map((s, i) => [s.cle, i]));

export function libelleSousStatut(s: SousStatut): string {
  return SOUS_STATUTS.find((x) => x.cle === s)!.libelle;
}

export function etapeDe(s: SousStatut): CleEtape {
  return SOUS_STATUTS.find((x) => x.cle === s)!.etape;
}

/**
 * Le dossier a-t-il atteint (ou dépassé) un sous-statut donné ?
 * Un dossier refusé en financement n'« atteint » jamais rien au-delà du refus (RG-07).
 */
export function aAtteint(courant: SousStatut, seuil: SousStatut): boolean {
  if (courant === "refus_financement") return seuil === "refus_financement" || RANG.get(seuil)! < RANG.get("accord_financement")!;
  if (seuil === "refus_financement") return false;
  return RANG.get(courant)! >= RANG.get(seuil)!;
}

/** Statuts terminaux : plus aucune transition, dossier en lecture seule (RG-07, étape G). */
export function estTerminal(s: SousStatut): boolean {
  return s === "refus_financement" || s === "archive";
}
