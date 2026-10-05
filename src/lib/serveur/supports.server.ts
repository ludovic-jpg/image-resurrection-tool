/**
 * Production d'un support de cours PPTX et dépôt dans le coffre-fort — port de `produireSupport` /
 * `enregistrerSupport` de `src/serveur/services/pedagogie-ia.ts`.
 *
 * AUCUN appel à l'IA ici : on met en forme un plan que le formateur a vu et validé (test de garde
 * `ia-perimetre.test.ts`). Le fichier est écrit dans le bucket `coffre` (chemin `<of_id>/coffres/<formation>/…`, comme
 * tous les fichiers du coffre) afin que le téléchargement du coffre (route 55) et l'export ZIP (route 53) le trouvent.
 * Le support précédent du même module passe à la corbeille APRÈS l'écriture du nouveau : rien n'est perdu en cas d'échec.
 */
import { cheminCoffre } from "@/domaine/archive/chemins";
import { validerDiapos, type Diapo, type ModuleParcours } from "@/domaine/pedagogie/parcours";
import { nomSupport, repereModule, TYPE_MIME_PPTX } from "@/domaine/pedagogie/supports";
import { z } from "zod";
import type { ActeurFormateurValide } from "./acteur.server";
import { ouvrirArchive } from "./archive.server";
import type { BdService } from "./bd.server";
import { introuvable, invalide, leverSiErreurBd } from "./erreurs.server";
import { journaliser } from "./journal.server";
import { lireCorps, lireFormation, modulesDe, type FormationIa } from "./pedagogie-commun.server";
import { rendrePptx } from "./support-pptx.server";

export interface SupportProduit {
  id: string;
  nom: string;
  diapositives: number;
}

async function enregistrerSupport(
  bd: BdService,
  acteur: ActeurFormateurValide,
  f: FormationIa,
  m: ModuleParcours,
  index: number,
  diapos: Diapo[],
): Promise<SupportProduit> {
  const { data: of, error: errOf } = await bd
    .from("organisme_formation")
    .select("of_nom, couleur")
    .eq("id", acteur.of_id)
    .maybeSingle();
  leverSiErreurBd(errOf, "lecture de l'organisme");
  if (!of) throw introuvable("Organisme");
  const identite = of as { of_nom: string; couleur: string };

  const contenu = await rendrePptx({
    formation_titre: f.formation_titre,
    organisme: identite.of_nom || "Organisme de formation",
    couleur: identite.couleur,
    module: m,
    rang: index + 1,
    diapos,
  });

  const id = crypto.randomUUID();
  const nom = nomSupport(index + 1, m.titre);
  const marque = repereModule(index + 1);
  const chemin = cheminCoffre(acteur.of_id, f.id, `${id.slice(0, 8)}_${nom}`);
  const archive = ouvrirArchive(bd, { ofId: acteur.of_id, bucket: "coffre" });
  await archive.ecrire(chemin, contenu, TYPE_MIME_PPTX);

  const { error } = await bd.from("coffre_fichier").insert({
    id,
    of_id: acteur.of_id,
    formateur_id: acteur.formateur_id,
    formation_id: f.id,
    nom_fichier: nom,
    chemin,
    taille: contenu.length,
    type_mime: TYPE_MIME_PPTX,
    partageable: true,
    categorie: "support",
    description: marque,
    origine: "genere",
  });
  if (error) {
    // Pas de fichier orphelin dans Storage si la ligne n'a pas pu être écrite.
    await archive.supprimer(chemin).catch(() => undefined);
    leverSiErreurBd(error, "enregistrement du support dans le coffre-fort");
  }

  // Le support précédent du même module passe à la corbeille (récupérable) ; le nouveau reste actif.
  const { error: errCorbeille } = await bd
    .from("coffre_fichier")
    .update({ supprime_le: new Date().toISOString() })
    .eq("formation_id", f.id)
    .eq("origine", "genere")
    .eq("description", marque)
    .is("supprime_le", null)
    .neq("id", id);
  leverSiErreurBd(errCorbeille, "mise à la corbeille de l'ancien support");

  await journaliser(bd, {
    of_id: acteur.of_id,
    acteur,
    type: "support_genere",
    libelle: `Support PPTX du module ${index + 1} produit pour « ${f.formation_titre} »`,
  });
  return { id, nom, diapositives: diapos.length };
}

const SchemaProduction = z.object({
  formation_id: z.string().min(1, "Formation manquante."),
  module_index: z.number().int().min(0).max(11),
  diapos: z.unknown(),
});

/**
 * Produit le PPTX d'un module à partir d'un plan VALIDÉ par le formateur (il le reçoit de la route 63, l'aménage,
 * puis le renvoie ici), et le range dans le coffre-fort (rubrique « Support de cours », origine « générée »).
 */
export async function produireSupport(
  bd: BdService,
  acteur: ActeurFormateurValide,
  donnees: unknown,
): Promise<SupportProduit> {
  const v = lireCorps(SchemaProduction, donnees);
  const f = await lireFormation(bd, acteur, v.formation_id);
  const m = modulesDe(f)[v.module_index];
  if (!m) throw invalide("Ce module n'existe pas dans le parcours.");
  const plan = validerDiapos(v.diapos);
  if (!plan.ok) throw invalide("Le plan du support est incomplet.", { erreurs: plan.erreurs });
  return enregistrerSupport(bd, acteur, f, m, v.module_index, plan.valeur);
}
