/**
 * Lot 4 — lecture d'un dossier (route 89, « Client + RLS, noyau côté front »).
 *
 * Le gestionnaire reproduit `lireDossier` de `src/serveur/services/dossiers.ts` : même forme de réponse (type
 * `Dossier` de `src/client/api.ts`), mêmes calculs, tous faits avec le noyau (`actionsPossibles`, `peutVoir`,
 * `piecesManquantesPourCompletude`, `sectionsParcours`…). Le cloisonnement vient de la RLS : l'apprenant lit la vue
 * `dossier_formation_apprenant` (jamais la table : ni prix, ni corrigés, ni motifs), `formateur_public`, et ses seules
 * pièces / évaluations / pointages ; l'ODM, les factures, les finances, le journal et les données bancaires ne lui
 * sont jamais chargés. Aucune écriture ici : `synchroniserPieces` est fait par le serveur à chaque transition.
 *
 * Seule exception, côté serveur : les FINANCES. Le taux de commission et la TVA de l'organisme sont réservés à
 * l'administrateur par la RLS ; `lireFinancesDossier` (`src/lib/dossiers.functions.ts`) applique `calculer()` du noyau.
 */
import { manquesAvantSoumission } from "@/domaine/dossier/soumission";
import {
  QUESTIONNAIRES,
  dossierOuvert,
  heuresRealisees,
  vuePiece,
  type LignePieceBrute,
} from "@/domaine/dossier/lecture";
import { sectionsParcours } from "@/domaine/parcours/apprenant";
import {
  piecesManquantesPourCompletude,
  peutVoir,
  type PieceDuDossier,
} from "@/domaine/pieces/statut";
import {
  aAtteint,
  estTerminal,
  etapeDe,
  libelleSousStatut,
  type SousStatut,
} from "@/domaine/pipeline/statuts";
import { actionsPossibles, type ContexteDossier } from "@/domaine/pipeline/transitions";
import { NOMENCLATURE, definitionPiece, type CodePiece } from "@/domaine/referentiel/pieces";
import { lireFinancesDossier } from "@/lib/dossiers.functions";
import { appelerServeur } from "../appel-serveur";
import type { Dossier } from "../api";
import { bd } from "../bd";
import { acteurCourant, exiger, lire, type Acteur } from "./lot-2-commun";

type Ligne = Record<string, unknown>;

const NOMS_ENTREPRISE = [
  "entreprise_nom",
  "entreprise_nom_commercial",
  "entreprise_adresse",
  "entreprise_siret",
  "entreprise_representant_civilite",
  "entreprise_representant_prenom",
  "entreprise_representant_nom",
  "entreprise_representant_telephone",
  "entreprise_representant_email",
  "entreprise_opco",
] as const;

/** L'apprenant ne lit pas la fiche de l'entreprise (RLS) : on lui renvoie une fiche vide, de même forme. */
const entrepriseVide = () => ({
  ...Object.fromEntries(NOMS_ENTREPRISE.map((c) => [c, ""])),
  archive_le: null,
});

/** Colonnes que la vue de l'apprenant n'expose pas : elles prennent une valeur neutre, jamais la vraie. */
const COLONNES_MASQUEES = {
  formation_lieu_siret: "",
  formation_prix_unitaire_ht: null,
  formation_prix_presentiel_ht: null,
  formateur_cout_horaire: null,
  questionnaire_positionnement: null,
  questionnaire_acquis: null,
  motif_renvoi: "",
  motif_refus: "",
  entreprise_id: "",
};

const liste = async (requete: PromiseLike<{ data: unknown; error: unknown }>): Promise<Ligne[]> =>
  lire(await (requete as PromiseLike<{ data: Ligne[] | null; error: unknown }>)) ?? [];

/** Une seule ligne, ou `null` : la RLS décide de ce que l'acteur a le droit de lire. */
const unique = async (
  requete: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Ligne | null> =>
  lire(await (requete as PromiseLike<{ data: Ligne | null; error: unknown }>));

export async function lireDossier(id: string, acteurConnu?: Acteur): Promise<Dossier> {
  const acteur = acteurConnu ?? (await acteurCourant());
  const interne = acteur.role !== "apprenant";

  // Le dossier : la table sous RLS (admin de l'OF, formateur propriétaire validé) ou la vue sans prix de l'apprenant.
  const brut = exiger<Ligne>(
    await bd
      .from(interne ? "dossier_formation" : "dossier_formation_apprenant")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
    "Dossier",
  );
  const d: Ligne = interne ? brut : { ...COLONNES_MASQUEES, ...brut };
  const statut = d["sous_statut"] as SousStatut;

  const [liens, toutesLesPieces, seances, evaluationsBrutes, journal] = await Promise.all([
    liste(
      bd
        .from("stagiaire_dossier")
        .select("*")
        .eq("dossier_id", id)
        .order("rang", { ascending: true }),
    ),
    liste(bd.from("piece_dossier").select("*").eq("dossier_id", id)),
    liste(
      bd
        .from("seance")
        .select("*")
        .eq("dossier_id", id)
        .order("date", { ascending: true })
        .order("heure_debut", { ascending: true }),
    ),
    liste(bd.from("evaluation").select("stagiaire_id, type, date, score").eq("dossier_id", id)),
    interne
      ? liste(
          bd
            .from("evenement")
            .select("*")
            .eq("dossier_id", id)
            .order("cree_le", { ascending: false })
            .limit(100),
        )
      : Promise.resolve([] as Ligne[]),
  ]);

  const idsStagiaires = liens.map((l) => l["stagiaire_id"] as string);
  const [fiches, emargements, formateurLigne, entreprise] = await Promise.all([
    idsStagiaires.length
      ? liste(bd.from("stagiaire").select("*").in("id", idsStagiaires))
      : Promise.resolve([] as Ligne[]),
    seances.length
      ? liste(
          bd
            .from("emargement")
            .select("seance_id, stagiaire_id, signataire")
            .in(
              "seance_id",
              seances.map((s) => s["id"] as string),
            ),
        )
      : Promise.resolve([] as Ligne[]),
    // Apprenant : « carte de visite » seulement (formateur_public) — ni téléphone, ni coordonnées bancaires.
    unique(
      bd
        .from(interne ? "formateur" : "formateur_public")
        .select("*")
        .eq("id", d["formateur_id"] as string)
        .maybeSingle(),
    ),
    interne
      ? unique(
          bd
            .from("entreprise_cliente")
            .select("*")
            .eq("id", d["entreprise_id"] as string)
            .maybeSingle(),
        )
      : Promise.resolve(null),
  ]);
  const formateurFiche: Ligne = formateurLigne ?? {};

  const ficheDe = new Map(fiches.map((f) => [f["id"] as string, f]));
  const stagiairesVisibles = liens.filter(
    (l) => interne || l["stagiaire_id"] === acteur.stagiaire_id,
  );

  const pieces = toutesLesPieces as unknown as Array<LignePieceBrute & { dossier_id: string }>;
  const contexte: ContexteDossier = {
    sous_statut: statut,
    pieces: pieces.map((p) => ({
      code: p.code as CodePiece,
      stagiaire_id: p.stagiaire_id,
      statut: p.statut,
    })) satisfies PieceDuDossier[],
    stagiaire_ids: idsStagiaires,
  };

  const ordre = new Map(NOMENCLATURE.map((def, i) => [def.code, i]));
  const piecesVues = pieces
    .filter((p) => peutVoir({ code: p.code as CodePiece, stagiaire_id: p.stagiaire_id }, acteur))
    .sort(
      (a, b) =>
        (ordre.get(a.code as CodePiece) ?? 0) - (ordre.get(b.code as CodePiece) ?? 0) ||
        (a.stagiaire_id ?? "").localeCompare(b.stagiaire_id ?? ""),
    )
    .map((p) => vuePiece(p, acteur.role, dossierOuvert(statut)));

  // Questionnaires prévus pour la formation : colonnes du dossier (interne) ou RPC sans corrigé (apprenant).
  let positionnementPrevu: boolean;
  let acquisPrevu: boolean;
  if (interne) {
    positionnementPrevu = d["questionnaire_positionnement"] != null;
    acquisPrevu = d["questionnaire_acquis"] != null;
  } else {
    const prevu = async (type: string) => {
      const { data, error } = await bd.rpc("s4m_questionnaire", {
        p_dossier_id: id,
        p_type: type,
        p_stagiaire_id: null,
      });
      if (error) return false;
      return (data as { questionnaire?: unknown } | null)?.questionnaire != null;
    };
    [positionnementPrevu, acquisPrevu] = await Promise.all([
      prevu("positionnement"),
      prevu("acquis"),
    ]);
  }

  const evaluations = evaluationsBrutes.filter(
    (e) => interne || e["stagiaire_id"] === acteur.stagiaire_id,
  ) as Dossier["evaluations"];

  const heures = heuresRealisees({
    stagiaire_ids: stagiairesVisibles.map((l) => l["stagiaire_id"] as string),
    seances: seances as unknown as Array<{ id: string; heure_debut: string; heure_fin: string }>,
    emargements: emargements as unknown as Array<{
      seance_id: string;
      stagiaire_id: string;
      signataire: string;
    }>,
    feuilles: pieces.filter((p) => p.code === "06-PDT"),
    duree_totale: (d["formation_duree_heures_total"] as number | null) ?? null,
  });

  /** Une pièce que l'apprenant ne voit pas (recueil, positionnement, satisfactions) : on lit alors son évaluation. */
  const renseigne = (stagiaireId: string, code: CodePiece, type: string) =>
    toutesLesPieces.some(
      (p) => p["code"] === code && p["stagiaire_id"] === stagiaireId && p["statut"] === "valide",
    ) ||
    (!interne && evaluations.some((e) => e.stagiaire_id === stagiaireId && e.type === type));

  const manques_soumission =
    interne && statut === "brouillon"
      ? manquesAvantSoumission(d as never, entreprise as never, seances.length)
      : [];

  const finances = interne
    ? await appelerServeur(() => lireFinancesDossier({ data: { dossier_id: id } }))
    : null;

  const reponse: Dossier = {
    id: d["id"] as string,
    dossier_reference: d["dossier_reference"] as string,
    sous_statut: statut,
    libelle_statut: libelleSousStatut(statut),
    etape: etapeDe(statut),
    archive: estTerminal(statut),
    mode_financement: d["mode_financement"] as Dossier["mode_financement"],
    coffre_ouvert: d["coffre_ouvert"] as boolean,
    motif_renvoi: interne ? (d["motif_renvoi"] as string) : "",
    motif_refus: interne ? (d["motif_refus"] as string) : "",
    formation: d as Dossier["formation"],
    entreprise: (interne
      ? Object.fromEntries(
          [...NOMS_ENTREPRISE, "archive_le"].map((c) => [c, (entreprise ?? {})[c] ?? ""]),
        )
      : entrepriseVide()) as Dossier["entreprise"],
    formateur: {
      prenom: String(formateurFiche["formateur_prenom"] ?? ""),
      nom: String(formateurFiche["formateur_nom"] ?? ""),
      email: String(formateurFiche["formateur_email"] ?? ""),
      telephone: String(formateurFiche["formateur_telephone"] ?? ""),
    },
    stagiaires: stagiairesVisibles.map((l) => {
      const st = ficheDe.get(l["stagiaire_id"] as string) ?? {};
      return {
        id: l["stagiaire_id"] as string,
        prenom: String(st["stagiaire_prenom"] ?? ""),
        nom: String(st["stagiaire_nom"] ?? ""),
        email: String(st["stagiaire_email"] ?? ""),
        poste: l["poste_occupe"] as string,
        a_un_compte: (st["utilisateur_id"] ?? null) !== null,
        heures_realisees: heures[l["stagiaire_id"] as string] ?? 0,
      };
    }),
    seances: seances as Dossier["seances"],
    pieces: piecesVues,
    questionnaires: { positionnement: positionnementPrevu, acquis: acquisPrevu },
    // État des questionnaires en ligne, par stagiaire : ouvert ? renseigné ? validé ? (l'apprenant ne voit que les siens)
    questionnaires_etat: stagiairesVisibles.flatMap((l) =>
      QUESTIONNAIRES.map((q) => {
        const sid = l["stagiaire_id"] as string;
        const p = pieces.find((x) => x.code === q.code && x.stagiaire_id === sid);
        return {
          stagiaire_id: sid,
          type: q.type,
          // Pièce invisible pour l'apprenant : « ouverte » dès que le dossier a atteint son sous-statut de départ.
          ouvert: p
            ? !estTerminal(statut)
            : !interne &&
              aAtteint(statut, definitionPiece(q.code).disponibleDes) &&
              !estTerminal(statut),
          valide: p ? p.statut === "valide" : renseigne(sid, q.code, q.type),
          retour_le: p?.retour_le ?? null,
        };
      }),
    ),
    // Questionnaires déjà renseignés (l'apprenant ne voit que les siens).
    evaluations,
    // Réservé au formateur et à l'admin : finances, journal.
    finances,
    // Formateur et admin : toutes leurs actions. Apprenant : seulement les siennes (déclarer le dépôt de la demande).
    actions: actionsPossibles(contexte, acteur.role),
    // Parcours de l'apprenant, section par section — un par stagiaire visible.
    parcours: stagiairesVisibles.map((l) => {
      const sid = l["stagiaire_id"] as string;
      return {
        stagiaire_id: sid,
        sections: sectionsParcours({
          sous_statut: statut,
          pieces: contexte.pieces.filter((p) => p.stagiaire_id === null || p.stagiaire_id === sid),
          recueil_renseigne: renseigne(sid, "00-AVT", "recueil"),
          positionnement_renseigne: renseigne(sid, "01-AVT", "positionnement"),
          positionnement_prevu: positionnementPrevu,
        }).map((section) => ({ ...section, pieces: [...section.pieces] })),
      };
    }),
    manques_soumission,
    manques_completude: interne
      ? piecesManquantesPourCompletude(contexte.pieces, idsStagiaires).map((p) => ({
          ...p,
          libelle: definitionPiece(p.code).libelle,
        }))
      : [],
    journal: journal as Dossier["journal"],
  };
  return reponse;
}
