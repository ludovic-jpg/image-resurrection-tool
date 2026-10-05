/**
 * Positionnement — côté APPRENANT, page publique par lien personnel (routes 10 à 13). AUCUN jeton de session.
 *
 * Sécurité :
 *   • le lien est un jeton aléatoire de 256 bits ; seule son empreinte SHA-256 est en base. On retrouve la ligne par
 *     `jeton_hash` ; un jeton inconnu, archivé ou mal formé donne la même réponse (« lien introuvable ») ;
 *   • l'accès aux tables se fait par le client « service » (aucun accès `anon` aux tables) : chaque réponse est
 *     CONSTRUITE champ par champ, jamais un `select *` renvoyé tel quel ;
 *   • le corrigé du QCM ne sort JAMAIS d'ici (`sansCorrige`) — ni avant ni après la signature ;
 *   • signature : score, document HTML scellé (SHA-256), archivage, journal (IP consignée) et deux e-mails.
 *
 * Les fonctions prennent le client et l'horloge en paramètres : testables sans réseau.
 */
import { courriels } from "@/domaine/courriels/modeles";
import type { FormulaireDef, TypeChamp } from "@/domaine/formulaires/definitions";
import { corriger, sansCorrige, type Questionnaire } from "@/domaine/formulaires/qcm";
import { nomSur } from "@/domaine/archive/chemins";
import { documentPositionnement } from "@/domaine/positionnement/document";
import {
  MESSAGE_DEJA_SIGNE,
  MESSAGE_LIEN_EXPIRE,
  MESSAGE_LIEN_INVALIDE,
  MESSAGE_PDF_INDISPONIBLE,
  dateIsoParis,
  etatDuLien,
  formulaireRecueil,
  validerBrouillon,
  validerSignature,
} from "@/domaine/positionnement/regles";
import type { BdService } from "./bd.server";
import { ouvrirArchive } from "./archive.server";
import { urlApplication } from "./config.server";
import { envoyerCourrier } from "./courrier.server";
import { ErreurMetier, conflit, invalide, leverSiErreurBd } from "./erreurs.server";
import { sha256Hex } from "./hacheur.server";
import { journaliser } from "./journal.server";

interface Ligne {
  id: string;
  of_id: string;
  formateur_id: string;
  formation_id: string | null;
  stagiaire_id: string;
  statut: string;
  message: string;
  formation_titre: string;
  questionnaire: unknown;
  questions_recueil: unknown;
  brouillon: unknown;
  recueil: unknown;
  reponses: unknown;
  date_reponse: string;
  signature_lieu: string;
  signe_le: string | null;
  chemin_pdf: string | null;
  expire_le: string;
  archive_le: string | null;
}
interface Apprenant {
  id: string;
  entreprise_id: string | null;
  stagiaire_prenom: string;
  stagiaire_nom: string;
  stagiaire_email: string;
}

const COLONNES =
  "id, of_id, formateur_id, formation_id, stagiaire_id, statut, message, formation_titre, questionnaire, questions_recueil, brouillon, recueil, reponses, date_reponse, signature_lieu, signe_le, chemin_pdf, expire_le, archive_le";

const nomComplet = (prenom?: string, nom?: string) => `${prenom ?? ""} ${nom ?? ""}`.trim();
const questionnaireDe = (p: Ligne): Questionnaire | null => {
  const q = p.questionnaire as Questionnaire | null;
  return q && Array.isArray(q.questions) ? q : null;
};
const supplementairesDe = (p: Ligne): string[] =>
  Array.isArray(p.questions_recueil)
    ? (p.questions_recueil as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

/**
 * Retrouve le positionnement d'un lien. Jeton absent, inconnu ou archivé : « introuvable » sans autre détail. Lien
 * échu : message dédié (le porteur du lien est le seul à pouvoir le savoir). Un positionnement complet reste
 * consultable après l'échéance.
 */
async function parJeton(
  bd: BdService,
  jeton: string,
  maintenant: Date,
): Promise<{ p: Ligne; st: Apprenant }> {
  const propre = jeton.trim();
  if (propre.length < 16 || propre.length > 200)
    throw new ErreurMetier("introuvable", MESSAGE_LIEN_INVALIDE);
  const { data, error } = await bd
    .from("positionnement")
    .select(COLONNES)
    .eq("jeton_hash", await sha256Hex(propre))
    .maybeSingle();
  leverSiErreurBd(error, "lecture du positionnement");
  const p = (data as Ligne | null) ?? null;
  const etat = etatDuLien(p, maintenant);
  if (etat === "invalide" || !p) throw new ErreurMetier("introuvable", MESSAGE_LIEN_INVALIDE);
  if (etat === "expire") throw new ErreurMetier("introuvable", MESSAGE_LIEN_EXPIRE);
  const { data: st, error: errSt } = await bd
    .from("stagiaire")
    .select("id, entreprise_id, stagiaire_prenom, stagiaire_nom, stagiaire_email")
    .eq("id", p.stagiaire_id)
    .maybeSingle();
  leverSiErreurBd(errSt, "lecture de l'apprenant");
  if (!st) throw new ErreurMetier("introuvable", MESSAGE_LIEN_INVALIDE);
  return { p, st: st as Apprenant };
}

/** Le recueil tel que la page le reçoit (tableaux modifiables : forme du JSON reçu par l'écran). */
export interface RecueilPublic {
  code: FormulaireDef["code"];
  titre: string;
  introduction: string;
  champs: Array<{
    id: string;
    libelle: string;
    type: TypeChamp;
    options?: string[];
    requis?: boolean;
  }>;
}

function recueilPublic(supplementaires: readonly string[]): RecueilPublic {
  const def = formulaireRecueil(supplementaires);
  return {
    code: def.code,
    titre: def.titre,
    introduction: def.introduction,
    champs: def.champs.map(({ options, ...c }) => (options ? { ...c, options: [...options] } : c)),
  };
}

export interface PositionnementPublicDonnees {
  statut: "envoye" | "en_cours" | "complet";
  organisme: { nom: string; couleur: string };
  formateur: string;
  formation_titre: string;
  message: string;
  apprenant: { prenom: string; nom: string; email: string };
  recueil: RecueilPublic;
  /** Le test SANS les bonnes réponses. */
  questionnaire: ReturnType<typeof sansCorrige> | null;
  brouillon: {
    recueil?: Record<string, string>;
    reponses?: Array<number | null>;
    date?: string;
  } | null;
  reponses_signees: {
    recueil: Record<string, string> | null;
    reponses: Array<number | null> | null;
    date: string;
    lieu: string;
    signe_le: string | null;
  } | null;
  aujourdhui: string;
  pdf: boolean;
}

/** Route 10 — lecture de la page : le corrigé est retiré. */
export async function lirePublic(
  bd: BdService,
  jeton: string,
  maintenant = new Date(),
): Promise<PositionnementPublicDonnees> {
  const { p, st } = await parJeton(bd, jeton, maintenant);
  const [{ data: of }, { data: form }] = await Promise.all([
    bd.from("organisme_formation").select("of_nom, couleur").eq("id", p.of_id).maybeSingle(),
    bd
      .from("formateur")
      .select("formateur_prenom, formateur_nom")
      .eq("id", p.formateur_id)
      .maybeSingle(),
  ]);
  const o = of as { of_nom?: string; couleur?: string } | null;
  const f = form as { formateur_prenom?: string; formateur_nom?: string } | null;
  const q = questionnaireDe(p);
  return {
    statut: p.statut as PositionnementPublicDonnees["statut"],
    organisme: { nom: o?.of_nom ?? "", couleur: o?.couleur ?? "" },
    formateur: nomComplet(f?.formateur_prenom, f?.formateur_nom),
    formation_titre: p.formation_titre,
    message: p.message,
    apprenant: {
      prenom: st.stagiaire_prenom,
      nom: st.stagiaire_nom,
      email: st.stagiaire_email,
    },
    recueil: recueilPublic(supplementairesDe(p)),
    questionnaire: q ? sansCorrige(q) : null,
    brouillon: (p.brouillon ?? null) as PositionnementPublicDonnees["brouillon"],
    reponses_signees:
      p.statut === "complet"
        ? {
            recueil: p.recueil as Record<string, string> | null,
            reponses: p.reponses as Array<number | null> | null,
            date: p.date_reponse,
            lieu: p.signature_lieu,
            signe_le: p.signe_le,
          }
        : null,
    aujourdhui: dateIsoParis(maintenant),
    pdf: Boolean(p.chemin_pdf),
  };
}

/** Route 11 — « enregistrer et reprendre plus tard » : rien n'est perdu, même en changeant d'appareil. */
export async function enregistrerBrouillon(
  bd: BdService,
  jeton: string,
  donnees: unknown,
  maintenant = new Date(),
): Promise<{ enregistre_le: string }> {
  const { p } = await parJeton(bd, jeton, maintenant);
  if (p.statut === "complet") throw conflit(MESSAGE_DEJA_SIGNE);
  const v = validerBrouillon(donnees);
  if (!v.ok) throw invalide(v.message);
  // Le filtre sur le statut : un brouillon tardif n'écrase jamais un positionnement signé entre-temps.
  const { data, error } = await bd
    .from("positionnement")
    .update({ brouillon: v.valeur, statut: "en_cours" })
    .eq("id", p.id)
    .neq("statut", "complet")
    .select("id");
  leverSiErreurBd(error, "enregistrement du brouillon");
  if (!(data as unknown[] | null)?.length) throw conflit(MESSAGE_DEJA_SIGNE);
  return { enregistre_le: maintenant.toISOString() };
}

/** Route 12 — signature : réponses contrôlées, score, document scellé, archivage, journal, deux e-mails. */
export async function signer(
  bd: BdService,
  jeton: string,
  donnees: unknown,
  adresseIp: string,
  maintenant = new Date(),
): Promise<{ statut: "complet" }> {
  const { p, st } = await parJeton(bd, jeton, maintenant);
  if (p.statut === "complet") throw conflit(MESSAGE_DEJA_SIGNE);

  const def = formulaireRecueil(supplementairesDe(p));
  const q = questionnaireDe(p);
  const v = validerSignature(donnees, def, q);
  if (!v.ok)
    throw invalide("Le positionnement est incomplet.", { erreurs: v.erreurs, champs: v.champs });
  const { recueil, reponses, date, trace_png, lieu } = v.valeur;
  const score = q ? corriger(q, reponses).score : null;

  const [{ data: of }, { data: ent }, { data: form }] = await Promise.all([
    bd.from("organisme_formation").select("of_nom, couleur").eq("id", p.of_id).maybeSingle(),
    st.entreprise_id
      ? bd
          .from("entreprise_cliente")
          .select("entreprise_nom")
          .eq("id", st.entreprise_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    bd
      .from("formateur")
      .select("formateur_prenom, formateur_nom, formateur_email")
      .eq("id", p.formateur_id)
      .maybeSingle(),
  ]);
  const o = of as { of_nom?: string; couleur?: string } | null;
  const apprenant = nomComplet(st.stagiaire_prenom, st.stagiaire_nom);
  const empreinteReponses = await sha256Hex(JSON.stringify({ recueil, reponses, date }));
  const html = documentPositionnement({
    of_nom: o?.of_nom ?? "",
    couleur: o?.couleur ?? "",
    formation: p.formation_titre,
    apprenant,
    email: st.stagiaire_email,
    entreprise: (ent as { entreprise_nom?: string } | null)?.entreprise_nom ?? "",
    def,
    recueil,
    questionnaire: q,
    reponses,
    score,
    date,
    lieu,
    signe_le: maintenant.toISOString(),
    trace_png,
    empreinte: empreinteReponses,
    reference: p.id,
  });
  const empreinteDocument = await sha256Hex(html);

  // Le chemin porte l'empreinte du document : deux signatures simultanées n'écrasent jamais le fichier de la gagnante.
  const archive = ouvrirArchive(bd, { ofId: p.of_id });
  const base = nomSur(`Positionnement ${apprenant} - ${p.formation_titre}`).slice(0, 100);
  const chemin = await archive.ecrire(
    `${p.of_id}/positionnements/${nomSur(p.id)}/${base}_${empreinteDocument.slice(0, 12)}.html`,
    html,
    "text/html; charset=utf-8",
  );
  const { data: gagnees, error } = await bd
    .from("positionnement")
    .update({
      statut: "complet",
      recueil,
      reponses,
      score,
      date_reponse: date,
      signature_png: trace_png,
      signature_lieu: lieu,
      signe_le: maintenant.toISOString(),
      chemin_pdf: chemin,
      empreinte_pdf: empreinteDocument,
      brouillon: null,
    })
    .eq("id", p.id)
    .neq("statut", "complet")
    .select("id");
  if (error || !(gagnees as unknown[] | null)?.length) {
    await archive.supprimer(chemin).catch(() => undefined);
    leverSiErreurBd(error, "enregistrement de la signature");
    throw conflit(MESSAGE_DEJA_SIGNE);
  }

  await journaliser(bd, {
    of_id: p.of_id,
    acteur: "systeme",
    type: "positionnement_signe",
    libelle: `Positionnement signé par ${apprenant} (« ${p.formation_titre} »)`,
    detail: { positionnement_id: p.id, adresse_ip: adresseIp, empreinte: empreinteReponses },
  });

  // Deux e-mails, document en pièce jointe. Un échec d'envoi ne défait JAMAIS la signature (il est tracé).
  const pj = [{ nom: chemin.split("/").pop() ?? "positionnement.html", chemin }];
  const racine = await urlApplication();
  const f = form as {
    formateur_prenom?: string;
    formateur_nom?: string;
    formateur_email?: string;
  } | null;
  if (f?.formateur_email) {
    const c = courriels.positionnementComplet({
      of_nom: o?.of_nom ?? "",
      prenom: f.formateur_prenom ?? "",
      apprenant,
      formation: p.formation_titre,
      score: score === null ? "—" : `${score} / 100`,
      lien: `${racine}/positionnements`,
    });
    await envoyerCourrier(bd, {
      of_id: p.of_id,
      formateur_id: p.formateur_id,
      type: "positionnement_complet",
      destinataire: f.formateur_email,
      ...c,
      pieces_jointes: pj,
    });
  }
  const conf = courriels.positionnementConfirmation({
    of_nom: o?.of_nom ?? "",
    prenom: st.stagiaire_prenom,
    formation: p.formation_titre,
    lien: `${racine}/positionnement/${jeton.trim()}`,
  });
  await envoyerCourrier(bd, {
    of_id: p.of_id,
    formateur_id: p.formateur_id,
    type: "positionnement_confirmation",
    destinataire: st.stagiaire_email,
    ...conf,
    pieces_jointes: pj,
  });
  return { statut: "complet" };
}

export interface FichierTelechargeable {
  nom: string;
  contenu: Uint8Array;
  type_mime: string;
}

/** Route 13 — le document signé, lu dans le bucket `archive` (pas de session côté apprenant). */
export async function fichierPublic(
  bd: BdService,
  jeton: string,
  maintenant = new Date(),
): Promise<FichierTelechargeable> {
  const { p } = await parJeton(bd, jeton, maintenant);
  if (!p.chemin_pdf) throw conflit(MESSAGE_PDF_INDISPONIBLE);
  const nom = p.chemin_pdf.split("/").pop() ?? "positionnement.html";
  return {
    nom,
    contenu: await ouvrirArchive(bd, { ofId: p.of_id }).lire(p.chemin_pdf),
    type_mime: nom.endsWith(".pdf") ? "application/pdf" : "text/html; charset=utf-8",
  };
}

/** Adresse IP de la requête en cours (Cloudflare : `cf-connecting-ip`), vide hors requête. */
export async function adresseIpDeLaRequete(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest()?.headers;
    const brute = h?.get("cf-connecting-ip") ?? h?.get("x-forwarded-for")?.split(",")[0] ?? "";
    return brute.trim().slice(0, 64);
  } catch {
    return "";
  }
}
