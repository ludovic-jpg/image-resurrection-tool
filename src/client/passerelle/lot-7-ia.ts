/**
 * Lot 7 — assistant IA de l'espace pédagogique (routes 57 à 63 de la carte, section 1.9).
 *
 *  57  GET  /ia/etat          fonction serveur `lireEtatIa` (clé d'organisme déchiffrée, repli sur ANTHROPIC_API_KEY)
 *  58  POST /ia/qcm           `proposerQcm`        — brouillon de QCM (dossier d'enjeux constitué d'abord, au besoin)
 *  59  POST /ia/programme     `proposerProgramme`  — brouillon d'objectifs et de programme
 *  60  POST /ia/parcours      `proposerParcours`   — brouillon de parcours (recherche web, peut durer plus d'une minute)
 *  61  POST /ia/enjeux        `analyserEnjeux`     — écrit formation.dossier_enjeux (+ historique + journal), sur demande
 *  62  POST /ia/test          alias de 58 (« à supprimer dans le front Lovable », dit la carte)
 *  63  POST /ia/plan-support  `proposerPlanSupport`— plan de 20 diapositives d'un module (dossier d'enjeux d'abord)
 *
 * Les réponses gardent la forme exacte du service Node. L'IA ne sert qu'ici : jamais pour les conventions ni les pièces.
 */
import {
  analyserEnjeux,
  lireEtatIa,
  proposerParcours,
  proposerPlanSupport,
  proposerProgramme,
  proposerQcm,
} from "@/lib/pedagogie-ia.functions";
import { appelerServeur, corpsDe } from "../appel-serveur";
import { route, type Gestionnaire } from "../registre";
import type { EtatIa, PropositionParcours, ResultatEnjeux } from "../api";
import {
  assurerDossierEnjeux,
  exigerFormateurValideClient,
  lireFormationVisible,
} from "./lot-7-commun";

// 57
route("GET", "/ia/etat", async () => (await appelerServeur(() => lireEtatIa())) as EtatIa);

// 58 et 62 (alias)
const qcm: Gestionnaire = async ({ corps }) => {
  const c = corpsDe(corps);
  await exigerFormateurValideClient();
  // Seulement si la formation est précisée : sinon le serveur répond « Formation manquante » (400).
  if (typeof c["formation_id"] === "string" && c["formation_id"])
    await assurerDossierEnjeux(await lireFormationVisible(c["formation_id"]));
  return appelerServeur(() => proposerQcm({ data: c }));
};
route("POST", "/ia/qcm", qcm);
route("POST", "/ia/test", qcm);

// 59
route("POST", "/ia/programme", ({ corps }) =>
  appelerServeur(() => proposerProgramme({ data: corpsDe(corps) })),
);

// 60
route(
  "POST",
  "/ia/parcours",
  async ({ corps }) =>
    (await appelerServeur(() =>
      proposerParcours({ data: corpsDe(corps) }),
    )) as unknown as PropositionParcours,
);

// 61
route(
  "POST",
  "/ia/enjeux",
  async ({ corps }) =>
    (await appelerServeur(() =>
      analyserEnjeux({ data: corpsDe(corps) }),
    )) as unknown as ResultatEnjeux,
);

// 63
route("POST", "/ia/plan-support", async ({ corps }) => {
  const c = corpsDe(corps);
  await exigerFormateurValideClient();
  if (typeof c["formation_id"] === "string" && c["formation_id"])
    await assurerDossierEnjeux(await lireFormationVisible(c["formation_id"]));
  return appelerServeur(() => proposerPlanSupport({ data: c }));
});
