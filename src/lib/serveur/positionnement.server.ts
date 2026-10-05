/**
 * Positionnement avant dossier — côté FORMATEUR (routes 80, 81 et lien du PDF de la route 83).
 *
 * Écritures sensibles faites avec le client « service » : le jeton est généré ici, seule son empreinte SHA-256 est
 * stockée (`positionnement.jeton_hash`) ; le trigger SQL `s4m_garde_positionnement` interdit au client de la toucher.
 * Le formateur ne reçoit le lien en clair qu'à l'envoi ou à la relance. L'acteur vient de `agirEnTantQue` (jeton de
 * session) ; chaque objet est relu filtré par organisme ET par formateur : un objet d'autrui est « introuvable ».
 */
import { courriels } from "@/domaine/courriels/modeles";
import { validerQuestionnaire, type Questionnaire } from "@/domaine/formulaires/qcm";
import {
  DUREE_LIEN_POSITIONNEMENT_MS,
  MESSAGE_PDF_INDISPONIBLE,
  questionsSupplementaires,
} from "@/domaine/positionnement/regles";
import type { Acteur, ActeurFormateurValide } from "./acteur.server";
import type { BdService } from "./bd.server";
import { ouvrirArchive } from "./archive.server";
import { urlApplication } from "./config.server";
import { envoyerCourrier } from "./courrier.server";
import { conflit, introuvable, invalide, leverSiErreurBd } from "./erreurs.server";
import { sha256Hex, jetonAleatoire } from "./hacheur.server";
import { journaliser } from "./journal.server";

export const MESSAGE_SANS_TEST =
  "Ce parcours n'a pas encore de test de positionnement : générez-le avec l'IA depuis la fiche formation (« Générer le test de positionnement »), enregistrez-le, puis invitez l'apprenant.";
const MESSAGE_SANS_EMAIL =
  "La fiche de l'apprenant n'a pas d'adresse e-mail : ajoutez-la pour pouvoir l'inviter.";
const MESSAGE_TEST_INCOMPLET =
  "Le test de positionnement de ce parcours est incomplet : corrigez-le dans « Mes outils pédagogiques », puis invitez l'apprenant.";

const nomComplet = (prenom?: string, nom?: string) => `${prenom ?? ""} ${nom ?? ""}`.trim();

const lienDe = async (jeton: string) => `${await urlApplication()}/positionnement/${jeton}`;

const dateLongueFr = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(d);

interface Fiche {
  id: string;
  of_id: string;
  formateur_id: string;
  formation_id: string | null;
  stagiaire_id: string;
  formation_titre: string;
  message: string;
  statut: string;
  archive_le: string | null;
}

/** Choisit le modèle d'outil du parcours, à défaut un modèle sans parcours (le plus récent d'abord). */
async function modele(
  bd: BdService,
  formateurId: string,
  formationId: string,
  type: "positionnement" | "recueil",
): Promise<{ contenu: unknown } | null> {
  const { data, error } = await bd
    .from("modele_outil")
    .select("id, formation_id, contenu")
    .eq("formateur_id", formateurId)
    .eq("type", type)
    .is("archive_le", null)
    .order("cree_le", { ascending: false });
  leverSiErreurBd(error, "lecture des modèles d'outils");
  const modeles = (data ?? []) as Array<{ formation_id: string | null; contenu: unknown }>;
  return (
    modeles.find((m) => m.formation_id === formationId) ??
    modeles.find((m) => m.formation_id === null) ??
    null
  );
}

async function envoyerInvitation(
  bd: BdService,
  acteur: ActeurFormateurValide,
  p: Fiche,
  jeton: string,
  expire: Date,
): Promise<void> {
  const [{ data: st }, { data: of }, { data: form }] = await Promise.all([
    bd
      .from("stagiaire")
      .select("stagiaire_prenom, stagiaire_nom, stagiaire_email")
      .eq("id", p.stagiaire_id)
      .eq("of_id", acteur.of_id)
      .maybeSingle(),
    bd.from("organisme_formation").select("of_nom").eq("id", acteur.of_id).maybeSingle(),
    bd
      .from("formateur")
      .select("formateur_prenom, formateur_nom")
      .eq("id", p.formateur_id)
      .maybeSingle(),
  ]);
  const s = st as {
    stagiaire_prenom: string;
    stagiaire_nom: string;
    stagiaire_email: string;
  } | null;
  if (!s?.stagiaire_email) throw invalide(MESSAGE_SANS_EMAIL);
  const c = courriels.invitationPositionnement({
    of_nom: (of as { of_nom?: string } | null)?.of_nom ?? "",
    prenom: s.stagiaire_prenom,
    nom: s.stagiaire_nom,
    email: s.stagiaire_email,
    formateur: nomComplet(
      (form as { formateur_prenom?: string } | null)?.formateur_prenom,
      (form as { formateur_nom?: string } | null)?.formateur_nom,
    ),
    formation: p.formation_titre,
    message: p.message,
    lien: await lienDe(jeton),
    expire: dateLongueFr(expire),
  });
  await envoyerCourrier(bd, {
    of_id: acteur.of_id,
    formateur_id: p.formateur_id,
    type: "invitation_positionnement",
    destinataire: s.stagiaire_email,
    ...c,
  });
}

/** Route 80 — le formateur invite un apprenant à se positionner sur un de ses parcours. */
export async function inviter(
  bd: BdService,
  acteur: ActeurFormateurValide,
  entree: { stagiaire_id: string; formation_id: string; message: string },
): Promise<{ id: string; lien: string; test_cree: boolean }> {
  const message = entree.message.trim();
  if (!entree.stagiaire_id.trim())
    throw invalide("Choisissez l'apprenant.", {
      champs: { stagiaire_id: "Choisissez l'apprenant." },
    });
  if (!entree.formation_id.trim())
    throw invalide("Choisissez le parcours de formation.", {
      champs: { formation_id: "Choisissez le parcours de formation." },
    });
  if (message.length > 1000)
    throw invalide("Le message est trop long (1 000 caractères au plus).", {
      champs: { message: "1 000 caractères au plus." },
    });

  // La fiche et le parcours doivent être CEUX du formateur : sinon « introuvable ».
  const { data: st, error: errSt } = await bd
    .from("stagiaire")
    .select("id, stagiaire_prenom, stagiaire_nom, stagiaire_email")
    .eq("id", entree.stagiaire_id)
    .eq("of_id", acteur.of_id)
    .eq("formateur_id", acteur.formateur_id)
    .maybeSingle();
  leverSiErreurBd(errSt, "lecture de la fiche apprenant");
  if (!st) throw introuvable("Fiche apprenant");
  const { data: f, error: errF } = await bd
    .from("formation")
    .select("id, formation_titre")
    .eq("id", entree.formation_id)
    .eq("of_id", acteur.of_id)
    .eq("formateur_id", acteur.formateur_id)
    .maybeSingle();
  leverSiErreurBd(errF, "lecture de la formation");
  if (!f) throw introuvable("Formation");
  const fiche = st as {
    id: string;
    stagiaire_prenom: string;
    stagiaire_nom: string;
    stagiaire_email: string;
  };
  const parcours = f as { id: string; formation_titre: string };
  if (!fiche.stagiaire_email) throw invalide(MESSAGE_SANS_EMAIL);

  // Pas de trame automatique : le test se génère depuis la fiche formation puis s'enregistre dans les outils.
  const test = await modele(bd, acteur.formateur_id, parcours.id, "positionnement");
  if (!test) throw invalide(MESSAGE_SANS_TEST);
  const questionnaire = test.contenu as Questionnaire | null;
  if (
    !questionnaire ||
    !Array.isArray(questionnaire.questions) ||
    typeof questionnaire.titre !== "string" ||
    validerQuestionnaire(questionnaire).length > 0
  )
    throw invalide(MESSAGE_TEST_INCOMPLET);
  const recueil = await modele(bd, acteur.formateur_id, parcours.id, "recueil");

  const jeton = jetonAleatoire();
  const id = crypto.randomUUID();
  const maintenant = new Date();
  const expire = new Date(maintenant.getTime() + DUREE_LIEN_POSITIONNEMENT_MS);
  const ligne: Fiche & Record<string, unknown> = {
    id,
    of_id: acteur.of_id,
    formateur_id: acteur.formateur_id,
    formation_id: parcours.id,
    stagiaire_id: fiche.id,
    jeton_hash: await sha256Hex(jeton),
    message,
    formation_titre: parcours.formation_titre,
    questionnaire,
    questions_recueil: questionsSupplementaires(recueil?.contenu),
    envoye_le: maintenant.toISOString(),
    expire_le: expire.toISOString(),
    statut: "envoye",
    archive_le: null,
  };
  const { error: errIns } = await bd.from("positionnement").insert(ligne);
  leverSiErreurBd(errIns, "création du positionnement");

  try {
    await journaliser(bd, {
      of_id: acteur.of_id,
      acteur,
      type: "positionnement_invite",
      libelle: `${nomComplet(fiche.stagiaire_prenom, fiche.stagiaire_nom)} invité(e) à se positionner sur « ${parcours.formation_titre} »`,
      detail: { positionnement_id: id },
    });
  } catch (e) {
    // Pas de lien actif sans trace : on retire la ligne qu'on vient de créer.
    await bd.from("positionnement").delete().eq("id", id);
    throw e;
  }
  await envoyerInvitation(bd, acteur, ligne, jeton, expire);
  return { id, lien: await lienDe(jeton), test_cree: false };
}

/** Route 81 — relance : un NOUVEAU lien part (l'ancien cesse de fonctionner), la validité repart pour 30 jours. */
export async function relancer(
  bd: BdService,
  acteur: ActeurFormateurValide,
  id: string,
): Promise<{ lien: string }> {
  const { data, error } = await bd
    .from("positionnement")
    .select(
      "id, of_id, formateur_id, formation_id, stagiaire_id, formation_titre, message, statut, archive_le",
    )
    .eq("id", id)
    .eq("of_id", acteur.of_id)
    .eq("formateur_id", acteur.formateur_id)
    .maybeSingle();
  leverSiErreurBd(error, "lecture du positionnement");
  const p = data as Fiche | null;
  if (!p) throw introuvable("Positionnement");
  if (p.statut === "complet") throw conflit("Ce positionnement est déjà complet.");
  if (p.archive_le)
    throw conflit("Ce positionnement est archivé : restaurez-le avant de relancer l'apprenant.");

  const jeton = jetonAleatoire();
  const maintenant = new Date();
  const expire = new Date(maintenant.getTime() + DUREE_LIEN_POSITIONNEMENT_MS);
  // Le filtre sur le statut évite qu'une signature simultanée soit écrasée par la relance.
  const { data: modifiees, error: errMaj } = await bd
    .from("positionnement")
    .update({
      jeton_hash: await sha256Hex(jeton),
      expire_le: expire.toISOString(),
      envoye_le: maintenant.toISOString(),
    })
    .eq("id", p.id)
    .neq("statut", "complet")
    .select("id");
  leverSiErreurBd(errMaj, "relance du positionnement");
  if (!(modifiees as unknown[] | null)?.length)
    throw conflit("Ce positionnement vient de changer d'état. Rechargez la page.");

  await journaliser(bd, {
    of_id: acteur.of_id,
    acteur,
    type: "positionnement_relance",
    libelle: `Positionnement relancé sur « ${p.formation_titre} »`,
    detail: { positionnement_id: p.id },
  });
  await envoyerInvitation(bd, acteur, p, jeton, expire);
  return { lien: await lienDe(jeton) };
}

/**
 * Route 83 — lien de téléchargement temporaire du document signé. L'accès est contrôlé ICI (organisme, et
 * propriétaire pour un formateur), puis le lien est signé avec le client « service » : la politique Storage de
 * `archive` ne couvre pas le dossier `<of_id>/positionnements/`.
 */
export async function urlPdf(
  bd: BdService,
  acteur: Acteur,
  id: string,
): Promise<{ url: string; nom: string }> {
  let requete = bd
    .from("positionnement")
    .select("id, chemin_pdf")
    .eq("id", id)
    .eq("of_id", acteur.of_id);
  if (acteur.role === "formateur") requete = requete.eq("formateur_id", acteur.formateur_id ?? "");
  const { data, error } = await requete.maybeSingle();
  leverSiErreurBd(error, "lecture du positionnement");
  const p = data as { chemin_pdf: string | null } | null;
  if (!p) throw introuvable("Positionnement");
  if (!p.chemin_pdf) throw conflit(MESSAGE_PDF_INDISPONIBLE);
  const nom = p.chemin_pdf.split("/").pop() ?? "positionnement.html";
  const url = await ouvrirArchive(bd, { ofId: acteur.of_id }).urlSignee(p.chemin_pdf, 60, nom);
  return { url, nom };
}
