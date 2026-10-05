/**
 * POINT DE BRANCHEMENT avec le pipeline (lot 4) — réactions du pipeline à la validation d'une pièce.
 *
 * Le lot 5 ne réécrit PAS le pipeline. Quand une pièce passe à « Validé », l'ancien service appelait
 * `executerAction(s, "systeme", dossierId, action)` de `services/pipeline.ts` :
 *   • `enregistrer_accord`   — dépôt de l'Accord de financement (RG-06) : le dossier avance et l'ODM est émis ;
 *   • `reevaluer_completude` — étape D : « incomplet » ↔ « complet » selon les pièces requises.
 *
 * Ces deux actions sont l'affaire de la fonction `pipeline-transiter` du lot 4. Tant qu'elle n'est pas branchée ici,
 * la réaction n'est PAS exécutée : elle est consignée au journal du dossier (type `reaction_pipeline_en_attente`) et
 * dans les traces du serveur, pour qu'on la voie. Le retour de la pièce, lui, est bien enregistré.
 *
 * À l'intégration, remplacer le corps de `reagirAuPipeline` par l'appel au module du lot 4 (une seule ligne) ;
 * le test `pieces-pipeline.test.ts` décrit le contrat.
 */
import type { ActionSysteme } from "@/domaine/pieces/retours";
import type { BdService } from "./bd.server";
import { journaliser } from "./journal.server";

export type { ActionSysteme };

export interface DossierCible {
  id: string;
  of_id: string;
}

export async function reagirAuPipeline(
  bd: BdService,
  dossier: DossierCible,
  action: ActionSysteme,
): Promise<{ declenchee: boolean }> {
  console.warn(
    `[pieces] réaction du pipeline « ${action} » non branchée (lot 4) pour le dossier ${dossier.id}`,
  );
  await journaliser(bd, {
    of_id: dossier.of_id,
    dossier_id: dossier.id,
    acteur: "systeme",
    type: "reaction_pipeline_en_attente",
    libelle: `Réaction du pipeline à exécuter : ${action}`,
    detail: { action },
  });
  return { declenchee: false };
}
