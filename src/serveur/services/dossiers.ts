/**
 * Module 5 — Création d'un dossier de formation (F-DOS-01 à 07) et Module 6 — « Mes dossiers » (F-CRM-01 à 07).
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { calculer } from "@/domaine/dossier/calculs";
import type { Questionnaire } from "@/domaine/formulaires/qcm";
import {
  LIBELLE_STATUT,
  piecesManquantesPourCompletude,
  peutValider,
  peutVoir,
} from "@/domaine/pieces/statut";
import {
  ETAPES,
  SOUS_STATUTS,
  estTerminal,
  etapeDe,
  libelleSousStatut,
  type SousStatut,
} from "@/domaine/pipeline/statuts";
import { actionsPossibles } from "@/domaine/pipeline/transitions";
import { sectionsParcours } from "@/domaine/parcours/apprenant";
import { NOMENCLATURE, definitionPiece, type CodePiece } from "@/domaine/referentiel/pieces";
import {
  dossierFormation,
  evaluation,
  evenement,
  formateur,
  modeleOutil,
  pieceDossier,
  seance,
  stagiaire,
  stagiaireDossier,
} from "../bd/schema";
import { nouvelId } from "../ports/divers";
import {
  accederAuDossier,
  chargerAgregat,
  chargerContextePipeline,
  seancesDuDossier,
  stagiairesDuDossier,
  type LigneDossier,
} from "./agregat";
import { courriels } from "./courriels";
import { synchroniserPieces } from "./generation";
import { inviterApprenant } from "./invitations";
import { lireOrganisme } from "./organisme";
import { manquesAvantSoumission, numeroSuivant } from "./pipeline";
import { lireEntreprise, lireStagiaire } from "./repertoire";
import { lireFormation } from "./formations";
import { reprendrePositionnements } from "./positionnements";
import { envoyerFormulairesAutomatiques } from "./formulaires-apprenant";
import {
  ErreurMetier,
  exigerFormateurValide,
  interdit,
  invalide,
  journaliser,
  type Acteur,
  type Services,
} from "./socle";

const dateIso = z.union([
  z.literal(""),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ"),
]);
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure attendue au format HH:MM");
const centimes = z.number().int().min(0).max(100_000_000).nullable();
const heures = z.number().min(0).max(2000).nullable();

/** F-DOS-02 : l'apprenant, son entreprise, la formation, la modalité, le financement — dans cet ordre. */
export const SchemaCreationDossier = z.object({
  stagiaire_ids: z
    .array(z.string())
    .min(1, "Sélectionnez au moins un apprenant.")
    .max(8, "Un dossier compte 8 apprenants au plus."),
  entreprise_id: z.string().min(1, "Sélectionnez l'entreprise."),
  formation_id: z.string().min(1, "Sélectionnez la formation."),
  formation_modalite: z.enum(["presentiel", "distanciel", "mixte"]),
  mode_financement: z.enum(["opco", "faf", "entreprise", "fonds_propres"]),
});

export const SchemaDossier = z
  .object({
    formation_titre: z.string().trim().max(200),
    formation_objectifs: z.string().trim().max(4000),
    formation_objectifs_atteints: z.string().trim().max(4000),
    formation_niveau: z.string().trim().max(100),
    formation_prerequis: z.string().trim().max(2000),
    formation_public_vise: z.string().trim().max(2000),
    formation_programme: z.string().trim().max(20000),
    formation_duree_heures_total: heures,
    formation_duree_jours: heures,
    formation_duree_heures_presentiel: heures,
    formation_duree_heures_distanciel: heures,
    formation_modalite: z.enum(["presentiel", "distanciel", "mixte"]),
    formation_lieu_nom: z.string().trim().max(200),
    formation_lieu_adresse: z.string().trim().max(400),
    formation_lieu_siret: z.string().trim().max(20),
    formation_lien_visio: z.union([
      z.literal(""),
      z.string().trim().url("Lien de connexion invalide.").max(500),
    ]),
    formation_date_debut: dateIso,
    formation_date_fin: dateIso,
    formation_opco: z.string().trim().max(200),
    formation_prix_unitaire_ht: centimes,
    formation_prix_presentiel_ht: centimes,
    signature_lieu: z.string().trim().max(120),
    mode_financement: z.enum(["opco", "faf", "entreprise", "fonds_propres"]),
  })
  .partial();

export const SchemaSeances = z
  .array(
    z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), heure_debut: heure, heure_fin: heure })
      .refine((x) => x.heure_fin > x.heure_debut, "L'heure de fin doit suivre l'heure de début."),
  )
  .max(20, "Un planning compte 20 séances au plus.");

/** Modèle d'outil à rattacher au dossier : celui de la formation s'il existe, sinon le plus récent du formateur. */
async function modelePour(
  s: Services,
  formateur_id: string,
  formation_id: string,
  type: "positionnement" | "acquis",
): Promise<Questionnaire | null> {
  const modeles = await s.bd
    .select()
    .from(modeleOutil)
    .where(
      and(
        eq(modeleOutil.formateur_id, formateur_id),
        eq(modeleOutil.type, type),
        isNull(modeleOutil.archive_le),
      ),
    )
    .orderBy(desc(modeleOutil.cree_le));
  const choisi =
    modeles.find((m) => m.formation_id === formation_id) ?? modeles.find((m) => m.formation_id === null);
  return (choisi?.contenu as Questionnaire | undefined) ?? null;
}

export async function creerDossier(s: Services, acteur: Acteur, donnees: unknown): Promise<LigneDossier> {
  const formateur_id = exigerFormateurValide(acteur);
  const v = SchemaCreationDossier.parse(donnees);
  if (new Set(v.stagiaire_ids).size !== v.stagiaire_ids.length)
    throw invalide("Un apprenant est sélectionné deux fois.");

  // Chaque lecture vérifie au passage que la fiche appartient bien à CE formateur (cloisonnement).
  const ent = await lireEntreprise(s, acteur, v.entreprise_id);
  const f = await lireFormation(s, acteur, v.formation_id);
  const stagiaires = [];
  for (const id of v.stagiaire_ids) stagiaires.push(await lireStagiaire(s, acteur, id));

  const id = nouvelId();
  const surSite = v.formation_modalite !== "distanciel";
  const total = f.formation_duree_heures_total;
  await s.bd.insert(dossierFormation).values({
    id,
    of_id: acteur.of_id,
    dossier_reference: await numeroSuivant(s, acteur.of_id, "ADF"),
    formateur_id,
    entreprise_id: ent.id,
    formation_id: f.id,
    mode_financement: v.mode_financement,
    // F-DOS-03 : tout ce qui est déjà connu est pré-renseigné, sous le nom des variables harmonisées.
    formation_titre: f.formation_titre,
    formation_objectifs: f.formation_objectifs,
    formation_niveau: f.formation_niveau,
    formation_prerequis: f.formation_prerequis,
    formation_public_vise: f.public_vise,
    formation_programme: f.programme,
    formation_duree_heures_total: total,
    formation_duree_jours: f.formation_duree_jours,
    // Répartition présentiel / distanciel : celle du catalogue si la modalité est la même, sinon déduite.
    formation_duree_heures_presentiel:
      v.formation_modalite === "presentiel"
        ? total
        : v.formation_modalite === "mixte"
          ? f.formation_duree_heures_presentiel
          : null,
    formation_duree_heures_distanciel:
      v.formation_modalite === "distanciel"
        ? total
        : v.formation_modalite === "mixte"
          ? f.formation_duree_heures_distanciel
          : null,
    formation_modalite: v.formation_modalite,
    // Lieu : celui du catalogue s'il est renseigné (salle louée, centre), sinon l'entreprise (intra).
    formation_lieu_nom: surSite ? f.formation_lieu_nom || ent.entreprise_nom : "",
    formation_lieu_adresse: surSite ? f.formation_lieu_adresse || ent.entreprise_adresse : "",
    formation_lieu_siret: surSite
      ? f.formation_lieu_nom
        ? f.formation_lieu_siret
        : ent.entreprise_siret
      : "",
    formation_lien_visio: v.formation_modalite !== "presentiel" ? f.formation_lien_visio : "",
    formation_opco:
      v.mode_financement === "opco" || v.mode_financement === "faf"
        ? ent.entreprise_opco || f.formation_opco
        : "",
    formation_prix_unitaire_ht: f.formation_prix_unitaire_ht,
    // Version 7 : plus de coût horaire saisi ; la rémunération du formateur se calcule par la commission de l'organisme.
    formateur_cout_horaire: null,
    questionnaire_positionnement: await modelePour(s, formateur_id, f.id, "positionnement"),
    questionnaire_acquis: await modelePour(s, formateur_id, f.id, "acquis"),
    cree_le: s.horloge.maintenant(),
    maj_le: s.horloge.maintenant(),
  });
  let rang = 1;
  for (const st of stagiaires) {
    await s.bd
      .insert(stagiaireDossier)
      .values({
        id: nouvelId(),
        dossier_id: id,
        stagiaire_id: st.id,
        poste_occupe: st.stagiaire_poste,
        rang: rang++,
      });
  }
  const d = await accederAuDossier(s, acteur, id);
  await synchroniserPieces(s, d);
  await journaliser(s, {
    of_id: acteur.of_id,
    dossier_id: id,
    acteur,
    type: "dossier_cree",
    libelle: `Dossier ${d.dossier_reference} créé`,
  });
  // « Modification 1 » : un positionnement déjà signé sur ce parcours est repris (recueil + test).
  await reprendrePositionnements(s, acteur, d);
  // Version 7 : ce qui n'est pas repris part aussitôt à l'apprenant en page interactive (lien personnel + PDF QR code).
  await envoyerFormulairesAutomatiques(s, d, ["recueil", "positionnement"]);
  return d;
}

/** Le dossier n'est modifiable qu'en brouillon par le formateur, et jusqu'à sa validation par l'admin. */
function exigerModifiable(acteur: Acteur, d: LigneDossier): void {
  const statut = d.sous_statut as SousStatut;
  if (acteur.role === "formateur" && statut === "brouillon") return;
  if (acteur.role === "admin" && (statut === "brouillon" || statut === "en_cours_validation")) return;
  throw new ErreurMetier(
    "conflit",
    "Ce dossier n'est plus modifiable à cette étape : les pièces émises font foi.",
  );
}

export async function modifierDossier(
  s: Services,
  acteur: Acteur,
  id: string,
  donnees: unknown,
): Promise<LigneDossier> {
  const d = await accederAuDossier(s, acteur, id);
  exigerModifiable(acteur, d);
  const valeurs = SchemaDossier.parse(donnees);
  if (Object.keys(valeurs).length > 0)
    await s.bd
      .update(dossierFormation)
      .set({ ...valeurs, maj_le: s.horloge.maintenant() })
      .where(eq(dossierFormation.id, id));
  return accederAuDossier(s, acteur, id);
}

/** Objectifs atteints : renseignés par le formateur en fin de formation, pour l'attestation (09-FIN). */
export async function renseignerObjectifsAtteints(
  s: Services,
  acteur: Acteur,
  id: string,
  texte: string,
): Promise<void> {
  if (acteur.role === "apprenant") throw interdit();
  const d = await accederAuDossier(s, acteur, id);
  if (estTerminal(d.sous_statut as SousStatut)) throw new ErreurMetier("conflit", "Ce dossier est archivé.");
  await s.bd
    .update(dossierFormation)
    .set({ formation_objectifs_atteints: texte.trim().slice(0, 4000), maj_le: s.horloge.maintenant() })
    .where(eq(dossierFormation.id, id));
}

export async function definirSeances(s: Services, acteur: Acteur, id: string, donnees: unknown) {
  const d = await accederAuDossier(s, acteur, id);
  exigerModifiable(acteur, d);
  const seances = SchemaSeances.parse(donnees);
  await s.bd.delete(seance).where(eq(seance.dossier_id, id));
  for (const se of seances) await s.bd.insert(seance).values({ id: nouvelId(), dossier_id: id, ...se });
  return seancesDuDossier(s, id);
}

export async function definirStagiaires(s: Services, acteur: Acteur, id: string, stagiaireIds: string[]) {
  const d = await accederAuDossier(s, acteur, id);
  if (acteur.role !== "formateur" || d.sous_statut !== "brouillon")
    throw new ErreurMetier("conflit", "Les apprenants ne se modifient qu'en brouillon.");
  if (
    stagiaireIds.length < 1 ||
    stagiaireIds.length > 8 ||
    new Set(stagiaireIds).size !== stagiaireIds.length
  )
    throw invalide("Un dossier compte de 1 à 8 apprenants distincts.");
  const fiches = [];
  for (const sid of stagiaireIds) fiches.push(await lireStagiaire(s, acteur, sid));
  const actuels = await stagiairesDuDossier(s, id);
  const retires = actuels.filter((l) => !stagiaireIds.includes(l.st.id)).map((l) => l.st.id);
  if (retires.length > 0) {
    await s.bd
      .delete(pieceDossier)
      .where(and(eq(pieceDossier.dossier_id, id), inArray(pieceDossier.stagiaire_id, retires)));
    await s.bd
      .delete(stagiaireDossier)
      .where(and(eq(stagiaireDossier.dossier_id, id), inArray(stagiaireDossier.stagiaire_id, retires)));
  }
  let rang = 1;
  for (const st of fiches) {
    await s.bd
      .insert(stagiaireDossier)
      .values({ id: nouvelId(), dossier_id: id, stagiaire_id: st.id, poste_occupe: st.stagiaire_poste, rang })
      .onConflictDoUpdate({
        target: [stagiaireDossier.dossier_id, stagiaireDossier.stagiaire_id],
        set: { rang },
      });
    rang++;
  }
  await synchroniserPieces(s, d);
}

/** Un brouillon se supprime (irritant relevé par l'audit : « impossible de supprimer un brouillon »). Rien d'autre. */
export async function supprimerBrouillon(s: Services, acteur: Acteur, id: string): Promise<void> {
  const d = await accederAuDossier(s, acteur, id);
  if (acteur.role !== "formateur" || d.sous_statut !== "brouillon")
    throw new ErreurMetier("conflit", "Seul un dossier en brouillon peut être supprimé, par son formateur.");
  await s.bd.delete(dossierFormation).where(eq(dossierFormation.id, id));
}

// ——— Lecture ———

const QUESTIONNAIRES = [
  { type: "recueil", code: "00-AVT" },
  { type: "positionnement", code: "01-AVT" },
  { type: "acquis", code: "07-FIN" },
  { type: "satisfaction_chaud", code: "08-FIN" },
  { type: "satisfaction_froid", code: "12-APR" },
] as const;

function vuePiece(p: typeof pieceDossier.$inferSelect, acteur: Acteur, ouvert: boolean) {
  const def = definitionPiece(p.code as CodePiece);
  const peutRetourner = ouvert && p.statut !== "valide" && peutValider(def.code, acteur.role);
  return {
    id: p.id,
    code: def.code,
    libelle: def.libelle,
    espace: def.espace,
    ordre: def.ordre ?? null,
    phase: def.phase,
    stagiaire_id: p.stagiaire_id,
    suivi: def.suiviStatut,
    statut: def.suiviStatut ? p.statut : null,
    libelle_statut: def.suiviStatut
      ? LIBELLE_STATUT[p.statut]
      : p.transmise_le
        ? "Transmis"
        : "À transmettre",
    mode: def.mode,
    disponible: def.mode === "generee" || p.chemin_retour !== null,
    a_un_retour: p.chemin_retour !== null,
    mode_retour: p.mode_retour,
    retour_le: p.retour_le,
    genere_le: p.genere_le,
    transmise_le: p.transmise_le,
    // Ce que CET acteur peut faire maintenant — l'interface n'a rien à deviner.
    // Signature en ligne : l'apprenant signe ses pièces ; le formateur ne signe que SON ordre de mission
    // (il peut en revanche DÉPOSER la feuille d'émargement papier signée en salle).
    peut_signer:
      peutRetourner &&
      def.mode === "generee" &&
      (acteur.role === "apprenant"
        ? !["00-AVT", "01-AVT", "08-FIN", "12-APR"].includes(def.code)
        : acteur.role === "formateur" && def.code === "04-AVT"),
    peut_deposer: peutRetourner,
  };
}

export async function lireDossier(s: Services, acteur: Acteur, id: string) {
  const d = await accederAuDossier(s, acteur, id);
  await synchroniserPieces(s, d);
  const statut = d.sous_statut as SousStatut;
  const [agregat, contexte, toutesLesPieces, liens] = await Promise.all([
    chargerAgregat(s, d),
    chargerContextePipeline(s, d),
    s.bd.select().from(pieceDossier).where(eq(pieceDossier.dossier_id, d.id)),
    stagiairesDuDossier(s, d.id),
  ]);
  const ordre = new Map(NOMENCLATURE.map((def, i) => [def.code, i]));
  const pieces = toutesLesPieces
    .filter((p) => peutVoir({ code: p.code as CodePiece, stagiaire_id: p.stagiaire_id }, acteur))
    .sort(
      (a, b) =>
        ordre.get(a.code as CodePiece)! - ordre.get(b.code as CodePiece)! ||
        (a.stagiaire_id ?? "").localeCompare(b.stagiaire_id ?? ""),
    )
    .map((p) => vuePiece(p, acteur, !estTerminal(statut)));

  const interne = acteur.role !== "apprenant";
  return {
    id: d.id,
    dossier_reference: d.dossier_reference,
    sous_statut: statut,
    libelle_statut: libelleSousStatut(statut),
    etape: etapeDe(statut),
    archive: estTerminal(statut),
    mode_financement: d.mode_financement,
    coffre_ouvert: d.coffre_ouvert,
    motif_renvoi: interne ? d.motif_renvoi : "",
    motif_refus: interne ? d.motif_refus : "",
    formation: agregat.formation,
    entreprise: agregat.entreprise,
    formateur: {
      prenom: agregat.formateur.formateur_prenom,
      nom: agregat.formateur.formateur_nom,
      email: agregat.formateur.formateur_email,
      telephone: agregat.formateur.formateur_telephone,
    },
    stagiaires: liens
      .filter((l) => interne || l.st.id === acteur.stagiaire_id)
      .map((l) => ({
        id: l.st.id,
        prenom: l.st.stagiaire_prenom,
        nom: l.st.stagiaire_nom,
        email: l.st.stagiaire_email,
        poste: l.lien.poste_occupe,
        a_un_compte: l.st.utilisateur_id !== null,
        heures_realisees: agregat.heures_realisees?.[l.st.id] ?? 0,
      })),
    seances: agregat.seances,
    pieces,
    questionnaires: {
      positionnement: d.questionnaire_positionnement !== null,
      acquis: d.questionnaire_acquis !== null,
    },
    // État des questionnaires en ligne, par stagiaire : ouvert ? renseigné ? validé ? (l'apprenant ne voit que les siens)
    questionnaires_etat: liens
      .filter((l) => interne || l.st.id === acteur.stagiaire_id)
      .flatMap((l) =>
        QUESTIONNAIRES.map((q) => {
          const p = toutesLesPieces.find((x) => x.code === q.code && x.stagiaire_id === l.st.id);
          return {
            stagiaire_id: l.st.id,
            type: q.type,
            ouvert: p !== undefined && !estTerminal(statut),
            valide: p?.statut === "valide",
            retour_le: p?.retour_le ?? null,
          };
        }),
      ),
    // Questionnaires déjà renseignés (l'apprenant ne voit que les siens).
    evaluations: (
      await s.bd
        .select({
          stagiaire_id: evaluation.stagiaire_id,
          type: evaluation.type,
          date: evaluation.date,
          score: evaluation.score,
        })
        .from(evaluation)
        .where(eq(evaluation.dossier_id, d.id))
    ).filter((e) => interne || e.stagiaire_id === acteur.stagiaire_id),
    // Réservé au formateur et à l'admin : finances, actions de pipeline, journal.
    finances: interne ? calculer(agregat) : null,
    // Formateur et admin : toutes leurs actions. Apprenant : seulement les siennes (déclarer la demande de financement déposée).
    actions: actionsPossibles(contexte, acteur.role),
    // Parcours de l'apprenant, section par section (cahier des charges oral du 23/09/2026) — un par stagiaire visible.
    parcours: liens
      .filter((l) => interne || l.st.id === acteur.stagiaire_id)
      .map((l) => ({
        stagiaire_id: l.st.id,
        sections: sectionsParcours({
          sous_statut: statut,
          pieces: contexte.pieces.filter((p) => p.stagiaire_id === null || p.stagiaire_id === l.st.id),
          recueil_renseigne: toutesLesPieces.some(
            (p) => p.code === "00-AVT" && p.stagiaire_id === l.st.id && p.statut === "valide",
          ),
          positionnement_renseigne: toutesLesPieces.some(
            (p) => p.code === "01-AVT" && p.stagiaire_id === l.st.id && p.statut === "valide",
          ),
          positionnement_prevu: d.questionnaire_positionnement !== null,
        }),
      })),
    manques_soumission: interne && statut === "brouillon" ? await manquesAvantSoumission(s, d) : [],
    manques_completude: interne
      ? piecesManquantesPourCompletude(contexte.pieces, contexte.stagiaire_ids).map((p) => ({
          ...p,
          libelle: definitionPiece(p.code).libelle,
        }))
      : [],
    journal: interne
      ? await s.bd
          .select()
          .from(evenement)
          .where(eq(evenement.dossier_id, d.id))
          .orderBy(desc(evenement.cree_le))
          .limit(100)
      : [],
  };
}

/** F-CRM-01/02 : les cartes du pipeline. Formateur : ses dossiers ; admin : ceux de l'organisme ; apprenant : les siens. */
export async function listerDossiers(s: Services, acteur: Acteur) {
  let dossiers: LigneDossier[];
  if (acteur.role === "admin") {
    dossiers = await s.bd
      .select()
      .from(dossierFormation)
      .where(eq(dossierFormation.of_id, acteur.of_id))
      .orderBy(desc(dossierFormation.maj_le));
  } else if (acteur.role === "formateur") {
    const formateur_id = exigerFormateurValide(acteur);
    dossiers = await s.bd
      .select()
      .from(dossierFormation)
      .where(eq(dossierFormation.formateur_id, formateur_id))
      .orderBy(desc(dossierFormation.maj_le));
  } else {
    if (!acteur.stagiaire_id) return { etapes: ETAPES, sous_statuts: SOUS_STATUTS, dossiers: [] };
    const liens = await s.bd
      .select({ id: stagiaireDossier.dossier_id })
      .from(stagiaireDossier)
      .where(eq(stagiaireDossier.stagiaire_id, acteur.stagiaire_id));
    dossiers = liens.length
      ? await s.bd
          .select()
          .from(dossierFormation)
          .where(
            inArray(
              dossierFormation.id,
              liens.map((l) => l.id),
            ),
          )
          .orderBy(desc(dossierFormation.maj_le))
      : [];
  }
  if (dossiers.length === 0) return { etapes: ETAPES, sous_statuts: SOUS_STATUTS, dossiers: [] };

  const ids = dossiers.map((d) => d.id);
  const [liens, pieces, formateurs] = await Promise.all([
    s.bd
      .select({ lien: stagiaireDossier, st: stagiaire })
      .from(stagiaireDossier)
      .innerJoin(stagiaire, eq(stagiaire.id, stagiaireDossier.stagiaire_id))
      .where(inArray(stagiaireDossier.dossier_id, ids)),
    s.bd.select().from(pieceDossier).where(inArray(pieceDossier.dossier_id, ids)),
    s.bd.select().from(formateur).where(eq(formateur.of_id, acteur.of_id)),
  ]);

  return {
    etapes: ETAPES,
    sous_statuts: SOUS_STATUTS,
    dossiers: dossiers.map((d) => {
      const statut = d.sous_statut as SousStatut;
      // Avancement affiché sur la carte : les pièces SUIVIES des deux espaces de communication (les enquêtes de
      // satisfaction, gérées à part, ne font pas « reculer » un dossier archivé).
      const suivies = pieces.filter(
        (p) =>
          p.dossier_id === d.id &&
          definitionPiece(p.code as CodePiece).suiviStatut &&
          definitionPiece(p.code as CodePiece).espace !== null &&
          peutVoir({ code: p.code as CodePiece, stagiaire_id: p.stagiaire_id }, acteur),
      );
      const form = formateurs.find((f) => f.id === d.formateur_id);
      return {
        id: d.id,
        dossier_reference: d.dossier_reference,
        sous_statut: statut,
        libelle_statut: libelleSousStatut(statut),
        etape: etapeDe(statut),
        archive: estTerminal(statut),
        formation_titre: d.formation_titre,
        formation_date_debut: d.formation_date_debut,
        formation_date_fin: d.formation_date_fin,
        apprenants: liens
          .filter((l) => l.lien.dossier_id === d.id)
          .sort((a, b) => a.lien.rang - b.lien.rang)
          .map((l) => `${l.st.stagiaire_prenom} ${l.st.stagiaire_nom}`),
        formateur: form ? `${form.formateur_prenom} ${form.formateur_nom}` : "",
        pieces_validees: suivies.filter((p) => p.statut === "valide").length,
        pieces_total: suivies.length,
        maj_le: d.maj_le,
      };
    }),
  };
}

/** F-COM-05 : invitation de l'apprenant à son espace. */
export async function inviter(
  s: Services,
  acteur: Acteur,
  dossierId: string,
  stagiaireId: string,
): Promise<{ lien: string }> {
  if (acteur.role === "apprenant") throw interdit();
  const d = await accederAuDossier(s, acteur, dossierId);
  if (!(await stagiairesDuDossier(s, d.id)).some((l) => l.st.id === stagiaireId))
    throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  const lien = await inviterApprenant(s, d, stagiaireId);
  await journaliser(s, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "invitation",
    libelle: "Invitation envoyée à l'apprenant",
    detail: { stagiaire_id: stagiaireId },
  });
  return { lien };
}

/** F-CRM-06 : relance de l'apprenant depuis le pipeline, avec la liste exacte de ce qui est attendu de lui. */
export async function relancerApprenant(
  s: Services,
  acteur: Acteur,
  dossierId: string,
  stagiaireId: string,
): Promise<{ pieces: string[] }> {
  if (acteur.role === "apprenant") throw interdit();
  const d = await accederAuDossier(s, acteur, dossierId);
  const lien = (await stagiairesDuDossier(s, d.id)).find((l) => l.st.id === stagiaireId);
  if (!lien) throw invalide("Ce stagiaire n'est pas inscrit à ce dossier.");
  if (!lien.st.stagiaire_email) throw invalide("La fiche de l'apprenant ne comporte pas d'adresse e-mail.");

  const pieces = await s.bd.select().from(pieceDossier).where(eq(pieceDossier.dossier_id, d.id));
  const enAttente = pieces
    .filter((p) => p.statut === "en_attente" && (p.stagiaire_id === null || p.stagiaire_id === stagiaireId))
    .map((p) => definitionPiece(p.code as CodePiece))
    .filter((def) => def.suiviStatut && def.valideePar.includes("apprenant") && def.code !== "ACC")
    .map((def) => def.libelle);
  if (enAttente.length === 0)
    throw new ErreurMetier(
      "conflit",
      "Cet apprenant n'a aucun document en attente : la relance est inutile.",
    );

  const of = await lireOrganisme(s, d.of_id);
  const url = lien.st.utilisateur_id
    ? `${s.appUrl}/`
    : await inviterApprenant(s, d, stagiaireId, { sansEmail: true });
  const c = courriels.relanceApprenant({
    of_nom: of.of_nom,
    prenom: lien.st.stagiaire_prenom,
    formation: d.formation_titre,
    pieces: enAttente,
    lien: url,
  });
  await s.courrier.envoyer({
    of_id: d.of_id,
    dossier_id: d.id,
    type: "relance_apprenant",
    destinataire: lien.st.stagiaire_email,
    ...c,
  });
  await journaliser(s, {
    of_id: d.of_id,
    dossier_id: d.id,
    acteur,
    type: "relance",
    libelle: `Relance envoyée à ${lien.st.stagiaire_prenom} ${lien.st.stagiaire_nom}`,
    detail: { pieces: enAttente },
  });
  return { pieces: enAttente };
}

/** F-DOS-07 / RG-07 : repartir d'un dossier refusé pour en créer un NOUVEAU, sans lien de contrainte avec l'ancien. */
export async function recreerDepuis(s: Services, acteur: Acteur, dossierId: string): Promise<LigneDossier> {
  const source = await accederAuDossier(s, acteur, dossierId);
  if (!source.formation_id)
    throw new ErreurMetier("conflit", "La formation d'origine n'existe plus dans votre catalogue.");
  const liens = await stagiairesDuDossier(s, source.id);
  const nouveau = await creerDossier(s, acteur, {
    stagiaire_ids: liens.map((l) => l.st.id),
    entreprise_id: source.entreprise_id,
    formation_id: source.formation_id,
    formation_modalite: source.formation_modalite,
    mode_financement: source.mode_financement,
  });
  const {
    formation_lieu_nom,
    formation_lieu_adresse,
    formation_lieu_siret,
    formation_lien_visio,
    formation_opco,
    signature_lieu,
    formation_prix_unitaire_ht,
  } = source;
  await s.bd
    .update(dossierFormation)
    .set({
      formation_lieu_nom,
      formation_lieu_adresse,
      formation_lieu_siret,
      formation_lien_visio,
      formation_opco,
      signature_lieu,
      formation_prix_unitaire_ht,
    })
    .where(eq(dossierFormation.id, nouveau.id));
  return accederAuDossier(s, acteur, nouveau.id);
}
