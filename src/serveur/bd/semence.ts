/**
 * Jeu de démonstration — données ENTIÈREMENT FICTIVES. Construit en appelant les vrais services, dans l'ordre
 * où un utilisateur le ferait : ce qui est semé est donc, par construction, un état valide de l'application.
 * Huit dossiers répartis sur tout le pipeline, pour que chaque écran ait quelque chose à montrer.
 */
import { eq } from "drizzle-orm";
import { stagiaire, utilisateur } from "./schema";
import { tracePngDemo } from "./trace-demo";
import { creerFormateurValide, creerOrganisme, creerUtilisateur } from "./amorce";
import { accepterInvitation, acteurDepuisJeton, construireActeur, inscrireFormateur } from "../services/auth";
import { deposerPieceFormateur, mettreAJourMonProfil, soumettreCandidature } from "../services/candidatures";
import {
  creerDossier,
  definirSeances,
  inviter,
  lireDossier,
  modifierDossier,
  renseignerObjectifsAtteints,
} from "../services/dossiers";
import { enregistrerEvaluation } from "../services/evaluations";
import { creerFormation, deposerDansCoffre, enregistrerOutil } from "../services/formations";
import { produireSupport } from "../services/pedagogie-ia";
import { repartirHeures, type Diapo, type ModuleParcours } from "@/domaine/pedagogie/parcours";
import {
  inviterAuPositionnement,
  lirePositionnementPublic,
  signerPositionnementPublic,
} from "../services/positionnements";
import { executerAction } from "../services/pipeline";
import { enregistrerEntreprise, enregistrerStagiaire } from "../services/repertoire";
import { deposerPieceExterne, deposerRetour, emarger, signerPiece } from "../services/retours";
import type { Acteur, Services } from "../services/socle";

export const MDP_DEMO = "demonstration-s4m";
export const COMPTES_DEMO = [
  { role: "Admin de l'organisme", email: "admin@demo.example" },
  { role: "Formatrice (candidature validée)", email: "formatrice@demo.example" },
  { role: "Apprenante", email: "apprenante@demo.example" },
  { role: "Candidat formateur (à valider)", email: "candidat@demo.example" },
];

const signature = (graine: number) => ({
  trace_png: tracePngDemo(graine),
  lieu: "Mulhouse",
  consentement: true,
});

const jour = (decalage: number): string =>
  new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);
const pdfFictif = (titre: string) => ({
  nom: `${titre}.pdf`,
  type_mime: "application/pdf",
  contenu: Buffer.from(`%PDF-1.4\n% Document de démonstration : ${titre}\n`),
});

const QCM_EXCEL = {
  titre: "Positionnement — Excel",
  questions: [
    {
      enonce: "À quoi sert un tableau croisé dynamique ?",
      propositions: [
        "À mettre en page un document",
        "À synthétiser et croiser des données",
        "À protéger un classeur",
      ],
      bonne_reponse: 1,
    },
    {
      enonce: "Quelle fonction recherche une valeur dans la première colonne d'un tableau ?",
      propositions: ["SOMME.SI", "RECHERCHEV", "CONCATENER"],
      bonne_reponse: 1,
    },
    {
      enonce: "Que fait le symbole $ dans la référence $A$1 ?",
      propositions: [
        "Il fige la référence lors d'une recopie",
        "Il applique le format monétaire",
        "Il masque la cellule",
      ],
      bonne_reponse: 0,
    },
    {
      enonce: "Quel outil supprime rapidement les lignes en double ?",
      propositions: [
        "Le filtre avancé uniquement",
        "La mise en forme conditionnelle",
        "Données › Supprimer les doublons",
      ],
      bonne_reponse: 2,
    },
  ],
};
const QCM_ACQUIS = { ...QCM_EXCEL, titre: "Évaluation des acquis — Excel" };
const RECUEIL = {
  poste_anciennete: "Assistante de gestion depuis quatre ans.",
  niveau_maitrise: "Notions de base",
  attentes: "Gagner du temps sur le reporting mensuel et fiabiliser mes fichiers.",
  besoins_principaux: "Les tableaux croisés dynamiques et le contrôle des données.",
  handicap: "Non",
  programme_transmis: "Oui",
};
/**
 * Parcours de démonstration « Prospection commerciale B2B » (version 7 : le parcours et les supports sont produits par
 * l'IA dans l'application ; la semence, qui tourne sans IA, embarque un parcours et des plans écrits d'avance).
 */
const MODULES_PROSPECTION: ModuleParcours[] = [
  {
    titre: "Cibler ses prospects",
    objectifs: ["Définir son client idéal", "Constituer un fichier de prospection qualifié"],
    contenus: ["Segmentation et persona", "Sources de données B2B et RGPD", "Scoring des comptes"],
    methodes: "Apports, étude de cas",
    mise_en_pratique: "Atelier : construire son fichier de 30 comptes cibles",
    evaluation: "Fichier de prospection évalué sur grille",
  },
  {
    titre: "Préparer et réussir la prise de contact",
    objectifs: ["Rédiger une accroche téléphonique et écrite", "Franchir le barrage de l'assistant"],
    contenus: [
      "Structure d'un appel de prospection",
      "E-mail et message LinkedIn",
      "Objections de premier contact",
    ],
    methodes: "Jeux de rôle enregistrés",
    mise_en_pratique: "Atelier : 10 appels simulés avec débriefing",
    evaluation: "Grille d'observation des appels",
  },
  {
    titre: "Conduire l'entretien de découverte",
    objectifs: ["Qualifier un besoin avec la méthode BANT", "Faire émerger les enjeux du prospect"],
    contenus: [
      "Questionnement ouvert et reformulation",
      "Qualification budget, décideur, besoin, calendrier",
      "Compte rendu d'entretien",
    ],
    methodes: "Mises en situation filmées",
    mise_en_pratique: "Atelier : entretien de découverte à trois (vendeur, prospect, observateur)",
    evaluation: "Compte rendu d'entretien noté",
  },
  {
    titre: "Organiser et piloter sa prospection",
    objectifs: ["Planifier ses actions hebdomadaires", "Suivre ses indicateurs de prospection"],
    contenus: [
      "Rituel hebdomadaire de prospection",
      "Pipeline et taux de transformation",
      "Relances et nurturing",
    ],
    methodes: "Apports, plan d'action individuel",
    mise_en_pratique: "Atelier : plan de prospection à 90 jours",
    evaluation: "Plan d'action présenté au groupe",
  },
].map((m, i) => ({ ...m, duree_heures: repartirHeures(21, 4)[i]! }));

const TYPES_PLAN_DEMO = [
  "titre",
  "objectifs",
  "sommaire",
  "amorce",
  "notion",
  "notion",
  "schema",
  "point_etape",
  "exemple",
  "notion",
  "pratique",
  "debriefing",
  "notion",
  "point_etape",
  "vigilance",
  "pratique",
  "notion",
  "pratique",
  "synthese",
  "quiz",
] as const;
const planDemo = (m: ModuleParcours): Diapo[] =>
  TYPES_PLAN_DEMO.map((type, i) => ({
    type,
    titre: type === "titre" ? m.titre : `${m.titre} — ${i + 1}`,
    points: [m.contenus[i % m.contenus.length]!, m.objectifs[i % m.objectifs.length]!],
    visuel: "Schéma à réaliser par le formateur",
    notes: "Plan de démonstration : à remplacer par le support généré par l'IA.",
  }));

const NOTES = Object.fromEntries(
  [
    "contenu",
    "attentes",
    "adaptation",
    "programme",
    "application",
    "pedagogie",
    "competences",
    "supports",
    "environnement",
    "globale",
  ].map((k, i) => [k, String(i % 3 === 0 ? 4 : 5)]),
);

async function acteurDe(s: Services, utilisateur_id: string): Promise<Acteur> {
  const [u] = await s.bd.select().from(utilisateur).where(eq(utilisateur.id, utilisateur_id));
  return construireActeur(s, u!);
}

type Jalon =
  "brouillon" | "soumis" | "valide" | "accord" | "en_cours" | "termine" | "paiement" | "archive" | "refus";

export async function semer(s: Services): Promise<void> {
  const of_id = await creerOrganisme(s, { id: "of-demo", signature_representant_png: tracePngDemo(5) });
  const admin = await acteurDe(
    s,
    await creerUtilisateur(s, {
      of_id,
      email: COMPTES_DEMO[0]!.email,
      mot_de_passe: MDP_DEMO,
      role: "admin",
      prenom: "Claire",
      nom: "Exemple",
    }),
  );
  const sophie = await acteurDe(
    s,
    (
      await creerFormateurValide(s, {
        of_id,
        email: COMPTES_DEMO[1]!.email,
        mot_de_passe: MDP_DEMO,
        prenom: "Sophie",
        nom: "Lambert",
      })
    ).utilisateur_id,
  );

  // Un candidat formateur, candidature soumise : de quoi montrer l'écran de décision de l'admin.
  const { utilisateur_id: candidatId } = await inscrireFormateur(s, {
    email: COMPTES_DEMO[3]!.email,
    mot_de_passe: MDP_DEMO,
    prenom: "Paul",
    nom: "Durand",
    of_id,
  });
  const paul = await acteurDe(s, candidatId);
  await mettreAJourMonProfil(s, paul, {
    formateur_telephone: "06 00 00 00 02",
    formateur_entreprise_nom: "PD Formation EI",
    formateur_entreprise_siret: "44444444444444",
    parcours:
      "Quinze ans d'expérience en management d'équipes commerciales, formateur indépendant depuis 2019.",
  });
  for (const type of ["cv", "identite", "diplome"])
    await deposerPieceFormateur(s, paul, type, pdfFictif(`${type}-paul-durand`));
  await soumettreCandidature(s, paul);

  // Catalogue, outils et coffre-fort de la formatrice.
  const excel = await creerFormation(s, sophie, {
    formation_titre: "Excel — tableaux croisés dynamiques et automatisation",
    formation_objectifs:
      "Construire et exploiter des tableaux croisés dynamiques.\nAutomatiser un reporting mensuel.\nFiabiliser ses fichiers par le contrôle des données.",
    formation_niveau: "Intermédiaire",
    formation_prerequis: "Maîtriser les fonctions de base d'Excel (saisie, mise en forme, formules simples).",
    formation_duree_heures_total: 14,
    formation_duree_jours: 2,
    formation_prix_unitaire_ht: 98_000,
    public_vise: "Assistants de gestion, comptables, responsables d'activité.",
    programme:
      "Jour 1 — Structurer ses données, tableaux croisés dynamiques, segments et chronologies.\nJour 2 — Champs calculés, Power Query, automatisation du reporting, contrôle des données.",
  });
  const management = await creerFormation(s, sophie, {
    formation_titre: "Manager une équipe de proximité",
    formation_objectifs:
      "Adopter une posture de manager.\nConduire un entretien de recadrage.\nAnimer une réunion d'équipe efficace.",
    formation_niveau: "Débutant",
    formation_prerequis: "Aucun.",
    formation_duree_heures_total: 21,
    formation_duree_jours: 3,
    formation_prix_unitaire_ht: 145_000,
    public_vise: "Managers récemment nommés, chefs d'équipe.",
    programme:
      "Jour 1 — Posture et rôle du manager de proximité.\nJour 2 — Entretiens individuels : recadrage, feedback.\nJour 3 — Animer une réunion d'équipe efficace.",
  });
  await enregistrerOutil(s, sophie, {
    type: "positionnement",
    titre: QCM_EXCEL.titre,
    formation_id: excel.id,
    contenu: QCM_EXCEL,
  });
  await enregistrerOutil(s, sophie, {
    type: "acquis",
    titre: QCM_ACQUIS.titre,
    formation_id: excel.id,
    contenu: QCM_ACQUIS,
  });
  await enregistrerOutil(s, sophie, {
    type: "positionnement",
    titre: "Positionnement — management",
    formation_id: management.id,
    contenu: { ...QCM_EXCEL, titre: "Positionnement — management" },
  });
  await enregistrerOutil(s, sophie, {
    type: "acquis",
    titre: "Évaluation des acquis — management",
    formation_id: management.id,
    contenu: { ...QCM_EXCEL, titre: "Évaluation des acquis — management" },
  });
  await enregistrerOutil(s, sophie, {
    type: "recueil",
    titre: "Recueil des besoins — bureautique",
    contenu: { questions_supplementaires: ["Sur quelle version d'Excel travaillez-vous ?"] },
  });
  await deposerDansCoffre(s, sophie, excel.id, pdfFictif("Support stagiaire — Excel TCD"), true);
  await deposerDansCoffre(s, sophie, excel.id, pdfFictif("Exercices corrigés"), true);
  await deposerDansCoffre(s, sophie, excel.id, pdfFictif("Notes du formateur (privé)"), false);

  // Répertoires.
  const dupont = await enregistrerEntreprise(s, sophie, {
    entreprise_nom: "Menuiserie Dupont SARL",
    entreprise_nom_commercial: "Atelier Dupont",
    entreprise_adresse: "12 avenue des Artisans, 68200 Mulhouse",
    entreprise_siret: "11111111111111",
    entreprise_representant_civilite: "M.",
    entreprise_representant_prenom: "Jean",
    entreprise_representant_nom: "Dupont",
    entreprise_representant_telephone: "03 11 11 11 11",
    entreprise_representant_email: "jean.dupont@menuiserie-dupont.example",
  });
  const transalp = await enregistrerEntreprise(s, sophie, {
    entreprise_nom: "Transalp Logistique SAS",
    entreprise_adresse: "4 rue du Port, 68300 Saint-Louis",
    entreprise_siret: "55555555555555",
    entreprise_representant_civilite: "Mme",
    entreprise_representant_prenom: "Nadia",
    entreprise_representant_nom: "Keller",
    entreprise_representant_email: "nadia.keller@transalp.example",
  });
  const fiche = (prenom: string, nom: string, poste: string, entreprise_id: string, email?: string) =>
    enregistrerStagiaire(s, sophie, {
      stagiaire_prenom: prenom,
      stagiaire_nom: nom,
      stagiaire_poste: poste,
      entreprise_id,
      stagiaire_email:
        email ??
        `${prenom}.${nom}@stagiaire.example`
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase(),
    });
  const anne = await fiche("Anne", "Martin", "Assistante de gestion", dupont.id, COMPTES_DEMO[2]!.email);
  const luc = await fiche("Luc", "Petit", "Chef d'atelier", dupont.id);
  const ines = await fiche("Inès", "Roche", "Responsable d'exploitation", transalp.id);
  const theo = await fiche("Théo", "Marchal", "Chef de quai", transalp.id);
  const lea = await fiche("Léa", "Schmitt", "Comptable", dupont.id);

  // Comptes des apprenants : créés à la première invitation, puis réutilisés d'un dossier à l'autre.
  const comptes = new Map<string, Acteur>();
  async function apprenant(stagiaireId: string, dossierId: string): Promise<Acteur> {
    let acteur = comptes.get(stagiaireId);
    if (!acteur) {
      const [st] = await s.bd.select().from(stagiaire).where(eq(stagiaire.id, stagiaireId));
      if (st?.utilisateur_id) acteur = await acteurDe(s, st.utilisateur_id);
      else {
        const { lien } = await inviter(s, sophie, dossierId, stagiaireId);
        acteur = (await acteurDepuisJeton(
          s,
          (await accepterInvitation(s, lien.split("/").pop()!, MDP_DEMO)).jeton,
        ))!;
      }
      comptes.set(stagiaireId, acteur);
    }
    return acteur;
  }

  /** Amène un dossier jusqu'au jalon voulu, en jouant les vraies actions des vrais acteurs. */
  async function dossier(
    jalon: Jalon,
    o: {
      stagiaires: string[];
      entreprise: string;
      formation: string;
      debut: number;
      modalite?: "presentiel" | "distanciel";
      financement?: "opco" | "faf" | "entreprise";
    },
  ) {
    const d = await creerDossier(s, sophie, {
      stagiaire_ids: o.stagiaires,
      entreprise_id: o.entreprise,
      formation_id: o.formation,
      formation_modalite: o.modalite ?? "presentiel",
      mode_financement: o.financement ?? "opco",
    });
    const jours = o.formation === management.id ? 3 : 2;
    await modifierDossier(s, sophie, d.id, {
      formation_date_debut: jour(o.debut),
      formation_date_fin: jour(o.debut + jours - 1),
      signature_lieu: "Mulhouse",
      formation_opco: o.financement === "entreprise" ? "" : "OPCO Démo",
      ...(o.modalite === "distanciel"
        ? { formation_lien_visio: "https://visio.example/salle-formation" }
        : {}),
    });
    await definirSeances(
      s,
      sophie,
      d.id,
      Array.from({ length: jours }, (_, i) => [
        { date: jour(o.debut + i), heure_debut: "09:00", heure_fin: "12:30" },
        { date: jour(o.debut + i), heure_debut: "13:30", heure_fin: "17:00" },
      ]).flat(),
    );
    // Version 7 : recueil et positionnement sont renseignés par l'apprenant lui-même (jamais par le formateur).
    if (jalon === "brouillon") {
      await enregistrerEvaluation(s, await apprenant(o.stagiaires[0]!, d.id), d.id, "recueil", {
        reponses: RECUEIL,
      });
      return d.id;
    }
    for (const st of o.stagiaires) {
      const acteur = await apprenant(st, d.id);
      await enregistrerEvaluation(s, acteur, d.id, "recueil", { reponses: RECUEIL });
      await enregistrerEvaluation(s, acteur, d.id, "positionnement", { reponses: [1, 1, 0, 1] });
    }
    await executerAction(s, sophie, d.id, "soumettre_validation");
    if (jalon === "soumis") return d.id;
    await executerAction(s, admin, d.id, "valider_dossier");
    if (jalon === "valide") return d.id;

    // Anne signe tout en ligne ; les autres apprenants retournent des documents signés sur papier :
    // la démonstration montre ainsi les deux voies de retour du cahier des charges (F-COM-06 a et b).
    const signerTout = async (codes: string[]) => {
      const vue = await lireDossier(s, sophie, d.id);
      for (const p of vue.pieces.filter((x) => codes.includes(x.code) && x.statut === "en_attente")) {
        if (p.code === "04-AVT") {
          await signerPiece(s, sophie, p.id, signature(7));
          continue;
        }
        const stagiaireId = p.stagiaire_id ?? o.stagiaires[0]!;
        const acteur = await apprenant(stagiaireId, d.id);
        if (stagiaireId === anne.id) await signerPiece(s, acteur, p.id, signature(2));
        else await deposerRetour(s, acteur, p.id, pdfFictif(`${p.code} signé`));
      }
    };
    const anneParticipe = o.stagiaires.includes(anne.id);

    await signerTout(["PRE", "02-AVT"]);
    if (jalon === "refus") {
      await executerAction(s, sophie, d.id, "declarer_depot");
      await deposerPieceExterne(s, sophie, d.id, "REF", pdfFictif("Refus de prise en charge"));
      await executerAction(s, sophie, d.id, "enregistrer_refus", {
        motif: "Enveloppe budgétaire de la branche épuisée pour l'exercice.",
      });
      return d.id;
    }
    // L'apprenant affirme lui-même, depuis son espace, avoir déposé la demande auprès de son OPCO.
    await executerAction(s, await apprenant(o.stagiaires[0]!, d.id), d.id, "declarer_depot");
    await deposerPieceExterne(s, admin, d.id, "ACC", pdfFictif("Accord de prise en charge"));
    if (jalon === "accord") return d.id;

    await signerTout(["04-AVT"]);
    await executerAction(s, sophie, d.id, "envoyer_elements_pedagogiques");
    await signerTout(["05-AVT"]);
    await executerAction(s, sophie, d.id, "demarrer_formation");
    const seances = (await lireDossier(s, sophie, d.id)).seances;
    const faites = jalon === "en_cours" ? seances.slice(0, 2) : seances;
    for (const se of faites) {
      if (anneParticipe)
        await emarger(s, await apprenant(anne.id, d.id), se.id, { trace_png: tracePngDemo(2) });
      await emarger(s, sophie, se.id, { trace_png: tracePngDemo(7) });
    }
    if (jalon === "en_cours") return d.id;

    if (anneParticipe)
      await enregistrerEvaluation(s, await apprenant(anne.id, d.id), d.id, "acquis", {
        reponses: [1, 1, 0, 2],
      });
    await renseignerObjectifsAtteints(
      s,
      sophie,
      d.id,
      "Les objectifs ont été travaillés sur les fichiers réels des stagiaires ; les tableaux de bord produits sont exploitables en l'état.",
    );
    await executerAction(s, sophie, d.id, "terminer_formation");
    await signerTout(["06-PDT", "07-FIN", "09-FIN"]);
    if (anneParticipe)
      await enregistrerEvaluation(s, await apprenant(anne.id, d.id), d.id, "satisfaction_chaud", {
        reponses: { ...NOTES, commentaire: "Formation très concrète, directement applicable." },
      });
    if (jalon === "termine") return d.id;

    await executerAction(s, admin, d.id, "demander_paiement");
    if (jalon === "paiement") return d.id;
    await executerAction(s, admin, d.id, "enregistrer_paiement");
    const facture = (await lireDossier(s, sophie, d.id)).pieces.find((p) => p.code === "10-FIN")!;
    await deposerRetour(s, sophie, facture.id, pdfFictif("Facture SL Conseil"));
    await executerAction(s, admin, d.id, "cloturer");
    return d.id;
  }

  // Du plus avancé au plus récent : le pipeline est rempli de gauche à droite.
  await dossier("archive", {
    stagiaires: [anne.id, luc.id],
    entreprise: dupont.id,
    formation: excel.id,
    debut: -60,
  });
  await dossier("paiement", {
    stagiaires: [ines.id],
    entreprise: transalp.id,
    formation: management.id,
    debut: -25,
  });
  await dossier("termine", {
    stagiaires: [anne.id],
    entreprise: dupont.id,
    formation: management.id,
    debut: -10,
    financement: "entreprise",
  });
  await dossier("en_cours", {
    stagiaires: [anne.id, lea.id],
    entreprise: dupont.id,
    formation: excel.id,
    debut: -1,
  });
  await dossier("accord", {
    stagiaires: [theo.id],
    entreprise: transalp.id,
    formation: excel.id,
    debut: 12,
    modalite: "distanciel",
  });
  await dossier("refus", {
    stagiaires: [luc.id],
    entreprise: dupont.id,
    formation: management.id,
    debut: 20,
    financement: "faf",
  });
  await dossier("valide", { stagiaires: [anne.id], entreprise: dupont.id, formation: excel.id, debut: 30 });
  await dossier("soumis", {
    stagiaires: [ines.id, theo.id],
    entreprise: transalp.id,
    formation: excel.id,
    debut: 40,
  });
  await dossier("brouillon", {
    stagiaires: [lea.id],
    entreprise: dupont.id,
    formation: management.id,
    debut: 55,
  });

  // ——— « Modification 1 » (23/09/2026) : parcours généré, supports PPTX, coffre-fort, positionnements ———
  const prospection = await creerFormation(s, sophie, {
    formation_titre: "Prospection commerciale B2B",
    formation_niveau: "Intermédiaire",
    formation_domaine: "Commercial, vente et prospection",
    formation_duree_heures_total: 21,
    formation_duree_jours: 3,
    formation_prix_unitaire_ht: 140_000,
    formation_prix_groupe_ht: 450_000,
    formation_effectif_min: 2,
    formation_effectif_max: 8,
    formation_modules: MODULES_PROSPECTION,
    public_vise: "Commerciaux, chargés d'affaires, dirigeants de TPE.",
    formation_prerequis: "Aucun.",
    formation_delai_acces: "Sous 2 semaines",
    formation_modalites_sanction: "Attestation de fin de formation",
    mode_financement: "opco",
    formation_opco: "OPCO EP (Entreprises de proximité)",
  });
  for (const [i, m] of MODULES_PROSPECTION.entries())
    await produireSupport(s, sophie, { formation_id: prospection.id, module_index: i, diapos: planDemo(m) });
  await enregistrerOutil(s, sophie, {
    type: "positionnement",
    titre: "Positionnement — prospection B2B",
    formation_id: prospection.id,
    contenu: { ...QCM_EXCEL, titre: "Positionnement — prospection B2B" },
  });
  await deposerDansCoffre(s, sophie, prospection.id, pdfFictif("Règlement intérieur"), {
    categorie: "qualite",
    partageable: false,
  });
  const signe = await inviterAuPositionnement(s, sophie, {
    stagiaire_id: lea.id,
    formation_id: prospection.id,
    message: "Merci de compléter avant notre entretien.",
  });
  const jetonLea = signe.lien.split("/").pop()!;
  const vueLea = await lirePositionnementPublic(s, jetonLea);
  await signerPositionnementPublic(s, jetonLea, {
    recueil: RECUEIL,
    reponses: vueLea.questionnaire!.questions.map((_, i) => i % 3),
    date: jour(0),
    trace_png: tracePngDemo(3),
    lieu: "Mulhouse",
    consentement: true,
  });
  await inviterAuPositionnement(s, sophie, { stagiaire_id: luc.id, formation_id: prospection.id });
}

// Exécution directe : `npm run db:seed` (sur une base vide).
if (import.meta.url === `file://${process.argv[1]}`) {
  await import("../env");
  const { lireConfig } = await import("../config");
  const { ouvrirBase } = await import("./connexion");
  const { ArchiveLocale } = await import("../ports/archive");
  const { CourrierJournalise } = await import("../ports/courrier");
  const { horlogeSysteme } = await import("../ports/divers");
  const { sansPdf } = await import("../ports/pdf");
  const { chiffreurEphemere } = await import("../ports/chiffrement");
  const { organismeExiste } = await import("./amorce");
  const config = lireConfig();
  const { bd, fermer } = await ouvrirBase(config.DATABASE_URL);
  const archive = new ArchiveLocale(config.ARCHIVE_DIR);
  const s: Services = {
    bd,
    archive,
    courrier: new CourrierJournalise(bd, archive),
    pdf: sansPdf,
    horloge: horlogeSysteme,
    appUrl: config.APP_URL,
    secrets: chiffreurEphemere(),
  };
  if (await organismeExiste(s))
    console.log(
      "La base contient déjà des données : semence ignorée. Supprimez le dossier « donnees » pour repartir de zéro.",
    );
  else {
    await semer(s);
    console.log(`Jeu de démonstration créé. Mot de passe de tous les comptes : ${MDP_DEMO}`);
    for (const c of COMPTES_DEMO) console.log(`  ${c.role.padEnd(36)} ${c.email}`);
  }
  await fermer();
}
