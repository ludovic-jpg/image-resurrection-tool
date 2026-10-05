/**
 * API HTTP (Hono). Couche volontairement MINCE : elle authentifie, lit la requête, appelle un service,
 * traduit les erreurs. Aucune règle métier ici — elles sont dans `src/domaine` et `src/serveur/services`.
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { desc, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { NOMENCLATURE } from "@/domaine/referentiel/pieces";
import { ETAPES, SOUS_STATUTS } from "@/domaine/pipeline/statuts";
import type { Action } from "@/domaine/pipeline/transitions";
import { REGLES } from "@/domaine/pipeline/transitions";
import { courrier, dossierFormation } from "../bd/schema";
import * as auth from "../services/auth";
import * as candidatures from "../services/candidatures";
import * as formations from "../services/formations";
import * as repertoire from "../services/repertoire";
import * as dossiers from "../services/dossiers";
import * as retours from "../services/retours";
import * as evaluations from "../services/evaluations";
import * as organisme from "../services/organisme";
import * as bpf from "../services/bpf";
import * as rgpd from "../services/rgpd";
import * as pedagogieIa from "../services/pedagogie-ia";
import * as coffre from "../services/coffre";
import * as positionnements from "../services/positionnements";
import * as sauvegarde from "../services/sauvegarde";
import * as reglages from "../services/reglages";
import * as formulaires from "../services/formulaires-apprenant";
import { executerAction } from "../services/pipeline";
import { TAILLE_MAX_COFFRE, type FichierDepose } from "../services/fichiers";
import { ErreurMetier, exigerRole, invalide, type Acteur, type CodeErreur, type Services } from "../services/socle";

const COOKIE = "s4m_session";
const STATUTS: Record<CodeErreur, 400 | 401 | 403 | 404 | 409> = { invalide: 400, non_authentifie: 401, interdit: 403, introuvable: 404, conflit: 409 };

type Env = { Variables: { acteur: Acteur } };

export function creerApp(s: Services, options: { production?: boolean } = {}) {
  const app = new Hono<Env>();

  app.use("*", secureHeaders());
  app.use("/api/*", bodyLimit({ maxSize: TAILLE_MAX_COFFRE + 1024 * 1024, onError: (c) => c.json({ erreur: "Fichier trop volumineux." }, 413) }));

  // Protection CSRF : toute requête qui modifie quelque chose doit porter un en-tête qu'un formulaire
  // d'un autre site ne peut pas poser (il faudrait un pré-vol CORS, que cette API n'autorise pas).
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-requested-with") !== "s4m") {
      return c.json({ erreur: "Requête refusée." }, 403);
    }
    await next();
  });

  app.onError((erreur, c) => {
    if (erreur instanceof ErreurMetier) return c.json({ erreur: erreur.message, code: erreur.code, details: erreur.details ?? null }, STATUTS[erreur.code]);
    if (erreur instanceof ZodError) {
      const champs = Object.fromEntries(erreur.issues.map((i) => [i.path.join(".") || "_", i.message]));
      return c.json({ erreur: Object.values(champs)[0] ?? "Données invalides.", code: "invalide", details: { champs } }, 400);
    }
    console.error("[api] erreur inattendue :", erreur);
    return c.json({ erreur: "Une erreur inattendue s'est produite. Elle a été consignée." }, 500);
  });

  const connecte = async (c: Context<Env>, next: () => Promise<void>) => {
    const acteur = await auth.acteurDepuisJeton(s, getCookie(c, COOKIE));
    if (!acteur) return c.json({ erreur: "Votre session a expiré. Reconnectez-vous.", code: "non_authentifie" }, 401);
    c.set("acteur", acteur);
    await next();
  };

  const poserSession = (c: Context, session: { jeton: string; expire_le: Date }) =>
    setCookie(c, COOKIE, session.jeton, { httpOnly: true, sameSite: "Lax", secure: options.production === true, path: "/", expires: session.expire_le });

  const corps = async (c: Context): Promise<Record<string, unknown>> => {
    const json = await c.req.json().catch(() => null);
    if (typeof json !== "object" || json === null) throw invalide("Corps de requête illisible.");
    return json as Record<string, unknown>;
  };

  const fichierDe = async (c: Context): Promise<{ fichier: FichierDepose; champs: Record<string, string> }> => {
    const form = await c.req.parseBody();
    const f = form["fichier"];
    if (!(f instanceof File)) throw invalide("Aucun fichier reçu.");
    const champs = Object.fromEntries(Object.entries(form).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    return { fichier: { nom: f.name, type_mime: f.type, contenu: Buffer.from(await f.arrayBuffer()) }, champs };
  };

  const telechargement = (c: Context, f: { nom: string; contenu: Buffer | string; type_mime?: string }, enLigne = false) => {
    const nomAscii = f.nom.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "_");
    return c.body(typeof f.contenu === "string" ? f.contenu : new Uint8Array(f.contenu), 200, {
      "content-type": f.type_mime ?? "application/octet-stream",
      "content-disposition": `${enLigne ? "inline" : "attachment"}; filename="${nomAscii}"; filename*=UTF-8''${encodeURIComponent(f.nom)}`,
      "x-content-type-options": "nosniff",
    });
  };

  const ip = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";

  // ——— Authentification ———
  app.post("/api/auth/inscription", async (c) => {
    const d = await corps(c);
    await auth.inscrireFormateur(s, { email: String(d.email ?? ""), mot_de_passe: String(d.mot_de_passe ?? ""), prenom: String(d.prenom ?? ""), nom: String(d.nom ?? "") });
    poserSession(c, await auth.connecter(s, String(d.email), String(d.mot_de_passe)));
    return c.json({ ok: true }, 201);
  });
  app.post("/api/auth/connexion", async (c) => {
    const d = await corps(c);
    poserSession(c, await auth.connecter(s, String(d.email ?? ""), String(d.mot_de_passe ?? "")));
    return c.json({ ok: true });
  });
  app.post("/api/auth/deconnexion", async (c) => {
    const jeton = getCookie(c, COOKIE);
    if (jeton) await auth.deconnecter(s, jeton);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/auth/moi", async (c) => {
    const acteur = await auth.acteurDepuisJeton(s, getCookie(c, COOKIE));
    if (!acteur) return c.json({ acteur: null });
    const of = await organisme.lireOrganisme(s, acteur.of_id);
    return c.json({ acteur, organisme: { nom: of.of_nom, couleur: of.couleur } });
  });
  app.get("/api/auth/invitation/:jeton", async (c) => c.json(await auth.lireInvitation(s, c.req.param("jeton"))));
  app.post("/api/auth/invitation/:jeton", async (c) => {
    poserSession(c, await auth.accepterInvitation(s, c.req.param("jeton"), String((await corps(c)).mot_de_passe ?? "")));
    return c.json({ ok: true });
  });

  // ——— Page publique de positionnement (« Modification 1 ») : l'apprenant y accède par son lien personnel ———
  app.get("/api/public/positionnement/:jeton", async (c) => c.json(await positionnements.lirePositionnementPublic(s, c.req.param("jeton"))));
  app.put("/api/public/positionnement/:jeton/brouillon", async (c) => c.json(await positionnements.enregistrerBrouillonPublic(s, c.req.param("jeton"), await corps(c))));
  app.post("/api/public/positionnement/:jeton/signer", async (c) => c.json(await positionnements.signerPositionnementPublic(s, c.req.param("jeton"), await corps(c), ip(c))));
  app.get("/api/public/positionnement/:jeton/pdf", async (c) => telechargement(c, await positionnements.telechargerPdfPublic(s, c.req.param("jeton"))));

  // ——— Page publique d'un formulaire apprenant (version 7) : recueil, positionnement, acquis, satisfaction ———
  app.get("/api/public/formulaire/:jeton", async (c) => c.json(await formulaires.lireFormulairePublic(s, c.req.param("jeton"))));
  app.put("/api/public/formulaire/:jeton/brouillon", async (c) => c.json(await formulaires.enregistrerBrouillonPublic(s, c.req.param("jeton"), await corps(c))));
  app.post("/api/public/formulaire/:jeton/signer", async (c) => c.json(await formulaires.signerFormulairePublic(s, c.req.param("jeton"), await corps(c), ip(c))));
  app.get("/api/public/formulaire/:jeton/pdf", async (c) => telechargement(c, await formulaires.telechargerPdfPublic(s, c.req.param("jeton"))));

  app.use("/api/*", async (c, next) => (c.req.path.startsWith("/api/auth/") || c.req.path.startsWith("/api/public/") ? next() : connecte(c, next)));
  const A = (c: Context<Env>) => c.get("acteur");

  app.post("/api/compte/mot-de-passe", async (c) => {
    const d = await corps(c);
    await auth.changerMotDePasse(s, A(c), String(d.ancien ?? ""), String(d.nouveau ?? ""));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/compte/suppression", async (c) => c.json(await rgpd.apercuSuppression(s, A(c))));
  app.post("/api/compte/suppression", async (c) => {
    const d = await corps(c);
    await rgpd.supprimerMonCompte(s, A(c), { phrase: String(d.phrase ?? ""), mot_de_passe: String(d.mot_de_passe ?? "") });
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ——— Référentiel (lecture seule) ———
  app.get("/api/referentiel", (c) =>
    c.json({ pieces: NOMENCLATURE, etapes: ETAPES, sous_statuts: SOUS_STATUTS, actions: Object.fromEntries(Object.entries(REGLES).map(([k, r]) => [k, r.libelle])) }),
  );

  // ——— Module 1 : candidature du formateur ———
  app.get("/api/candidature", async (c) => c.json(await candidatures.lireMaCandidature(s, A(c))));
  app.patch("/api/candidature", async (c) => c.json(await candidatures.mettreAJourMonProfil(s, A(c), await corps(c))));
  app.post("/api/candidature/pieces", async (c) => {
    const { fichier, champs } = await fichierDe(c);
    return c.json(await candidatures.deposerPieceFormateur(s, A(c), champs.type ?? "", fichier, champs.expire_le ?? ""), 201);
  });
  app.delete("/api/candidature/pieces/:id", async (c) => c.json(await candidatures.supprimerPieceFormateur(s, A(c), c.req.param("id"))));
  app.post("/api/candidature/soumettre", async (c) => c.json(await candidatures.soumettreCandidature(s, A(c))));
  app.get("/api/pieces-formateur/:id", async (c) => telechargement(c, await candidatures.telechargerPieceFormateur(s, A(c), c.req.param("id"))));

  // ——— Administration ———
  app.get("/api/admin/candidatures", async (c) => c.json(await candidatures.listerCandidatures(s, A(c))));
  app.get("/api/admin/candidatures/:id", async (c) => c.json(await candidatures.lireCandidature(s, A(c), c.req.param("id"))));
  app.post("/api/admin/candidatures/:id/decision", async (c) => {
    const d = await corps(c);
    return c.json(await candidatures.deciderCandidature(s, A(c), c.req.param("id"), { validee: d.validee === true, motif: String(d.motif ?? "") }));
  });
  app.get("/api/admin/organisme", async (c) => {
    exigerRole(A(c), "admin");
    const of = await organisme.lireOrganisme(s, A(c).of_id);
    return c.json({ organisme: of, manques: organisme.champsOfManquants(of) });
  });
  app.patch("/api/admin/organisme", async (c) => {
    const of = await organisme.mettreAJourOrganisme(s, A(c), await corps(c));
    return c.json({ organisme: of, manques: organisme.champsOfManquants(of) });
  });

  // Réglages modifiables dans l'application (version 7) : assistant IA, envoi des e-mails.
  app.get("/api/admin/reglages", async (c) => c.json(await reglages.vueReglages(s, A(c))));
  app.patch("/api/admin/reglages", async (c) => c.json(await reglages.enregistrerReglages(s, A(c), await corps(c))));
  app.post("/api/admin/reglages/test-courriel", async (c) => c.json(await reglages.envoyerCourrielDeTest(s, A(c))));

  /** Boîte d'envoi : tout e-mail automatique y est consultable (traçabilité, §9 du cahier des charges). */
  app.get("/api/courriers", async (c) => {
    const acteur = A(c);
    if (acteur.role === "apprenant") throw new ErreurMetier("interdit", "Réservé au formateur et à l'organisme.");
    let lignes = await s.bd.select().from(courrier).where(eq(courrier.of_id, acteur.of_id)).orderBy(desc(courrier.cree_le)).limit(200);
    if (acteur.role === "formateur") {
      const miens = await s.bd.select({ id: dossierFormation.id }).from(dossierFormation).where(eq(dossierFormation.formateur_id, acteur.formateur_id ?? ""));
      const ids = new Set(miens.map((m) => m.id));
      lignes = lignes.filter((l) => (l.dossier_id && ids.has(l.dossier_id)) || l.formateur_id === acteur.formateur_id || l.destinataire === acteur.email);
    }
    return c.json(lignes);
  });
  /** Renvoi d'un e-mail de la boîte d'envoi (après correction des réglages SMTP, par exemple). */
  app.post("/api/courriers/:id/renvoyer", async (c) => {
    const acteur = A(c);
    if (acteur.role === "apprenant") throw new ErreurMetier("interdit", "Réservé au formateur et à l'organisme.");
    const [l] = await s.bd.select().from(courrier).where(eq(courrier.id, c.req.param("id")));
    if (!l || l.of_id !== acteur.of_id) throw new ErreurMetier("introuvable", "Courrier introuvable.");
    if (acteur.role === "formateur" && l.formateur_id !== acteur.formateur_id && l.destinataire !== acteur.email) {
      const [d] = l.dossier_id ? await s.bd.select({ formateur_id: dossierFormation.formateur_id }).from(dossierFormation).where(eq(dossierFormation.id, l.dossier_id)) : [];
      if (d?.formateur_id !== acteur.formateur_id) throw new ErreurMetier("introuvable", "Courrier introuvable.");
    }
    const r = await s.courrier.envoyer({ of_id: l.of_id, dossier_id: l.dossier_id, formateur_id: l.formateur_id, type: l.type, destinataire: l.destinataire, sujet: l.sujet, corps_html: l.corps_html, pieces_jointes: l.pieces_jointes as Array<{ nom: string; chemin: string }> });
    return c.json(r);
  });

  // ——— Modules 2 et 3 : formations, outils, coffre-fort ———
  app.get("/api/formations", async (c) => c.json(await formations.listerFormations(s, A(c), { archivees: c.req.query("archivees") === "1" })));
  app.post("/api/formations/:id/restaurer", async (c) => c.json(await formations.restaurerFormation(s, A(c), c.req.param("id"))));
  app.get("/api/versions/:type/:id", async (c) => {
    const type = c.req.param("type");
    if (type !== "formation" && type !== "outil") throw invalide("Type inconnu.");
    return c.json(await formations.listerVersions(s, A(c), type, c.req.param("id")));
  });
  app.post("/api/versions/:id/restaurer", async (c) => c.json(await formations.restaurerVersion(s, A(c), c.req.param("id"))));
  app.post("/api/formations", async (c) => c.json(await formations.creerFormation(s, A(c), await corps(c)), 201));
  app.get("/api/formations/:id", async (c) => c.json(await formations.lireFormation(s, A(c), c.req.param("id"))));
  app.patch("/api/formations/:id", async (c) => c.json(await formations.modifierFormation(s, A(c), c.req.param("id"), await corps(c))));
  app.post("/api/formations/:id/dupliquer", async (c) => c.json(await formations.dupliquerFormation(s, A(c), c.req.param("id")), 201));
  app.delete("/api/formations/:id", async (c) => (await formations.archiverFormation(s, A(c), c.req.param("id")), c.json({ ok: true })));
  app.get("/api/formations/:id/coffre", async (c) => c.json(await formations.listerCoffre(s, A(c), c.req.param("id"))));
  app.post("/api/formations/:id/coffre", async (c) => {
    const { fichier, champs } = await fichierDe(c);
    return c.json(await formations.deposerDansCoffre(s, A(c), c.req.param("id"), fichier, { partageable: champs.partageable !== "non", categorie: champs.categorie || undefined, description: champs.description || undefined }), 201);
  });
  app.patch("/api/coffre/:id", async (c) => {
    const d = await corps(c);
    if (Object.keys(d).length === 1 && "partageable" in d) await formations.reglerPartage(s, A(c), c.req.param("id"), d.partageable === true);
    else await formations.modifierFichierCoffre(s, A(c), c.req.param("id"), d);
    return c.json({ ok: true });
  });
  app.delete("/api/coffre/:id", async (c) => (await formations.supprimerDuCoffre(s, A(c), c.req.param("id")), c.json({ ok: true })));
  app.post("/api/coffre/:id/restaurer", async (c) => (await formations.restaurerDuCoffre(s, A(c), c.req.param("id")), c.json({ ok: true })));
  app.delete("/api/coffre/:id/definitif", async (c) => (await formations.purgerDuCoffre(s, A(c), c.req.param("id")), c.json({ ok: true })));

  // Coffre-fort pédagogique PAR PARCOURS (onglet dédié) : pédagogique + administratif.
  app.get("/api/coffres-parcours", async (c) => c.json(await coffre.listerCoffresParcours(s, A(c))));
  app.get("/api/coffres-parcours/:id", async (c) => c.json(await coffre.lireCoffreParcours(s, A(c), c.req.param("id"))));
  app.get("/api/coffres-parcours/:id/programme", async (c) => telechargement(c, await coffre.documentProgrammeParcours(s, A(c), c.req.param("id"))));
  app.get("/api/coffres-parcours/:id/zip", async (c) => telechargement(c, await coffre.exporterCoffreZip(s, A(c), c.req.param("id"))));
  app.get("/api/outils/:id/document", async (c) => telechargement(c, await coffre.documentOutilParcours(s, A(c), c.req.param("id"), c.req.query("corrige") === "1")));
  app.get("/api/coffre/:id/telecharger", async (c) => telechargement(c, await formations.telechargerDuCoffre(s, A(c), c.req.param("id"))));
  app.get("/api/coffres", async (c) => c.json(await formations.coffresDeLApprenant(s, A(c))));

  // Espace pédagogique — propositions de l'IA : des brouillons, jamais enregistrés sans le formateur.
  app.get("/api/ia/etat", async (c) => c.json(await pedagogieIa.etatIa(s, A(c))));
  app.post("/api/ia/qcm", async (c) => c.json(await pedagogieIa.proposerQcm(s, A(c), await corps(c))));
  app.post("/api/ia/programme", async (c) => c.json(await pedagogieIa.proposerProgramme(s, A(c), await corps(c))));
  // « Modification 1 » puis version 7 : dossier d'enjeux (recherche web), parcours, tests et supports — toujours par l'IA.
  app.post("/api/ia/parcours", async (c) => c.json(await pedagogieIa.proposerParcours(s, A(c), await corps(c))));
  app.post("/api/ia/enjeux", async (c) => c.json(await pedagogieIa.analyserEnjeux(s, A(c), await corps(c))));
  app.post("/api/ia/test", async (c) => c.json(await pedagogieIa.proposerTest(s, A(c), await corps(c))));
  app.post("/api/ia/plan-support", async (c) => c.json(await pedagogieIa.proposerPlanSupport(s, A(c), await corps(c))));
  app.post("/api/supports", async (c) => c.json(await pedagogieIa.produireSupport(s, A(c), await corps(c)), 201));
  app.post("/api/supports/tous", async (c) => c.json(await pedagogieIa.produireTousLesSupports(s, A(c), await corps(c)), 201));
  app.get("/api/outils", async (c) => c.json(await formations.listerOutils(s, A(c), { archives: c.req.query("archives") === "1" })));
  app.post("/api/outils/:id/restaurer", async (c) => c.json(await formations.restaurerOutil(s, A(c), c.req.param("id"))));
  app.post("/api/outils", async (c) => c.json(await formations.enregistrerOutil(s, A(c), await corps(c)), 201));
  app.put("/api/outils/:id", async (c) => c.json(await formations.enregistrerOutil(s, A(c), await corps(c), c.req.param("id"))));
  app.delete("/api/outils/:id", async (c) => (await formations.supprimerOutil(s, A(c), c.req.param("id")), c.json({ ok: true })));

  // ——— Module 4.1 : répertoires ———
  app.get("/api/entreprises", async (c) => c.json(await repertoire.listerEntreprises(s, A(c), { archives: c.req.query("archives") === "1" })));
  app.post("/api/entreprises/:id/archiver", async (c) => (await repertoire.archiverFiche(s, A(c), "entreprise", c.req.param("id"), (await corps(c)).archiver !== false), c.json({ ok: true })));
  app.post("/api/stagiaires/:id/archiver", async (c) => (await repertoire.archiverFiche(s, A(c), "stagiaire", c.req.param("id"), (await corps(c)).archiver !== false), c.json({ ok: true })));
  app.post("/api/entreprises", async (c) => c.json(await repertoire.enregistrerEntreprise(s, A(c), await corps(c)), 201));
  app.patch("/api/entreprises/:id", async (c) => c.json(await repertoire.enregistrerEntreprise(s, A(c), await corps(c), c.req.param("id"))));
  app.get("/api/stagiaires", async (c) => c.json(await repertoire.listerStagiaires(s, A(c), { archives: c.req.query("archives") === "1" })));

  // ——— Positionnement avant dossier (« Modification 1 ») ———
  app.get("/api/positionnements", async (c) => c.json(await positionnements.listerPositionnements(s, A(c), { formation_id: c.req.query("formation_id") || undefined, archives: c.req.query("archives") === "1" })));
  app.post("/api/positionnements", async (c) => c.json(await positionnements.inviterAuPositionnement(s, A(c), await corps(c)), 201));
  app.post("/api/positionnements/:id/relancer", async (c) => c.json(await positionnements.relancerPositionnement(s, A(c), c.req.param("id"))));
  app.post("/api/positionnements/:id/archiver", async (c) => (await positionnements.archiverPositionnement(s, A(c), c.req.param("id"), (await corps(c)).archiver !== false), c.json({ ok: true })));
  app.get("/api/positionnements/:id/pdf", async (c) => telechargement(c, await positionnements.telechargerPdfPositionnement(s, A(c), c.req.param("id"))));

  // ——— Archives, corbeille, sauvegarde (« faire réapparaître ») ———
  app.get("/api/archives", async (c) => c.json(await sauvegarde.archivesEtCorbeille(s, A(c))));
  app.get("/api/sauvegarde/export", async (c) => telechargement(c, await sauvegarde.exporterMesDonnees(s, A(c))));
  app.post("/api/sauvegarde/import", async (c) => c.json(await sauvegarde.importerMesDonnees(s, A(c), (await fichierDe(c)).fichier.contenu)));
  app.post("/api/stagiaires", async (c) => c.json(await repertoire.enregistrerStagiaire(s, A(c), await corps(c)), 201));
  app.patch("/api/stagiaires/:id", async (c) => c.json(await repertoire.enregistrerStagiaire(s, A(c), await corps(c), c.req.param("id"))));

  // ——— Modules 5 et 6 : dossiers et pipeline ———
  app.get("/api/dossiers", async (c) => c.json(await dossiers.listerDossiers(s, A(c))));
  app.post("/api/dossiers", async (c) => c.json(await dossiers.creerDossier(s, A(c), await corps(c)), 201));
  app.get("/api/dossiers/:id", async (c) => c.json(await dossiers.lireDossier(s, A(c), c.req.param("id"))));
  app.patch("/api/dossiers/:id", async (c) => (await dossiers.modifierDossier(s, A(c), c.req.param("id"), await corps(c)), c.json(await dossiers.lireDossier(s, A(c), c.req.param("id")))));
  app.delete("/api/dossiers/:id", async (c) => (await dossiers.supprimerBrouillon(s, A(c), c.req.param("id")), c.json({ ok: true })));
  app.put("/api/dossiers/:id/seances", async (c) => (await dossiers.definirSeances(s, A(c), c.req.param("id"), (await corps(c)).seances), c.json(await dossiers.lireDossier(s, A(c), c.req.param("id")))));
  app.put("/api/dossiers/:id/stagiaires", async (c) => {
    const d = await corps(c);
    await dossiers.definirStagiaires(s, A(c), c.req.param("id"), Array.isArray(d.stagiaire_ids) ? d.stagiaire_ids.map(String) : []);
    return c.json(await dossiers.lireDossier(s, A(c), c.req.param("id")));
  });
  app.patch("/api/dossiers/:id/objectifs-atteints", async (c) => (await dossiers.renseignerObjectifsAtteints(s, A(c), c.req.param("id"), String((await corps(c)).texte ?? "")), c.json({ ok: true })));
  app.post("/api/dossiers/:id/actions/:action", async (c) => {
    const action = c.req.param("action");
    if (!(action in REGLES)) throw invalide("Action inconnue.");
    const d = await corps(c).catch(() => ({}) as Record<string, unknown>);
    await executerAction(s, A(c), c.req.param("id"), action as Action, { motif: typeof d.motif === "string" ? d.motif : undefined });
    return c.json(await dossiers.lireDossier(s, A(c), c.req.param("id")));
  });
  app.post("/api/dossiers/:id/inviter", async (c) => c.json(await dossiers.inviter(s, A(c), c.req.param("id"), String((await corps(c)).stagiaire_id ?? ""))));
  app.post("/api/dossiers/:id/relancer", async (c) => c.json(await dossiers.relancerApprenant(s, A(c), c.req.param("id"), String((await corps(c)).stagiaire_id ?? ""))));
  app.post("/api/dossiers/:id/recreer", async (c) => c.json(await dossiers.recreerDepuis(s, A(c), c.req.param("id")), 201));
  app.post("/api/dossiers/:id/pieces-externes/:code", async (c) => {
    const { fichier } = await fichierDe(c);
    await retours.deposerPieceExterne(s, A(c), c.req.param("id"), c.req.param("code"), fichier);
    return c.json(await dossiers.lireDossier(s, A(c), c.req.param("id")));
  });
  // Formulaires apprenant (version 7) : état, envoi / renvoi, document d'invitation.
  app.get("/api/dossiers/:id/formulaires", async (c) => c.json(await formulaires.etatFormulaires(s, A(c), c.req.param("id"))));
  app.post("/api/dossiers/:id/formulaires/envoyer", async (c) => {
    const d = await corps(c);
    const type = String(d.type ?? "");
    if (!["recueil", "positionnement", "acquis", "satisfaction_chaud", "satisfaction_froid"].includes(type)) throw invalide("Formulaire inconnu.");
    return c.json(await formulaires.envoyerFormulaire(s, A(c), c.req.param("id"), String(d.stagiaire_id ?? ""), type as formulaires.TypeFormulaire, { message: typeof d.message === "string" ? d.message : undefined }));
  });
  app.get("/api/dossiers/:id/formulaires/:stagiaire/:type/invitation", async (c) => telechargement(c, await formulaires.telechargerInvitation(s, A(c), c.req.param("id"), c.req.param("stagiaire"), c.req.param("type") as formulaires.TypeFormulaire)));
  app.get("/api/formulaires", async (c) => c.json(await formulaires.listerFormulaires(s, A(c), { dossier_id: c.req.query("dossier_id") || undefined })));
  app.get("/api/dossiers/:id/emargement", async (c) => c.json(await retours.etatEmargement(s, A(c), c.req.param("id"))));
  app.get("/api/dossiers/:id/trame-facture", async (c) => c.html(await retours.trameFactureFormateur(s, A(c), c.req.param("id"))));
  app.get("/api/dossiers/:id/questionnaires/:type", async (c) =>
    c.json(await evaluations.lireQuestionnaire(s, A(c), c.req.param("id"), c.req.param("type") as evaluations.TypeEvaluation, c.req.query("stagiaire_id"))),
  );
  app.post("/api/dossiers/:id/questionnaires/:type", async (c) => {
    const d = await corps(c);
    const type = c.req.param("type");
    if (!["recueil", "positionnement", "acquis", "satisfaction_chaud", "satisfaction_froid"].includes(type)) throw invalide("Questionnaire inconnu.");
    return c.json(await evaluations.enregistrerEvaluation(s, A(c), c.req.param("id"), type as evaluations.TypeEvaluation, { reponses: d.reponses, stagiaire_id: typeof d.stagiaire_id === "string" ? d.stagiaire_id : undefined, ajustement: typeof d.ajustement === "string" ? d.ajustement : undefined }));
  });

  // ——— Module 4 : pièces des deux espaces de communication ———
  app.get("/api/pieces/:id/apercu", async (c) => {
    // Le document est affiché dans un cadre isolé : aucun script, aucune ressource externe.
    c.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'");
    return c.html(await retours.apercuPiece(s, A(c), c.req.param("id")));
  });
  app.get("/api/pieces/:id/telecharger", async (c) => telechargement(c, await retours.telechargerPiece(s, A(c), c.req.param("id"), c.req.query("version") === "retour" ? "retour" : "depart")));
  app.get("/api/pieces/:id/integrite", async (c) => c.json(await retours.verifierIntegritePiece(s, A(c), c.req.param("id"))));
  app.post("/api/pieces/:id/signer", async (c) => {
    const d = await corps(c);
    return c.json(await retours.signerPiece(s, A(c), c.req.param("id"), { trace_png: String(d.trace_png ?? ""), lieu: String(d.lieu ?? ""), consentement: d.consentement === true }, ip(c)));
  });
  app.post("/api/pieces/:id/deposer", async (c) => c.json(await retours.deposerRetour(s, A(c), c.req.param("id"), (await fichierDe(c)).fichier)));
  app.post("/api/pieces/:id/regenerer", async (c) => c.json(await retours.regenererPiece(s, A(c), c.req.param("id"))));
  app.post("/api/seances/:id/emarger", async (c) => {
    const d = await corps(c);
    await retours.emarger(s, A(c), c.req.param("id"), { trace_png: String(d.trace_png ?? ""), stagiaire_id: typeof d.stagiaire_id === "string" ? d.stagiaire_id : undefined });
    return c.json({ ok: true });
  });

  // ——— Module 8 : BPF ———
  app.get("/api/bpf", async (c) => c.json(await bpf.lireBpf(s, A(c), c.req.query("exercice") ? Number(c.req.query("exercice")) : undefined)));
  app.get("/api/bpf/export", async (c) => telechargement(c, { ...(await bpf.exporterBpfCsv(s, A(c), Number(c.req.query("exercice")))), type_mime: "text/csv; charset=utf-8" }));

  app.all("/api/*", (c) => c.json({ erreur: "Ressource inconnue." }, 404));
  return app;
}
