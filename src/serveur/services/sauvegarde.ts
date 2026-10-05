/**
 * Sauvegarde et restauration de l'espace pédagogique d'un formateur — « Modification 1 » du 23/09/2026 :
 * « garde un point sur l'archivage des données, et la possibilité d'enregistrer à tout moment et de faire réapparaître
 * des choses ».
 *
 *  - `exporterMesDonnees` : un fichier JSON lisible (formations et leurs parcours, questionnaires, fiches apprenants et
 *    entreprises), à conserver hors de l'application. C'est aussi le droit à la portabilité (RGPD, art. 20).
 *  - `importerMesDonnees` : recrée les formations et les questionnaires d'une sauvegarde, SANS jamais écraser l'existant
 *    (des copies sont créées ; les fiches apprenants et entreprises ne sont pas réimportées, pour éviter les doublons).
 *  - `archivesEtCorbeille` : tout ce qui a été archivé ou mis à la corbeille, pour le restaurer d'un clic.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { coffreFichier, entrepriseCliente, formation, modeleOutil, stagiaire } from "../bd/schema";
import {
  creerFormation,
  enregistrerOutil,
  listerFormations,
  listerOutils,
  SchemaFormation,
} from "./formations";
import { listerPositionnements } from "./positionnements";
import { listerEntreprises, listerStagiaires } from "./repertoire";
import { exigerFormateurValide, invalide, journaliser, type Acteur, type Services } from "./socle";

export const VERSION_SAUVEGARDE = 1;

export async function exporterMesDonnees(s: Services, acteur: Acteur) {
  const formateur_id = exigerFormateurValide(acteur);
  const formations = await s.bd.select().from(formation).where(eq(formation.formateur_id, formateur_id));
  const outils = await s.bd.select().from(modeleOutil).where(eq(modeleOutil.formateur_id, formateur_id));
  const stagiaires = await s.bd.select().from(stagiaire).where(eq(stagiaire.formateur_id, formateur_id));
  const entreprises = await s.bd
    .select()
    .from(entrepriseCliente)
    .where(eq(entrepriseCliente.formateur_id, formateur_id));
  const sauvegarde = {
    application: "s4m-plateforme",
    version: VERSION_SAUVEGARDE,
    exportee_le: s.horloge.maintenant().toISOString(),
    formateur: acteur.nom,
    formations: formations.map(({ of_id: _o, formateur_id: _f, ...f }) => f),
    outils: outils.map(({ of_id: _o, formateur_id: _f, ...o }) => o),
    stagiaires: stagiaires.map(({ of_id: _o, formateur_id: _f, utilisateur_id: _u, ...st }) => st),
    entreprises: entreprises.map(({ of_id: _o, formateur_id: _f, ...e }) => e),
  };
  await journaliser(s, {
    of_id: acteur.of_id,
    acteur,
    type: "sauvegarde_exportee",
    libelle: "Sauvegarde de l'espace pédagogique téléchargée",
  });
  const date = s.horloge.maintenant().toISOString().slice(0, 10);
  return {
    nom: `sauvegarde-espace-pedagogique-${date}.json`,
    contenu: Buffer.from(JSON.stringify(sauvegarde, null, 2), "utf8"),
    type_mime: "application/json; charset=utf-8",
  };
}

const SchemaSauvegarde = z.object({
  application: z.literal("s4m-plateforme", {
    error: "Ce fichier n'est pas une sauvegarde de la plateforme.",
  }),
  version: z
    .number()
    .int()
    .max(VERSION_SAUVEGARDE, "Sauvegarde produite par une version plus récente de l'application."),
  formations: z.array(z.record(z.string(), z.unknown())).max(500),
  outils: z.array(z.record(z.string(), z.unknown())).max(2000),
});

/** Restaure formations et questionnaires d'une sauvegarde, en COPIES (rien n'est écrasé). */
export async function importerMesDonnees(s: Services, acteur: Acteur, contenu: Buffer) {
  exigerFormateurValide(acteur);
  let brut: unknown;
  try {
    brut = JSON.parse(contenu.toString("utf8"));
  } catch {
    throw invalide("Le fichier n'est pas un JSON lisible.");
  }
  const sv = SchemaSauvegarde.parse(brut);
  const correspondance = new Map<string, string>();
  const erreurs: string[] = [];
  let formations = 0;
  let outils = 0;
  for (const f of sv.formations) {
    const champs = Object.fromEntries(
      Object.keys(SchemaFormation.shape)
        .filter((k) => k in f && f[k] !== null)
        .map((k) => [k, f[k]]),
    );
    try {
      const creee = await creerFormation(s, acteur, {
        ...champs,
        formation_titre: `${String(f.formation_titre ?? "Formation")} (restaurée)`.slice(0, 200),
      });
      correspondance.set(String(f.id), creee.id);
      formations++;
    } catch (e) {
      erreurs.push(
        `Formation « ${String(f.formation_titre ?? "?")} » : ${e instanceof Error ? e.message : "illisible"}`,
      );
    }
  }
  for (const o of sv.outils) {
    try {
      await enregistrerOutil(s, acteur, {
        type: o.type,
        titre: `${String(o.titre ?? "Questionnaire")} (restauré)`.slice(0, 200),
        formation_id: o.formation_id ? (correspondance.get(String(o.formation_id)) ?? null) : null,
        contenu: o.contenu,
      });
      outils++;
    } catch (e) {
      erreurs.push(
        `Questionnaire « ${String(o.titre ?? "?")} » : ${e instanceof Error ? e.message : "illisible"}`,
      );
    }
  }
  await journaliser(s, {
    of_id: acteur.of_id,
    acteur,
    type: "sauvegarde_importee",
    libelle: `Sauvegarde importée : ${formations} formation(s), ${outils} questionnaire(s)`,
  });
  return { formations, outils, erreurs };
}

/** Tout ce qui peut « réapparaître » : archives et corbeille de l'espace du formateur. */
export async function archivesEtCorbeille(s: Services, acteur: Acteur) {
  const formateur_id = exigerFormateurValide(acteur);
  const fichiers = await s.bd
    .select({ c: coffreFichier, f: formation })
    .from(coffreFichier)
    .innerJoin(formation, eq(formation.id, coffreFichier.formation_id))
    .where(and(eq(coffreFichier.formateur_id, formateur_id), isNotNull(coffreFichier.supprime_le)))
    .orderBy(desc(coffreFichier.supprime_le));
  return {
    formations: (await listerFormations(s, acteur, { archivees: true })).map((f) => ({
      id: f.id,
      titre: f.formation_titre,
      depuis: f.archivee_le,
    })),
    outils: (await listerOutils(s, acteur, { archives: true })).map((o) => ({
      id: o.id,
      titre: o.titre,
      type: o.type,
      depuis: o.archive_le,
    })),
    fichiers: fichiers.map(({ c, f }) => ({
      id: c.id,
      nom: c.nom_fichier,
      formation: f.formation_titre,
      formation_id: f.id,
      depuis: c.supprime_le,
      taille: c.taille,
    })),
    stagiaires: (await listerStagiaires(s, acteur, { archives: true })).map((x) => ({
      id: x.id,
      nom: `${x.stagiaire_prenom} ${x.stagiaire_nom}`,
      depuis: x.archive_le,
    })),
    entreprises: (await listerEntreprises(s, acteur, { archives: true })).map((x) => ({
      id: x.id,
      nom: x.entreprise_nom,
      depuis: x.archive_le,
    })),
    positionnements: (await listerPositionnements(s, acteur, { archives: true })).map((p) => ({
      id: p.id,
      nom: `${p.apprenant} — ${p.formation_titre}`,
      depuis: p.archive_le,
    })),
  };
}
