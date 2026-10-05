/**
 * Tâche quotidienne — équivalent serveur de `taches.ts` (ancien serveur : `setInterval` au démarrage).
 *
 * Il n'y a plus de processus résident : `pg_cron` + `pg_net` appellent chaque nuit la route `/api/taches-quotidiennes`
 * (voir `supabase/migrations/…_lot8_tache_quotidienne.sql` et `routes/api/taches-quotidiennes.ts`). Aucun acteur : tout
 * passe par le client « service », et chaque écriture est journalisée avec l'acteur « systeme ».
 *
 * Ce que fait la tâche — exactement ce que faisait `envoyerFormulairesProgrammes` :
 *   • satisfaction « à froid » 90 jours après la fin de la formation (pièce 12-APR) ;
 *   • UNE relance 7 jours après l'envoi des formulaires restés sans réponse.
 * Idempotente : relancée deux fois dans la journée, elle n'envoie rien de plus.
 *
 * Pas de purge : l'ancien `taches.ts` n'en avait aucune (la purge à 12 mois des positionnements non suivis est une
 * hypothèse du cahier des charges, H-31, non validée). Ne rien supprimer sans décision de l'organisme.
 *
 * L'ENVOI d'un formulaire est injectable (`options.envoyer`) : le lot « pièces et formulaires » y branchera son envoi
 * complet (document d'invitation, synchronisation des pièces). La version fournie ici renouvelle le lien, envoie
 * l'e-mail et journalise ; elle n'attache pas le document d'invitation.
 */
import { courriels } from "@/domaine/courriels/modeles";
import {
  aSatisfactionFroidDue,
  CONFIG_FORMULAIRES,
  DUREE_LIEN_FORMULAIRE_MS,
  estARelancer,
  estTypeFormulaire,
  formulaireOuvert,
  seuilFroid,
  seuilRelance,
  STATUTS_FORMATION_TERMINEE,
  type TypeFormulaire,
} from "@/domaine/taches/formulaires-programmes";
import { estTerminal, type SousStatut } from "@/domaine/pipeline/statuts";
import type { BdService } from "./bd.server";
import { urlApplication } from "./config.server";
import { envoyerCourrier } from "./courrier.server";
import { conflit, ErreurMetier, invalide, leverSiErreurBd } from "./erreurs.server";
import { jetonAleatoire, sha256Hex } from "./hacheur.server";
import { journaliser } from "./journal.server";
import { lireParLots, lireTout } from "./lecture.server";

type Ligne = Record<string, unknown>;

export interface EnvoiFormulaire {
  dossier: Ligne;
  stagiaire: Ligne;
  type: TypeFormulaire;
  relance: boolean;
}
/** Envoie (ou renvoie) un formulaire ; LÈVE une erreur métier si l'envoi n'a pas lieu d'être. */
export type EnvoyeurFormulaire = (
  bd: BdService,
  envoi: EnvoiFormulaire,
  maintenant: Date,
  appUrl: string,
) => Promise<void>;

export interface ResultatTaches {
  /** Satisfactions à froid envoyées. */
  froid: number;
  /** Relances envoyées. */
  relances: number;
  /** Envois de satisfaction à froid refusés (e-mail manquant exclu : il est ignoré sans bruit, comme avant). */
  echecs: number;
}

export interface OptionsTaches {
  maintenant?: Date;
  envoyer?: EnvoyeurFormulaire;
  appUrl?: string;
}

const dateFrLongue = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(d);

const texte = (v: unknown) => (typeof v === "string" ? v : "");

/** Version par défaut : lien renouvelé (45 jours), e-mail, journal. Reprend les contrôles de `envoyerFormulaire`. */
export const envoyerFormulaireProgramme: EnvoyeurFormulaire = async (
  bd,
  { dossier, stagiaire, type, relance },
  maintenant,
  appUrl,
) => {
  const config = CONFIG_FORMULAIRES[type];
  const dossierId = texte(dossier["id"]);
  const sousStatut = texte(dossier["sous_statut"]);
  if (estTerminal(sousStatut as SousStatut)) throw conflit("Ce dossier est archivé.");
  if (!formulaireOuvert(sousStatut, type))
    throw conflit(`« ${config.libelle} » n'est pas encore ouvert à cette étape du dossier.`);
  const nom = `${texte(stagiaire["stagiaire_prenom"])} ${texte(stagiaire["stagiaire_nom"])}`;
  if (!texte(stagiaire["stagiaire_email"]))
    throw invalide(`La fiche de ${nom} n'a pas d'adresse e-mail.`);
  if (
    (type === "positionnement" || type === "acquis") &&
    !dossier[type === "positionnement" ? "questionnaire_positionnement" : "questionnaire_acquis"]
  )
    throw conflit(`Aucun ${config.libelle.toLowerCase()} n'est rattaché à ce dossier.`);

  const { data: piece, error: errPiece } = await bd
    .from("piece_dossier")
    .select("id")
    .eq("dossier_id", dossierId)
    .eq("code", config.code)
    .eq("stagiaire_id", stagiaire["id"])
    .eq("statut", "valide")
    .limit(1);
  leverSiErreurBd(errPiece, "lecture de la pièce");
  if ((piece as unknown[] | null)?.length)
    throw conflit(`« ${config.libelle} » de ${nom} est déjà validé.`);

  const jeton = jetonAleatoire();
  const expire = new Date(maintenant.getTime() + DUREE_LIEN_FORMULAIRE_MS);
  const { data: existant, error: errExistant } = await bd
    .from("formulaire_apprenant")
    .select("*")
    .eq("dossier_id", dossierId)
    .eq("stagiaire_id", stagiaire["id"])
    .eq("type", type)
    .maybeSingle();
  leverSiErreurBd(errExistant, "lecture du formulaire");
  const empreinte = await sha256Hex(jeton);
  if (existant) {
    const e = existant as Ligne;
    const { error } = await bd
      .from("formulaire_apprenant")
      .update({
        jeton_hash: empreinte,
        statut: e["statut"] === "complet" ? "complet" : e["brouillon"] ? "en_cours" : "envoye",
        envois: Number(e["envois"] ?? 0) + 1,
        envoye_le: maintenant.toISOString(),
        expire_le: expire.toISOString(),
      })
      .eq("id", e["id"]);
    leverSiErreurBd(error, "renouvellement du lien");
  } else {
    const { error } = await bd.from("formulaire_apprenant").insert({
      of_id: dossier["of_id"],
      dossier_id: dossierId,
      stagiaire_id: stagiaire["id"],
      type,
      jeton_hash: empreinte,
      envois: 1,
      envoye_le: maintenant.toISOString(),
      expire_le: expire.toISOString(),
    });
    leverSiErreurBd(error, "création du formulaire");
  }

  const [{ data: of }, { data: formateur }] = await Promise.all([
    bd.from("organisme_formation").select("of_nom").eq("id", dossier["of_id"]).maybeSingle(),
    bd
      .from("formateur")
      .select("formateur_prenom, formateur_nom")
      .eq("id", dossier["formateur_id"])
      .maybeSingle(),
  ]);
  const f = (formateur ?? {}) as Ligne;
  const c = courriels.formulaireApprenant({
    of_nom: texte((of as Ligne | null)?.["of_nom"]),
    prenom: texte(stagiaire["stagiaire_prenom"]),
    formateur: `${texte(f["formateur_prenom"])} ${texte(f["formateur_nom"])}`.trim(),
    formation: texte(dossier["formation_titre"]),
    libelle: config.libelle,
    message: "",
    lien: `${appUrl}/formulaire/${jeton}`,
    expire: dateFrLongue(expire),
    relance,
  });
  const envoi = await envoyerCourrier(bd, {
    of_id: texte(dossier["of_id"]),
    dossier_id: dossierId,
    type: `formulaire_${type}`,
    destinataire: texte(stagiaire["stagiaire_email"]),
    ...c,
  });
  await journaliser(bd, {
    of_id: texte(dossier["of_id"]),
    dossier_id: dossierId,
    acteur: "systeme",
    type: "formulaire_envoye",
    libelle: `${config.libelle} ${relance ? "relancé" : "envoyé"} à ${nom}${envoi.statut === "echec" ? " (échec d'envoi de l'e-mail)" : ""}`,
    detail: { type, statut_envoi: envoi.statut },
  });
};

export async function executerTachesQuotidiennes(
  bd: BdService,
  options: OptionsTaches = {},
): Promise<ResultatTaches> {
  const maintenant = options.maintenant ?? new Date();
  const envoyer = options.envoyer ?? envoyerFormulaireProgramme;
  const appUrl = options.appUrl ?? (await urlApplication());
  const resultat: ResultatTaches = { froid: 0, relances: 0, echecs: 0 };

  // ——— Satisfaction à froid, J+90 ———
  const dossiers = (
    await lireTout<Ligne>(
      (de, a) =>
        bd
          .from("dossier_formation")
          .select("*")
          .in("sous_statut", [...STATUTS_FORMATION_TERMINEE])
          .neq("formation_date_fin", "")
          .lte("formation_date_fin", seuilFroid(maintenant))
          .order("id")
          .range(de, a),
      "lecture des dossiers terminés",
    )
  ).filter((d) =>
    aSatisfactionFroidDue(
      { sous_statut: texte(d["sous_statut"]), formation_date_fin: texte(d["formation_date_fin"]) },
      maintenant,
    ),
  );
  if (dossiers.length > 0) {
    const ids = dossiers.map((d) => texte(d["id"]));
    const [liens, existants, validees] = await Promise.all([
      lireParLots<Ligne>(
        ids,
        (lot, de, a) =>
          bd
            .from("stagiaire_dossier")
            .select("dossier_id, stagiaire_id, rang")
            .in("dossier_id", lot)
            .order("dossier_id")
            .order("rang")
            .order("id")
            .range(de, a),
        "lecture des inscriptions",
      ),
      lireParLots<Ligne>(
        ids,
        (lot, de, a) =>
          bd
            .from("formulaire_apprenant")
            .select("dossier_id, stagiaire_id")
            .in("dossier_id", lot)
            .eq("type", "satisfaction_froid")
            .order("id")
            .range(de, a),
        "lecture des formulaires",
      ),
      lireParLots<Ligne>(
        ids,
        (lot, de, a) =>
          bd
            .from("piece_dossier")
            .select("dossier_id, stagiaire_id")
            .in("dossier_id", lot)
            .eq("code", CONFIG_FORMULAIRES.satisfaction_froid.code)
            .eq("statut", "valide")
            .order("id")
            .range(de, a),
        "lecture des pièces",
      ),
    ]);
    const stagiaires = new Map(
      (
        await lireParLots<Ligne>(
          liens.map((l) => texte(l["stagiaire_id"])),
          (lot, de, a) => bd.from("stagiaire").select("*").in("id", lot).order("id").range(de, a),
          "lecture des stagiaires",
        )
      ).map((s) => [texte(s["id"]), s]),
    );
    const deja = new Set(existants.map((f) => `${f["dossier_id"]}/${f["stagiaire_id"]}`));
    const validees_ = new Set(validees.map((p) => `${p["dossier_id"]}/${p["stagiaire_id"]}`));
    for (const dossier of dossiers) {
      for (const lien of liens.filter((l) => l["dossier_id"] === dossier["id"])) {
        const stagiaire = stagiaires.get(texte(lien["stagiaire_id"]));
        const cle = `${dossier["id"]}/${lien["stagiaire_id"]}`;
        if (!stagiaire || !texte(stagiaire["stagiaire_email"])) continue;
        if (deja.has(cle) || validees_.has(cle)) continue;
        try {
          await envoyer(
            bd,
            { dossier, stagiaire, type: "satisfaction_froid", relance: false },
            maintenant,
            appUrl,
          );
          resultat.froid++;
        } catch (e) {
          resultat.echecs++;
          await journaliser(bd, {
            of_id: texte(dossier["of_id"]),
            dossier_id: texte(dossier["id"]),
            acteur: "systeme",
            type: "formulaire_non_envoye",
            libelle: `${CONFIG_FORMULAIRES.satisfaction_froid.libelle} non envoyé à ${texte(stagiaire["stagiaire_prenom"])} ${texte(stagiaire["stagiaire_nom"])} : ${e instanceof Error ? e.message : "erreur"}`,
          }).catch((err) => console.error("[taches] journal impossible", err));
        }
      }
    }
  }

  // ——— Relance unique, J+7 ———
  const aRelancer = (
    await lireTout<Ligne>(
      (de, a) =>
        bd
          .from("formulaire_apprenant")
          .select("*")
          .in("statut", ["envoye", "en_cours"])
          .eq("envois", 1)
          .lte("envoye_le", seuilRelance(maintenant).toISOString())
          .gt("expire_le", maintenant.toISOString())
          .order("id")
          .range(de, a),
      "lecture des formulaires à relancer",
    )
  ).filter(
    (f) =>
      estTypeFormulaire(texte(f["type"])) &&
      estARelancer(
        {
          statut: texte(f["statut"]),
          envois: Number(f["envois"]),
          envoye_le: typeof f["envoye_le"] === "string" ? f["envoye_le"] : null,
          expire_le: texte(f["expire_le"]),
        },
        maintenant,
      ),
  );
  if (aRelancer.length > 0) {
    const dossiersRelance = new Map(
      (
        await lireParLots<Ligne>(
          aRelancer.map((f) => texte(f["dossier_id"])),
          (lot, de, a) =>
            bd.from("dossier_formation").select("*").in("id", lot).order("id").range(de, a),
          "lecture des dossiers",
        )
      ).map((d) => [texte(d["id"]), d]),
    );
    const stagiairesRelance = new Map(
      (
        await lireParLots<Ligne>(
          aRelancer.map((f) => texte(f["stagiaire_id"])),
          (lot, de, a) => bd.from("stagiaire").select("*").in("id", lot).order("id").range(de, a),
          "lecture des stagiaires",
        )
      ).map((s) => [texte(s["id"]), s]),
    );
    for (const f of aRelancer) {
      const dossier = dossiersRelance.get(texte(f["dossier_id"]));
      const stagiaire = stagiairesRelance.get(texte(f["stagiaire_id"]));
      if (!dossier || !stagiaire) continue;
      try {
        await envoyer(
          bd,
          { dossier, stagiaire, type: texte(f["type"]) as TypeFormulaire, relance: true },
          maintenant,
          appUrl,
        );
        resultat.relances++;
      } catch (e) {
        // Pièce validée entre-temps, dossier archivé… : rien à relancer. Une vraie panne, elle, est tracée.
        if (!(e instanceof ErreurMetier)) console.error("[taches] relance impossible", e);
      }
    }
  }
  return resultat;
}
