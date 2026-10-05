/**
 * Lot 2 — outils pédagogiques : modèles de recueil, de positionnement et d'évaluation des acquis (routes 66 à 70).
 *
 * Lecture et écriture directes sous RLS (le formateur propriétaire). L'historique (`version_objet`) est tenu par le
 * déclencheur `s4m_version` à chaque modification, le journal (`outil_cree`, `outil_archive`) par `s4m_journal` ;
 * ce module n'écrit dans aucune des deux tables. « Supprimer » archive : rien n'est détruit.
 */
import { validerQuestionnaire, type Questionnaire } from "@/domaine/formulaires/qcm";
import type { Outil } from "../api";
import { bd } from "../bd";
import { route } from "../registre";
import {
  acteurCourant,
  corpsObjet,
  exiger,
  exigerFormateurValide,
  invalide,
  lire,
  maintenant,
  valider,
} from "./lot-2-commun";
import { exigerFormationVisible } from "./lot-2-lectures";
import { SchemaOutil, SchemaQuestionnaire, SchemaRecueil } from "./lot-2-schemas";

/** Le recueil a des questions fixes (matrice de l'organisme) ; le formateur peut en ajouter. */
function validerContenuOutil(
  type: "recueil" | "positionnement" | "acquis",
  contenu: unknown,
): unknown {
  if (type === "recueil") return valider(() => SchemaRecueil.parse(contenu ?? {}));
  const q = valider(() => SchemaQuestionnaire.parse(contenu)) as Questionnaire;
  const erreurs = validerQuestionnaire(q);
  if (erreurs.length > 0) throw invalide("Le questionnaire est incomplet.", { erreurs });
  return q;
}

// 66 — GET /outils[?archives=1]
route("GET", "/outils", async ({ requete }) => {
  exigerFormateurValide(await acteurCourant());
  const requeteOutils = bd.from("modele_outil").select("*");
  const filtree =
    requete.get("archives") === "1"
      ? requeteOutils.not("archive_le", "is", null)
      : requeteOutils.is("archive_le", null);
  return (lire(await filtree.order("cree_le", { ascending: false })) ?? []) as Outil[];
});

// 67 — POST /outils/:id/restaurer : sort un outil des archives
route("POST", "/outils/:id/restaurer", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  const restaure = await bd
    .from("modele_outil")
    .update({ archive_le: null })
    .eq("id", params["id"] ?? "")
    .select()
    .maybeSingle();
  return exiger(restaure, "Outil pédagogique") as Outil;
});

// 68 — POST /outils
route("POST", "/outils", async ({ corps }) => {
  const donnees = corpsObjet(corps);
  const acteur = await acteurCourant();
  const formateurId = exigerFormateurValide(acteur);
  const valeurs = valider(() => SchemaOutil.parse(donnees));
  if (valeurs.formation_id) await exigerFormationVisible(valeurs.formation_id);
  const contenu = validerContenuOutil(valeurs.type, valeurs.contenu);
  const cree = await bd
    .from("modele_outil")
    .insert({
      of_id: acteur.of_id,
      formateur_id: formateurId,
      type: valeurs.type,
      titre: valeurs.titre,
      formation_id: valeurs.formation_id,
      contenu,
    })
    .select()
    .single();
  return exiger(cree, "Outil pédagogique") as Outil;
});

// 69 — PUT /outils/:id (la version précédente est gardée par le déclencheur `s4m_version`)
route("PUT", "/outils/:id", async ({ params, corps }) => {
  const donnees = corpsObjet(corps);
  exigerFormateurValide(await acteurCourant());
  const valeurs = valider(() => SchemaOutil.parse(donnees));
  if (valeurs.formation_id) await exigerFormationVisible(valeurs.formation_id);
  const contenu = validerContenuOutil(valeurs.type, valeurs.contenu);
  const modifie = await bd
    .from("modele_outil")
    .update({ titre: valeurs.titre, formation_id: valeurs.formation_id, contenu })
    .eq("id", params["id"] ?? "")
    .is("archive_le", null)
    .select()
    .maybeSingle();
  return exiger(modifie, "Outil pédagogique") as Outil;
});

// 70 — DELETE /outils/:id : archive l'outil (les dossiers déjà créés gardent leur copie)
route("DELETE", "/outils/:id", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  const archive = await bd
    .from("modele_outil")
    .update({ archive_le: maintenant() })
    .eq("id", params["id"] ?? "")
    .is("archive_le", null)
    .select("id")
    .maybeSingle();
  exiger(archive, "Outil pédagogique");
  return { ok: true };
});
