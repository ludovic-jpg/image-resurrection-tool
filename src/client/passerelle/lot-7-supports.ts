/**
 * Lot 7 — supports de cours PPTX (routes 64 et 65 de la carte, section 1.9).
 *
 *  64  POST /supports        fonction serveur `produireSupport` : PPTX d'UN module à partir du plan validé par le
 *                            formateur, rangé dans son coffre-fort (origine « générée »), journalisé.
 *  65  POST /supports/tous   PAS de fonction serveur : ce gestionnaire (navigateur) boucle module par module — plan
 *                            (route 63) puis support (route 64) — pour qu'aucun appel ne dépasse la durée maximale
 *                            d'une fonction serveur. Même forme de réponse que le service Node :
 *                            `{ produits, echecs }`, un module en échec n'empêchant pas les autres.
 */
import { proposerPlanSupport } from "@/lib/pedagogie-ia.functions";
import { produireSupport } from "@/lib/supports.functions";
import { appelerServeur, corpsDe } from "../appel-serveur";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import {
  assurerDossierEnjeux,
  exigerFormateurValideClient,
  lireFormationVisible,
} from "./lot-7-commun";

// 64
route("POST", "/supports", ({ corps }) =>
  appelerServeur(() => produireSupport({ data: corpsDe(corps) })),
);

// 65
route("POST", "/supports/tous", async ({ corps }) => {
  const formationId = String(corpsDe(corps)["formation_id"] ?? "");
  await exigerFormateurValideClient();
  const formation = await lireFormationVisible(formationId);
  // Comme le service Node : une formation sans parcours en modules est traitée comme un module unique.
  const modules = Array.isArray(formation.formation_modules) ? formation.formation_modules : [];
  const nombre = Math.max(modules.length, 1);
  // Le dossier d'enjeux est constitué UNE fois, avant la boucle (sinon chaque module referait la recherche web).
  await assurerDossierEnjeux(formation);

  const produits: Array<{ id: string; nom: string; diapositives: number }> = [];
  const echecs: string[] = [];
  for (let i = 0; i < nombre; i++) {
    try {
      const plan = await appelerServeur(() =>
        proposerPlanSupport({ data: { formation_id: formation.id, module_index: i } }),
      );
      produits.push(
        await appelerServeur(() =>
          produireSupport({
            data: { formation_id: formation.id, module_index: i, diapos: plan.diapos },
          }),
        ),
      );
    } catch (e) {
      // Session expirée : inutile de continuer, tous les modules suivants échoueraient de la même façon.
      if (e instanceof ErreurApi && e.statut === 401) throw e;
      echecs.push(`Module ${i + 1} : ${e instanceof Error ? e.message : "échec"}`);
    }
  }
  return { produits, echecs };
});
