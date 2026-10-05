/**
 * Lot 5 — pièces de dossier : génération, retour (dépôt, signature), intégrité, émargement, questionnaires.
 *
 * Fonctions serveur (`src/lib/pieces.functions.ts`) : 99, 105, 107, 108, 109, 110, 111, 112, 113, 114.
 * Client + RLS : 104 (émargement du dossier) et 106 (RPC `s4m_questionnaire`, qui cloisonne elle-même).
 *
 * Formes de réponse du service Node (`retours.ts`, `evaluations.ts`), sauf deux adaptations de TRANSPORT, à cause du
 * navigateur : 108 et 105 renvoient `{ html }` (au lieu d'un corps HTML) et 109 renvoie `{ url, nom, type_mime }`
 * (une URL signée de 60 s, au lieu d'un flux) — voir le compte rendu du lot sur les liens `href`/`iframe` directs.
 */
import { estTypeEvaluation, formulaireDe } from "@/domaine/formulaires/evaluations";
import { dureeSeanceHeures } from "@/domaine/dossier/formats";
import {
  apercuPieceDossier,
  deposerPieceDossier,
  deposerPieceExterneDossier,
  emargerSeance,
  enregistrerQuestionnaire,
  integritePieceDossier,
  regenererPieceDossier,
  signerPieceDossier,
  telechargerPieceDossier,
  trameFactureDossier,
} from "@/lib/pieces.functions";
import { appelerServeur, corpsDe } from "../appel-serveur";
import { aiguiller } from "../aiguilleur";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import { acteurCourant, exiger, introuvable, invalide, lire } from "./lot-2-commun";

const texte = (v: unknown) => (typeof v === "string" ? v : "");

/** Le fichier du corps `FormData` envoyé par `api.fichier` (champ `fichier`). */
function formulaireFichier(corps: unknown, champs: Record<string, string>): FormData {
  if (!(corps instanceof FormData) || !(corps.get("fichier") instanceof File))
    throw invalide("Choisissez un fichier à déposer.");
  const form = new FormData();
  form.set("fichier", corps.get("fichier") as File);
  for (const [k, v] of Object.entries(champs)) form.set(k, v);
  return form;
}

// ——— Retour de pièces ———

route("POST", "/pieces/:id/signer", async ({ params, corps }) => {
  const c = corpsDe(corps);
  const r = await appelerServeur(() =>
    signerPieceDossier({
      data: {
        piece_id: params["id"] ?? "",
        trace_png: texte(c["trace_png"]),
        lieu: texte(c["lieu"]),
        consentement: c["consentement"] === true,
      },
    }),
  );
  return r.piece;
});

route("POST", "/pieces/:id/deposer", async ({ params, corps }) => {
  const r = await appelerServeur(() =>
    deposerPieceDossier({
      data: formulaireFichier(corps, { piece_id: params["id"] ?? "" }),
    }),
  );
  return r.piece;
});

route("POST", "/pieces/:id/regenerer", async ({ params }) => {
  const r = await appelerServeur(() =>
    regenererPieceDossier({ data: { piece_id: params["id"] ?? "" } }),
  );
  return r.piece;
});

route("POST", "/dossiers/:id/pieces-externes/:code", async ({ params, corps }) => {
  const dossierId = params["id"] ?? "";
  const r = await appelerServeur(() =>
    deposerPieceExterneDossier({
      data: formulaireFichier(corps, { dossier_id: dossierId, code: params["code"] ?? "" }),
    }),
  );
  // Le service Node renvoie le dossier à jour (route 87, lot 4) ; tant qu'elle n'est pas portée, la pièce.
  try {
    return await aiguiller("GET", `/dossiers/${encodeURIComponent(dossierId)}`);
  } catch (e) {
    if (e instanceof ErreurApi && e.statut === 501) return r.piece;
    throw e;
  }
});

route("GET", "/pieces/:id/apercu", async ({ params }) =>
  appelerServeur(() => apercuPieceDossier({ data: { piece_id: params["id"] ?? "" } })),
);

route("GET", "/pieces/:id/telecharger", async ({ params, requete }) =>
  appelerServeur(() =>
    telechargerPieceDossier({
      data: {
        piece_id: params["id"] ?? "",
        version: requete.get("version") === "retour" ? "retour" : "depart",
      },
    }),
  ),
);

route("GET", "/pieces/:id/integrite", async ({ params }) =>
  appelerServeur(() => integritePieceDossier({ data: { piece_id: params["id"] ?? "" } })),
);

route("GET", "/dossiers/:id/trame-facture", async ({ params }) =>
  appelerServeur(() => trameFactureDossier({ data: { dossier_id: params["id"] ?? "" } })),
);

// ——— Émargement ———

route("POST", "/seances/:id/emarger", async ({ params, corps }) => {
  const c = corpsDe(corps);
  return appelerServeur(() =>
    emargerSeance({
      data: {
        seance_id: params["id"] ?? "",
        trace_png: texte(c["trace_png"]),
        ...(typeof c["stagiaire_id"] === "string" ? { stagiaire_id: c["stagiaire_id"] } : {}),
      },
    }),
  );
});

/** Route 104 : séances du dossier et pointages visibles (la RLS limite l'apprenant à SES pointages). */
route("GET", "/dossiers/:id/emargement", async ({ params }) => {
  const dossierId = params["id"] ?? "";
  await acteurCourant();
  const seances = (lire(
    await bd
      .from("seance")
      .select("*")
      .eq("dossier_id", dossierId)
      .order("date", { ascending: true })
      .order("heure_debut", { ascending: true }),
  ) ?? []) as Array<{ id: string; heure_debut: string; heure_fin: string }>;
  // Un dossier non visible (autre formateur…) ne renvoie aucune séance : on le distingue d'un dossier sans séance.
  if (seances.length === 0) {
    const visible = (await bd.rpc("s4m_dossier_lisible", { p_dossier_id: dossierId })).data;
    if (visible !== true) throw introuvable("Dossier");
    return [];
  }
  const pointages = (lire(
    await bd
      .from("emargement")
      .select("seance_id, stagiaire_id, signataire, horodatage")
      .in(
        "seance_id",
        seances.map((s) => s.id),
      ),
  ) ?? []) as Array<{
    seance_id: string;
    stagiaire_id: string;
    signataire: string;
    horodatage: string;
  }>;
  return seances.map((se) => ({
    ...se,
    duree_heures: dureeSeanceHeures(se.heure_debut, se.heure_fin),
    signatures: pointages
      .filter((p) => p.seance_id === se.id)
      .map((p) => ({
        stagiaire_id: p.stagiaire_id,
        signataire: p.signataire,
        horodatage: new Date(p.horodatage).toISOString(),
      })),
  }));
});

// ——— Questionnaires ———

/** Route 106 : RPC `s4m_questionnaire` (SECURITY DEFINER, cloisonne elle-même ; corrigé retiré pour l'apprenant). */
route("GET", "/dossiers/:id/questionnaires/:type", async ({ params, requete }) => {
  const type = params["type"] ?? "";
  if (!estTypeEvaluation(type)) throw invalide("Type de questionnaire inconnu.");
  await acteurCourant();
  const { data, error } = await bd.rpc("s4m_questionnaire", {
    p_dossier_id: params["id"] ?? "",
    p_type: type,
    p_stagiaire_id: requete.get("stagiaire_id") || null,
  });
  if (error) {
    const m = error.message ?? "";
    if (/introuvable/i.test(m)) throw introuvable("Dossier");
    if (/interdit/i.test(m)) throw new ErreurApi("Accès interdit.", 403, "interdit", null);
    throw invalide(m || "Questionnaire illisible.");
  }
  // La RPC ne renvoie pas la définition des champs fixes : elle vient du noyau (même source que le service).
  return {
    ...(exiger({ data, error: null }, "Questionnaire") as object),
    formulaire: formulaireDe(type),
  };
});

route("POST", "/dossiers/:id/questionnaires/:type", async ({ params, corps }) => {
  const c = corpsDe(corps);
  return appelerServeur(() =>
    enregistrerQuestionnaire({
      data: {
        dossier_id: params["id"] ?? "",
        type: params["type"] ?? "",
        reponses: c["reponses"],
        ...(typeof c["ajustement"] === "string" ? { ajustement: c["ajustement"] } : {}),
      },
    }),
  );
});
