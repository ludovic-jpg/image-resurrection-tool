/**
 * Sauvegarde et restauration de l'espace pédagogique (routes 85 et 86) — équivalent serveur de
 * `exporterMesDonnees` et `importerMesDonnees` (`src/serveur/services/sauvegarde.ts`).
 *
 *  - export : lit les formations, outils, fiches apprenants et entreprises du formateur (client « service », filtré
 *    sur SA fiche et SON organisme) et journalise ;
 *  - import : recrée formations et questionnaires en COPIES (rien n'est écrasé), avec les mêmes validations que la
 *    saisie directe (schémas du lot 2) ; les fiches apprenants et entreprises ne sont pas réimportées (doublons).
 */
import {
  construireSauvegarde,
  lireSauvegarde,
  nomFichierSauvegarde,
} from "@/domaine/sauvegarde/sauvegarde";
import {
  SchemaOutil,
  SchemaQuestionnaire,
  SchemaRecueil,
  SchemaFormation,
} from "@/client/passerelle/lot-2-schemas";
import { validerQuestionnaire, type Questionnaire } from "@/domaine/formulaires/qcm";
import { completerDepuisModules, controlerCoherence } from "@/domaine/pedagogie/formation";
import { ZodError } from "zod";
import type { ActeurFormateurValide } from "./acteur.server";
import type { BdService } from "./bd.server";
import { invalide, leverSiErreurBd } from "./erreurs.server";
import { journaliser } from "./journal.server";
import { lireTout } from "./lecture.server";

type Ligne = Record<string, unknown>;

const lireTable = (bd: BdService, table: string, acteur: ActeurFormateurValide) =>
  lireTout<Ligne>(
    (de, a) =>
      bd
        .from(table)
        .select("*")
        .eq("formateur_id", acteur.formateur_id)
        .eq("of_id", acteur.of_id)
        .order("cree_le")
        .order("id")
        .range(de, a),
    `lecture de ${table}`,
  );

export async function exporterMesDonnees(
  bd: BdService,
  acteur: ActeurFormateurValide,
  maintenant: Date = new Date(),
): Promise<{ nom: string; contenu: string; type_mime: string }> {
  const [formations, outils, stagiaires, entreprises] = await Promise.all([
    lireTable(bd, "formation", acteur),
    lireTable(bd, "modele_outil", acteur),
    lireTable(bd, "stagiaire", acteur),
    lireTable(bd, "entreprise_cliente", acteur),
  ]);
  const sauvegarde = construireSauvegarde({
    date: maintenant,
    formateur: acteur.nom,
    formations,
    outils,
    stagiaires,
    entreprises,
  });
  await journaliser(bd, {
    of_id: acteur.of_id,
    acteur,
    type: "sauvegarde_exportee",
    libelle: "Sauvegarde de l'espace pédagogique téléchargée",
  });
  return {
    nom: nomFichierSauvegarde(maintenant),
    contenu: JSON.stringify(sauvegarde, null, 2),
    type_mime: "application/json; charset=utf-8",
  };
}

const messageDe = (e: unknown): string =>
  e instanceof ZodError
    ? (e.issues[0]?.message ?? "données invalides")
    : e instanceof Error
      ? e.message
      : "illisible";

/** Le recueil a des questions fixes ; le positionnement et les acquis sont des QCM contrôlés (comme la saisie directe). */
function contenuOutilValide(
  type: "recueil" | "positionnement" | "acquis",
  contenu: unknown,
): unknown {
  if (type === "recueil") return SchemaRecueil.parse(contenu ?? {});
  const q = SchemaQuestionnaire.parse(contenu) as Questionnaire;
  const erreurs = validerQuestionnaire(q);
  if (erreurs.length > 0) throw new Error("Le questionnaire est incomplet.");
  return q;
}

export async function importerMesDonnees(
  bd: BdService,
  acteur: ActeurFormateurValide,
  contenu: string,
): Promise<{ formations: number; outils: number; erreurs: string[] }> {
  const lecture = lireSauvegarde(contenu);
  if (!lecture.ok) throw invalide(lecture.message);

  const correspondance = new Map<string, string>();
  const erreurs: string[] = [];
  let formations = 0;
  let outils = 0;
  const champsFormation = Object.keys(SchemaFormation.shape);

  for (const f of lecture.formations) {
    const titre = String(f["formation_titre"] ?? "Formation");
    try {
      const champs = Object.fromEntries(
        champsFormation.filter((k) => k in f && f[k] !== null).map((k) => [k, f[k]]),
      );
      const valeurs = completerDepuisModules(
        SchemaFormation.parse({ ...champs, formation_titre: `${titre} (restaurée)`.slice(0, 200) }),
      );
      const incoherence = controlerCoherence(valeurs);
      if (incoherence) throw new Error(incoherence.message);
      const { data, error } = await bd
        .from("formation")
        .insert({
          ...valeurs,
          of_id: acteur.of_id,
          formateur_id: acteur.formateur_id,
          enjeux_le: valeurs.dossier_enjeux ? new Date().toISOString() : null,
        })
        .select("id")
        .single();
      leverSiErreurBd(error, "création de la formation restaurée");
      correspondance.set(String(f["id"]), String((data as { id: string }).id));
      formations++;
    } catch (e) {
      erreurs.push(`Formation « ${titre} » : ${messageDe(e)}`);
    }
  }

  for (const o of lecture.outils) {
    const titre = String(o["titre"] ?? "Questionnaire");
    try {
      const valeurs = SchemaOutil.parse({
        type: o["type"],
        titre: `${titre} (restauré)`.slice(0, 200),
        formation_id: o["formation_id"]
          ? (correspondance.get(String(o["formation_id"])) ?? null)
          : null,
        contenu: o["contenu"],
      });
      const { error } = await bd.from("modele_outil").insert({
        of_id: acteur.of_id,
        formateur_id: acteur.formateur_id,
        type: valeurs.type,
        titre: valeurs.titre,
        formation_id: valeurs.formation_id,
        contenu: contenuOutilValide(valeurs.type, valeurs.contenu),
      });
      leverSiErreurBd(error, "création du questionnaire restauré");
      outils++;
    } catch (e) {
      erreurs.push(`Questionnaire « ${titre} » : ${messageDe(e)}`);
    }
  }

  await journaliser(bd, {
    of_id: acteur.of_id,
    acteur,
    type: "sauvegarde_importee",
    libelle: `Sauvegarde importée : ${formations} formation(s), ${outils} questionnaire(s)`,
  });
  return { formations, outils, erreurs };
}
