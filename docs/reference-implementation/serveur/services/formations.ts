/**
 * Module 2 — Mes formations (F-FORM-01, F-FORM-02) et Module 3 — outils pédagogiques et coffre-fort (F-OUT-01 à 05).
 *
 * Ajouts du 23/09/2026 (« Modification 1 ») :
 *  - la formation porte son parcours en MODULES et tous les champs utiles à la convention (financement, lieu,
 *    effectifs, coût formateur, modalités d'évaluation, accessibilité, délai d'accès…) ;
 *  - chaque enregistrement d'une formation ou d'un outil garde la version précédente (restaurable) ;
 *  - rien n'est détruit d'un clic : formations et outils sont archivés, les fichiers du coffre vont à la corbeille ;
 *    tout se restaure (« faire réapparaître »). Seule la purge de la corbeille est définitive.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { validerQuestionnaire, type Questionnaire } from "@/domaine/formulaires/qcm";
import { CODES_CATEGORIES } from "@/domaine/pedagogie/listes";
import { validerEnjeux } from "@/domaine/pedagogie/enjeux";
import { objectifsDepuisModules, programmeDepuisModules, validerModules, type ModuleParcours } from "@/domaine/pedagogie/parcours";
import { aAtteint, type SousStatut } from "@/domaine/pipeline/statuts";
import { coffreFichier, dossierFormation, formation, modeleOutil, stagiaireDossier, versionObjet } from "../bd/schema";
import { cheminCoffre } from "../ports/archive";
import { nouvelId } from "../ports/divers";
import { typeMimeDe, validerFichier, type FichierDepose } from "./fichiers";
import { ErreurMetier, exigerFormateurValide, interdit, introuvable, invalide, journaliser, validerPartiel, type Acteur, type Services } from "./socle";

const centimes = z.number().int().min(0).max(100_000_000).nullable().default(null);
const heures = z.number().min(0).max(2000).nullable().default(null);
const entier = (max: number) => z.number().int().min(0).max(max).nullable().default(null);

const SchemaModule = z.object({
  titre: z.string().trim().max(200),
  duree_heures: z.number().min(0).max(400),
  objectifs: z.array(z.string().trim().max(500)).max(8),
  contenus: z.array(z.string().trim().max(500)).max(15),
  methodes: z.string().trim().max(2000).default(""),
  mise_en_pratique: z.string().trim().max(2000).default(""),
  evaluation: z.string().trim().max(1000).default(""),
});

// Champs alignés sur les variables `formation_*` du dictionnaire (F-FORM-01), plus ceux de la convention.
export const SchemaFormation = z.object({
  formation_titre: z.string().trim().min(3, "L'intitulé est obligatoire.").max(200),
  formation_objectifs: z.string().trim().max(4000).default(""),
  formation_niveau: z.string().trim().max(100).default(""),
  formation_prerequis: z.string().trim().max(2000).default(""),
  formation_duree_heures_total: z.number().positive().max(2000).nullable().default(null),
  formation_duree_jours: z.number().positive().max(400).nullable().default(null),
  formation_modalite: z.enum(["presentiel", "distanciel", "mixte"]).default("presentiel"),
  formation_prix_unitaire_ht: centimes,
  programme: z.string().trim().max(20000).default(""),
  public_vise: z.string().trim().max(2000).default(""),
  formation_nb_modules: z.number().int().min(1).max(12).nullable().default(null),
  formation_modules: z.array(SchemaModule).max(12).default([]),
  formation_duree_heures_presentiel: heures,
  formation_duree_heures_distanciel: heures,
  formation_prix_groupe_ht: centimes,
  formation_effectif_min: entier(500),
  formation_effectif_max: entier(500),
  formation_lieu_nom: z.string().trim().max(200).default(""),
  formation_lieu_adresse: z.string().trim().max(400).default(""),
  formation_lieu_siret: z.string().trim().max(20).default(""),
  formation_lien_visio: z.union([z.literal(""), z.string().trim().url("Lien de connexion invalide.").max(500)]).default(""),
  mode_financement: z.enum(["opco", "faf", "entreprise", "fonds_propres"]).default("opco"),
  formation_opco: z.string().trim().max(200).default(""),
  formation_domaine: z.string().trim().max(200).default(""),
  formation_moyens_pedagogiques: z.string().trim().max(4000).default(""),
  formation_modalites_evaluation: z.string().trim().max(4000).default(""),
  formation_modalites_sanction: z.string().trim().max(500).default(""),
  formation_accessibilite: z.string().trim().max(2000).default(""),
  formation_delai_acces: z.string().trim().max(200).default(""),
  /** Dossier d'enjeux proposé par l'IA à la génération du parcours (version 7) ; validé strictement, jamais « réparé ». */
  dossier_enjeux: z
    .unknown()
    .nullable()
    .default(null)
    .transform((x, ctx) => {
      if (x === null || x === undefined) return null;
      const r = validerEnjeux(x);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: `Dossier d'enjeux invalide : ${r.erreurs[0]}` });
        return z.NEVER;
      }
      return r.valeur;
    }),
});

type LigneFormation = typeof formation.$inferSelect;

/** Contrôles de cohérence qui ne tiennent pas dans un schéma champ par champ. */
function controlerCoherence(f: Partial<z.infer<typeof SchemaFormation>>): void {
  const erreurs: Record<string, string> = {};
  if (f.formation_effectif_min != null && f.formation_effectif_max != null && f.formation_effectif_min > f.formation_effectif_max) {
    erreurs.formation_effectif_max = "L'effectif maximum doit être supérieur ou égal au minimum.";
  }
  const total = f.formation_duree_heures_total;
  const somme = (f.formation_duree_heures_presentiel ?? 0) + (f.formation_duree_heures_distanciel ?? 0);
  if (total != null && (f.formation_duree_heures_presentiel != null || f.formation_duree_heures_distanciel != null) && Math.abs(somme - total) > 0.01) {
    erreurs.formation_duree_heures_presentiel = `Présentiel + distanciel (${somme} h) doit égaler la durée totale (${total} h).`;
  }
  if (f.formation_modules?.length) {
    const r = validerModules(f.formation_modules);
    if (!r.ok) throw invalide("Le parcours est incomplet.", { erreurs: r.erreurs });
    if (total != null) {
      const sommeModules = f.formation_modules.reduce((a, m) => a + m.duree_heures, 0);
      if (Math.abs(sommeModules - total) > 0.01) erreurs.formation_modules = `La somme des durées des modules (${sommeModules} h) doit égaler la durée totale (${total} h).`;
    }
  }
  if (Object.keys(erreurs).length > 0) throw invalide(Object.values(erreurs)[0]!, { champs: erreurs });
}

export async function listerFormations(s: Services, acteur: Acteur, options: { archivees?: boolean } = {}) {
  const formateur_id = exigerFormateurValide(acteur);
  return s.bd
    .select()
    .from(formation)
    .where(and(eq(formation.formateur_id, formateur_id), eq(formation.archivee, options.archivees === true)))
    .orderBy(desc(formation.cree_le));
}

export async function lireFormation(s: Services, acteur: Acteur, id: string) {
  const formateur_id = exigerFormateurValide(acteur);
  const [f] = await s.bd.select().from(formation).where(and(eq(formation.id, id), eq(formation.formateur_id, formateur_id)));
  if (!f) throw introuvable("Formation");
  return f;
}

/** Lecture ouverte au formateur propriétaire ET à l'organisme (coffre-fort, positionnements) — jamais à un autre formateur. */
export async function formationAccessible(s: Services, acteur: Acteur, id: string): Promise<LigneFormation> {
  if (acteur.role === "admin") {
    const [f] = await s.bd.select().from(formation).where(and(eq(formation.id, id), eq(formation.of_id, acteur.of_id)));
    if (!f) throw introuvable("Formation");
    return f;
  }
  return lireFormation(s, acteur, id);
}

/** Quand le parcours est renseigné, programme et objectifs vides en sont déduits (le formateur peut les réécrire). */
function completerDepuisModules<T extends Partial<z.infer<typeof SchemaFormation>>>(v: T): T {
  const modules = v.formation_modules as ModuleParcours[] | undefined;
  if (!modules?.length) return v;
  return {
    ...v,
    formation_nb_modules: modules.length,
    programme: v.programme?.trim() ? v.programme : programmeDepuisModules(modules),
    formation_objectifs: v.formation_objectifs?.trim() ? v.formation_objectifs : objectifsDepuisModules(modules),
  };
}

export async function creerFormation(s: Services, acteur: Acteur, donnees: unknown) {
  const formateur_id = exigerFormateurValide(acteur);
  const valeurs = completerDepuisModules(SchemaFormation.parse(donnees));
  controlerCoherence(valeurs);
  const id = nouvelId();
  const maintenant = s.horloge.maintenant();
  await s.bd.insert(formation).values({ id, of_id: acteur.of_id, formateur_id, ...valeurs, enjeux_le: valeurs.dossier_enjeux ? maintenant : null, cree_le: maintenant, maj_le: maintenant });
  await journaliser(s, { of_id: acteur.of_id, acteur, type: "formation_creee", libelle: `Formation « ${valeurs.formation_titre} » créée` });
  return lireFormation(s, acteur, id);
}

// ——— Versions : chaque enregistrement conserve l'état précédent ———

const VERSIONS_CONSERVEES = 50;

export async function memoriserVersion(s: Services, acteur: Acteur, type: "formation" | "outil", objet_id: string, snapshot: unknown, libelle: string): Promise<void> {
  await s.bd.insert(versionObjet).values({ id: nouvelId(), of_id: acteur.of_id, type, objet_id, libelle, snapshot, auteur_id: acteur.utilisateur_id, cree_le: s.horloge.maintenant() });
  const anciennes = await s.bd.select({ id: versionObjet.id }).from(versionObjet).where(and(eq(versionObjet.type, type), eq(versionObjet.objet_id, objet_id))).orderBy(desc(versionObjet.cree_le));
  const aPurger = anciennes.slice(VERSIONS_CONSERVEES).map((v) => v.id);
  if (aPurger.length > 0) await s.bd.delete(versionObjet).where(inArray(versionObjet.id, aPurger));
}

export async function modifierFormation(s: Services, acteur: Acteur, id: string, donnees: unknown) {
  const avant = await lireFormation(s, acteur, id);
  const valeurs = validerPartiel(SchemaFormation, donnees);
  if (Object.keys(valeurs).length === 0) return avant;
  const fusion = { ...avant, ...valeurs } as unknown as z.infer<typeof SchemaFormation>;
  controlerCoherence(fusion);
  const complete = "formation_modules" in valeurs ? completerDepuisModules({ ...valeurs, programme: valeurs.programme ?? avant.programme, formation_objectifs: valeurs.formation_objectifs ?? avant.formation_objectifs }) : valeurs;
  await memoriserVersion(s, acteur, "formation", id, avant, `Avant la modification du ${s.horloge.maintenant().toISOString()}`);
  const enjeuxChanges = "dossier_enjeux" in valeurs && valeurs.dossier_enjeux && JSON.stringify(valeurs.dossier_enjeux) !== JSON.stringify(avant.dossier_enjeux);
  await s.bd.update(formation).set({ ...complete, ...(enjeuxChanges ? { enjeux_le: s.horloge.maintenant() } : {}), maj_le: s.horloge.maintenant() }).where(eq(formation.id, id));
  return lireFormation(s, acteur, id);
}

export async function listerVersions(s: Services, acteur: Acteur, type: "formation" | "outil", objetId: string) {
  if (type === "formation") await lireFormation(s, acteur, objetId);
  else await lireOutil(s, acteur, objetId, { memeArchive: true });
  const lignes = await s.bd.select().from(versionObjet).where(and(eq(versionObjet.type, type), eq(versionObjet.objet_id, objetId))).orderBy(desc(versionObjet.cree_le));
  return lignes.map((v) => ({ id: v.id, cree_le: v.cree_le, libelle: v.libelle, apercu: resumer(type, v.snapshot) }));
}

function resumer(type: "formation" | "outil", snapshot: unknown): string {
  const o = (snapshot ?? {}) as Record<string, unknown>;
  if (type === "formation") {
    const modules = Array.isArray(o.formation_modules) ? o.formation_modules.length : 0;
    return `${String(o.formation_titre ?? "")} · ${o.formation_duree_heures_total ?? "—"} h · ${modules} module(s)`;
  }
  const questions = ((o.contenu as { questions?: unknown[] } | undefined)?.questions ?? []).length;
  return `${String(o.titre ?? "")} · ${questions} question(s)`;
}

/** Restaure une version : l'état actuel est lui-même mémorisé d'abord, la restauration est donc réversible. */
export async function restaurerVersion(s: Services, acteur: Acteur, versionId: string) {
  const [v] = await s.bd.select().from(versionObjet).where(and(eq(versionObjet.id, versionId), eq(versionObjet.of_id, acteur.of_id)));
  if (!v) throw introuvable("Version");
  const snap = v.snapshot as Record<string, unknown>;
  if (v.type === "formation") {
    const actuelle = await lireFormation(s, acteur, v.objet_id);
    await memoriserVersion(s, acteur, "formation", v.objet_id, actuelle, "Avant restauration d'une version antérieure");
    const champs = Object.fromEntries(Object.keys(SchemaFormation.shape).filter((k) => k in snap).map((k) => [k, snap[k]]));
    await s.bd.update(formation).set({ ...champs, maj_le: s.horloge.maintenant() }).where(eq(formation.id, v.objet_id));
    return { type: "formation" as const, id: v.objet_id };
  }
  const actuel = await lireOutil(s, acteur, v.objet_id, { memeArchive: true });
  await memoriserVersion(s, acteur, "outil", v.objet_id, actuel, "Avant restauration d'une version antérieure");
  await s.bd.update(modeleOutil).set({ titre: String(snap.titre ?? actuel.titre), contenu: snap.contenu ?? actuel.contenu, formation_id: (snap.formation_id as string | null) ?? null, maj_le: s.horloge.maintenant() }).where(eq(modeleOutil.id, v.objet_id));
  return { type: "outil" as const, id: v.objet_id };
}

/** F-FORM-02 : dupliquer une formation, avec ses modèles d'outils (mais pas le contenu du coffre-fort). */
export async function dupliquerFormation(s: Services, acteur: Acteur, id: string) {
  const source = await lireFormation(s, acteur, id);
  const { id: _i, cree_le: _c, maj_le: _m, ...copie } = source;
  const nouveauId = nouvelId();
  const maintenant = s.horloge.maintenant();
  await s.bd.insert(formation).values({ ...copie, id: nouveauId, formation_titre: `${source.formation_titre} (copie)`, archivee: false, archivee_le: null, cree_le: maintenant, maj_le: maintenant });
  const outils = await s.bd.select().from(modeleOutil).where(and(eq(modeleOutil.formation_id, id), isNull(modeleOutil.archive_le)));
  for (const o of outils) {
    const { id: _oi, cree_le: _oc, maj_le: _om, ...outil } = o;
    await s.bd.insert(modeleOutil).values({ ...outil, id: nouvelId(), formation_id: nouveauId, cree_le: maintenant, maj_le: maintenant });
  }
  return lireFormation(s, acteur, nouveauId);
}

/** Une formation utilisée par des dossiers est archivée, jamais supprimée : les dossiers gardent leur origine. */
export async function archiverFormation(s: Services, acteur: Acteur, id: string) {
  const f = await lireFormation(s, acteur, id);
  await s.bd.update(formation).set({ archivee: true, archivee_le: s.horloge.maintenant() }).where(eq(formation.id, id));
  await journaliser(s, { of_id: acteur.of_id, acteur, type: "formation_archivee", libelle: `Formation « ${f.formation_titre} » archivée` });
}

export async function restaurerFormation(s: Services, acteur: Acteur, id: string) {
  const f = await lireFormation(s, acteur, id);
  await s.bd.update(formation).set({ archivee: false, archivee_le: null }).where(eq(formation.id, id));
  await journaliser(s, { of_id: acteur.of_id, acteur, type: "formation_restauree", libelle: `Formation « ${f.formation_titre} » restaurée` });
  return lireFormation(s, acteur, id);
}

// ——— Outils pédagogiques : modèles de recueil, de positionnement, d'évaluation des acquis ———

const SchemaQuestionnaire = z.object({
  titre: z.string().trim().max(200),
  questions: z
    .array(z.object({ enonce: z.string().trim().max(1000), propositions: z.array(z.string().trim().max(500)).max(8), bonne_reponse: z.number().int() }))
    .max(40),
});

const SchemaOutil = z.object({
  type: z.enum(["recueil", "positionnement", "acquis"]),
  titre: z.string().trim().min(1, "Le titre est obligatoire.").max(200),
  formation_id: z.string().nullable().default(null),
  contenu: z.unknown(),
});

function validerContenuOutil(type: "recueil" | "positionnement" | "acquis", contenu: unknown): unknown {
  if (type === "recueil") {
    // Le recueil a des questions fixes (matrice de l'organisme) ; le formateur peut en ajouter.
    return z.object({ questions_supplementaires: z.array(z.string().trim().min(3).max(500)).max(10).default([]) }).parse(contenu ?? {});
  }
  const q = SchemaQuestionnaire.parse(contenu) as Questionnaire;
  const erreurs = validerQuestionnaire(q);
  if (erreurs.length > 0) throw invalide("Le questionnaire est incomplet.", { erreurs });
  return q;
}

export async function listerOutils(s: Services, acteur: Acteur, options: { archives?: boolean } = {}) {
  const formateur_id = exigerFormateurValide(acteur);
  return s.bd
    .select()
    .from(modeleOutil)
    .where(and(eq(modeleOutil.formateur_id, formateur_id), options.archives ? isNotNull(modeleOutil.archive_le) : isNull(modeleOutil.archive_le)))
    .orderBy(desc(modeleOutil.cree_le));
}

export async function lireOutil(s: Services, acteur: Acteur, id: string, options: { memeArchive?: boolean } = {}) {
  const formateur_id = exigerFormateurValide(acteur);
  const [o] = await s.bd.select().from(modeleOutil).where(and(eq(modeleOutil.id, id), eq(modeleOutil.formateur_id, formateur_id)));
  if (!o || (o.archive_le && !options.memeArchive)) throw introuvable("Outil pédagogique");
  return o;
}

export async function enregistrerOutil(s: Services, acteur: Acteur, donnees: unknown, id?: string) {
  const formateur_id = exigerFormateurValide(acteur);
  const valeurs = SchemaOutil.parse(donnees);
  if (valeurs.formation_id) await lireFormation(s, acteur, valeurs.formation_id);
  const contenu = validerContenuOutil(valeurs.type, valeurs.contenu);
  const maintenant = s.horloge.maintenant();
  if (id) {
    const avant = await lireOutil(s, acteur, id);
    await memoriserVersion(s, acteur, "outil", id, avant, "Avant modification");
    await s.bd.update(modeleOutil).set({ titre: valeurs.titre, formation_id: valeurs.formation_id, contenu, maj_le: maintenant }).where(eq(modeleOutil.id, id));
    return lireOutil(s, acteur, id);
  }
  const nouveauId = nouvelId();
  await s.bd.insert(modeleOutil).values({ id: nouveauId, of_id: acteur.of_id, formateur_id, type: valeurs.type, titre: valeurs.titre, formation_id: valeurs.formation_id, contenu, cree_le: maintenant, maj_le: maintenant });
  return lireOutil(s, acteur, nouveauId);
}

/** « Supprimer » un outil l'archive : les dossiers déjà créés gardent leur copie ; il se restaure depuis les archives. */
export async function supprimerOutil(s: Services, acteur: Acteur, id: string) {
  await lireOutil(s, acteur, id);
  await s.bd.update(modeleOutil).set({ archive_le: s.horloge.maintenant() }).where(eq(modeleOutil.id, id));
}

export async function restaurerOutil(s: Services, acteur: Acteur, id: string) {
  await lireOutil(s, acteur, id, { memeArchive: true });
  await s.bd.update(modeleOutil).set({ archive_le: null }).where(eq(modeleOutil.id, id));
  return lireOutil(s, acteur, id);
}

// ——— Coffre-fort pédagogique, rattaché à la formation (F-OUT-04) ———

export async function listerCoffre(s: Services, acteur: Acteur, formationId: string, options: { corbeille?: boolean } = {}) {
  await formationAccessible(s, acteur, formationId);
  return s.bd
    .select()
    .from(coffreFichier)
    .where(and(eq(coffreFichier.formation_id, formationId), options.corbeille ? isNotNull(coffreFichier.supprime_le) : isNull(coffreFichier.supprime_le)))
    .orderBy(coffreFichier.cree_le);
}

const SchemaDepot = z.object({
  categorie: z.enum(CODES_CATEGORIES).default("support"),
  description: z.string().trim().max(500).default(""),
  partageable: z.boolean().default(true),
});

export async function deposerDansCoffre(s: Services, acteur: Acteur, formationId: string, fichier: FichierDepose, partageable: boolean | { categorie?: string; description?: string; partageable?: boolean } = true) {
  const formateur_id = exigerFormateurValide(acteur);
  await lireFormation(s, acteur, formationId);
  validerFichier(fichier, "coffre");
  const options = SchemaDepot.parse(typeof partageable === "boolean" ? { partageable } : partageable);
  await ecrireDansCoffre(s, acteur.of_id, formateur_id, formationId, fichier, { ...options, origine: "depot" });
  return listerCoffre(s, acteur, formationId);
}

/** Écriture d'un fichier dans le coffre (dépôt du formateur ou document produit par l'application). */
export async function ecrireDansCoffre(
  s: Services,
  of_id: string,
  formateur_id: string,
  formationId: string,
  fichier: FichierDepose,
  o: { categorie: string; description: string; partageable: boolean; origine: "depot" | "genere" },
): Promise<string> {
  const id = nouvelId();
  const chemin = await s.archive.ecrire(cheminCoffre(of_id, formationId, `${id.slice(0, 8)}_${fichier.nom}`), fichier.contenu);
  await s.bd.insert(coffreFichier).values({
    id,
    of_id,
    formateur_id,
    formation_id: formationId,
    nom_fichier: fichier.nom,
    chemin,
    taille: fichier.contenu.length,
    type_mime: fichier.type_mime || typeMimeDe(fichier.nom),
    partageable: o.partageable,
    categorie: o.categorie,
    description: o.description,
    origine: o.origine,
    cree_le: s.horloge.maintenant(),
  });
  return id;
}

async function fichierDuFormateur(s: Services, acteur: Acteur, fichierId: string) {
  const formateur_id = exigerFormateurValide(acteur);
  const [f] = await s.bd.select().from(coffreFichier).where(and(eq(coffreFichier.id, fichierId), eq(coffreFichier.formateur_id, formateur_id)));
  if (!f) throw introuvable("Fichier");
  return f;
}

export async function reglerPartage(s: Services, acteur: Acteur, fichierId: string, partageable: boolean) {
  await fichierDuFormateur(s, acteur, fichierId);
  await s.bd.update(coffreFichier).set({ partageable }).where(eq(coffreFichier.id, fichierId));
}

export async function modifierFichierCoffre(s: Services, acteur: Acteur, fichierId: string, donnees: unknown) {
  await fichierDuFormateur(s, acteur, fichierId);
  const v = validerPartiel(SchemaDepot, donnees);
  if (Object.keys(v).length > 0) await s.bd.update(coffreFichier).set(v).where(eq(coffreFichier.id, fichierId));
}

/** Supprimer = mettre à la corbeille : le fichier reste sur le disque et se restaure. */
export async function supprimerDuCoffre(s: Services, acteur: Acteur, fichierId: string) {
  await fichierDuFormateur(s, acteur, fichierId);
  await s.bd.update(coffreFichier).set({ supprime_le: s.horloge.maintenant() }).where(eq(coffreFichier.id, fichierId));
}

export async function restaurerDuCoffre(s: Services, acteur: Acteur, fichierId: string) {
  await fichierDuFormateur(s, acteur, fichierId);
  await s.bd.update(coffreFichier).set({ supprime_le: null }).where(eq(coffreFichier.id, fichierId));
}

/** Purge définitive, seulement depuis la corbeille. */
export async function purgerDuCoffre(s: Services, acteur: Acteur, fichierId: string) {
  const f = await fichierDuFormateur(s, acteur, fichierId);
  if (!f.supprime_le) throw new ErreurMetier("conflit", "Mettez d'abord le fichier à la corbeille.");
  await s.archive.supprimer(f.chemin);
  await s.bd.delete(coffreFichier).where(eq(coffreFichier.id, fichierId));
  await journaliser(s, { of_id: acteur.of_id, acteur, type: "coffre_purge", libelle: `Fichier « ${f.nom_fichier} » supprimé définitivement` });
}

/**
 * Coffres ouverts à un apprenant — RG-08 : un coffre s'ouvre dès que SON dossier a atteint l'accord de
 * financement, et seulement pour les éléments marqués « partageable » (hypothèse, point ouvert n° 5).
 */
export async function coffresDeLApprenant(s: Services, acteur: Acteur) {
  if (acteur.role !== "apprenant" || !acteur.stagiaire_id) throw interdit();
  const dossiers = await s.bd
    .select({ d: dossierFormation })
    .from(stagiaireDossier)
    .innerJoin(dossierFormation, eq(dossierFormation.id, stagiaireDossier.dossier_id))
    .where(eq(stagiaireDossier.stagiaire_id, acteur.stagiaire_id));
  const ouverts = dossiers.map((x) => x.d).filter((d) => d.formation_id && aAtteint(d.sous_statut as SousStatut, "accord_financement"));
  if (ouverts.length === 0) return [];
  const fichiers = await s.bd
    .select()
    .from(coffreFichier)
    .where(and(inArray(coffreFichier.formation_id, ouverts.map((d) => d.formation_id!)), eq(coffreFichier.partageable, true), isNull(coffreFichier.supprime_le)));
  return ouverts.map((d) => ({
    dossier_id: d.id,
    dossier_reference: d.dossier_reference,
    formation_titre: d.formation_titre,
    fichiers: fichiers.filter((f) => f.formation_id === d.formation_id).map((f) => ({ id: f.id, nom_fichier: f.nom_fichier, taille: f.taille, categorie: f.categorie })),
  }));
}

export async function telechargerDuCoffre(s: Services, acteur: Acteur, fichierId: string) {
  const [f] = await s.bd.select().from(coffreFichier).where(and(eq(coffreFichier.id, fichierId), eq(coffreFichier.of_id, acteur.of_id)));
  if (!f) throw introuvable("Fichier");
  if (acteur.role === "formateur" && f.formateur_id !== acteur.formateur_id) throw introuvable("Fichier");
  if (acteur.role === "apprenant") {
    const autorises = (await coffresDeLApprenant(s, acteur)).flatMap((c) => c.fichiers.map((x) => x.id));
    if (!autorises.includes(f.id)) throw introuvable("Fichier");
  }
  return { nom: f.nom_fichier, contenu: await s.archive.lire(f.chemin), type_mime: f.type_mime || typeMimeDe(f.nom_fichier) };
}
