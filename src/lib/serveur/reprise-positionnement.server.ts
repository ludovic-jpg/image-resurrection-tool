/**
 * Reprise des positionnements signés dans un dossier (RG-02 : recueil et positionnement joints au dossier).
 *
 * À appeler à la création d'un dossier (lot 4, `dossiers` `creer`) : pour chaque stagiaire inscrit qui a déjà signé son
 * positionnement sur CE parcours, ses réponses sont reprises — le recueil (hors questions ajoutées par le formateur)
 * toujours, le test SEULEMENT si le questionnaire du dossier est exactement celui auquel il a répondu. Sinon rien du
 * test n'est repris : on ne fait jamais correspondre des réponses à un autre questionnaire.
 *
 * Ce module DÉCIDE (règle pure `planReprise`) et journalise ; il n'ÉCRIT PAS les évaluations ni ne valide les pièces
 * 00-AVT / 01-AVT : cette écriture appartient à la logique des pièces (lot 5, `enregistrerReponses`) et est fournie
 * par l'appelant (`appliquer`). Reprise « au mieux » : un écart (pièce déjà validée, étape non ouverte) laisse la saisie
 * au formateur et n'interrompt pas la création du dossier.
 */
import {
  planReprise,
  type ElementReprise,
  type PositionnementSigne,
} from "@/domaine/positionnement/regles";
import type { Acteur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { leverSiErreurBd } from "./erreurs.server";
import { journaliser } from "./journal.server";

export interface DossierPourReprise {
  id: string;
  of_id: string;
  formation_id: string | null;
  /** Le questionnaire de positionnement figé dans le dossier (colonne `questionnaire_positionnement`). */
  questionnaire_positionnement: unknown;
}

export interface OptionsReprise {
  acteur: Acteur;
  dossier: DossierPourReprise;
  /** Stagiaires inscrits au dossier. */
  stagiaire_ids: readonly string[];
  /** Écrit le recueil (et le test si `reprendre_test`) dans le dossier au nom de l'apprenant. Lève en cas d'écart. */
  appliquer: (element: ElementReprise) => Promise<void>;
}

/** Renvoie le nombre de stagiaires dont le positionnement a été repris. */
export async function reprendrePositionnements(
  bd: BdService,
  options: OptionsReprise,
): Promise<number> {
  const { acteur, dossier } = options;
  // Comme avant : seul le formateur qui crée le dossier déclenche la reprise.
  if (!dossier.formation_id || acteur.role !== "formateur" || options.stagiaire_ids.length === 0)
    return 0;
  const { data, error } = await bd
    .from("positionnement")
    .select("id, stagiaire_id, questionnaire, recueil, reponses, score, signe_le")
    .eq("of_id", dossier.of_id)
    .eq("formation_id", dossier.formation_id)
    .eq("statut", "complet")
    .in("stagiaire_id", [...options.stagiaire_ids])
    .order("signe_le", { ascending: false });
  leverSiErreurBd(error, "lecture des positionnements signés");
  const plan = planReprise(
    (data ?? []) as PositionnementSigne[],
    options.stagiaire_ids,
    dossier.questionnaire_positionnement,
  );
  let repris = 0;
  for (const element of plan) {
    try {
      await options.appliquer(element);
    } catch (e) {
      console.warn("[reprise-positionnement] reprise ignorée", element.stagiaire_id, e);
      continue;
    }
    repris++;
    await journaliser(bd, {
      of_id: dossier.of_id,
      dossier_id: dossier.id,
      acteur,
      type: "positionnement_repris",
      libelle: "Positionnement signé repris dans le dossier",
      detail: {
        positionnement_id: element.positionnement_id,
        stagiaire_id: element.stagiaire_id,
        test_repris: element.reprendre_test,
      },
    });
  }
  return repris;
}
