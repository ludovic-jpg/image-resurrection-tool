/**
 * Ce qui doit être renseigné avant de demander la validation d'un dossier — complète la garde RG-02 du noyau
 * (`REGLES.soumettre_validation`). Reprise de `manquesAvantSoumission` de `src/serveur/services/pipeline.ts`,
 * version pure : les lectures (entreprise, planning) se font ailleurs.
 */
export interface DossierASoumettre {
  formation_titre: string;
  formation_objectifs: string;
  formation_programme: string;
  formation_date_debut: string;
  formation_date_fin: string;
  formation_duree_heures_total: number | null;
  formation_prix_unitaire_ht: number | null;
  formation_modalite: string;
  formation_lieu_adresse: string;
  formation_lien_visio: string;
  signature_lieu: string;
}

export interface EntrepriseASoumettre {
  entreprise_siret?: string | null;
  entreprise_representant_nom?: string | null;
  entreprise_representant_email?: string | null;
}

export function manquesAvantSoumission(
  d: DossierASoumettre,
  entreprise: EntrepriseASoumettre | null | undefined,
  nombreSeances: number,
): string[] {
  const manques: string[] = [];
  if (!d.formation_titre) manques.push("Intitulé de la formation");
  if (!d.formation_objectifs) manques.push("Objectifs de la formation");
  // La convention renvoie au « programme détaillé en annexe » : sans lui, la pièce PRG serait vide.
  if (!d.formation_programme)
    manques.push("Programme détaillé de la formation (annexe de la convention)");
  if (!d.formation_date_debut || !d.formation_date_fin) manques.push("Dates de début et de fin");
  else if (d.formation_date_fin < d.formation_date_debut)
    manques.push("La date de fin précède la date de début");
  if (!d.formation_duree_heures_total) manques.push("Durée totale en heures");
  if (d.formation_prix_unitaire_ht === null) manques.push("Prix unitaire HT");
  if (nombreSeances === 0) manques.push("Au moins une séance au planning");
  if (d.formation_modalite !== "distanciel" && !d.formation_lieu_adresse)
    manques.push("Adresse du lieu de formation");
  if (d.formation_modalite !== "presentiel" && !d.formation_lien_visio)
    manques.push("Lien de connexion à distance");
  if (!d.signature_lieu) manques.push("Lieu de signature de la convention");
  if (!entreprise?.entreprise_siret) manques.push("SIRET de l'entreprise");
  if (!entreprise?.entreprise_representant_nom) manques.push("Nom du représentant de l'entreprise");
  // Sans cette adresse, l'e-mail automatique à l'entreprise (F-DOS-06) ne peut pas partir.
  if (!entreprise?.entreprise_representant_email)
    manques.push("E-mail du représentant de l'entreprise");
  return manques;
}
