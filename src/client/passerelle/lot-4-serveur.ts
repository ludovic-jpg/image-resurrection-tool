/**
 * Lot 4 — routes qui passent par une fonction serveur : 88, 93, 95, 96, 97 et 98 de la carte.
 *
 *   88  POST /dossiers                        `creerDossier`             (src/lib/dossiers.functions.ts)
 *   93  PUT  /dossiers/:id/stagiaires         `definirStagiaires`        (id.)
 *   95  POST /dossiers/:id/actions/:action    `transiterDossier`         (src/lib/pipeline-transiter.functions.ts)
 *   96  POST /dossiers/:id/inviter            `inviterApprenantDossier`  (src/lib/dossiers.functions.ts)
 *   97  POST /dossiers/:id/relancer           `relancerApprenantDossier` (id.)
 *   98  POST /dossiers/:id/recreer            `recreerDossier`           (id.)
 *
 * Pas de pré-contrôle de rôle ici : c'est le serveur qui décide (refus 403 en français). Le sous-statut ne s'écrit
 * que dans `src/lib/serveur/pipeline.server.ts`, après décision du noyau (`transiter()`).
 */
import {
  creerDossier,
  definirStagiaires,
  inviterApprenantDossier,
  recreerDossier,
  relancerApprenantDossier,
} from "@/lib/dossiers.functions";
import { transiterDossier } from "@/lib/pipeline-transiter.functions";
import { appelerServeur, corpsDe } from "../appel-serveur";
import { bd } from "../bd";
import { route } from "../registre";
import { exiger } from "./lot-2-commun";
import { lireDossier } from "./lot-4-dossier";

/** La ligne complète du dossier, relue sous RLS (formateur propriétaire / administrateur de l'organisme). */
const ligneDossier = async (id: string) =>
  exiger<Record<string, unknown>>(
    await bd.from("dossier_formation").select("*").eq("id", id).maybeSingle(),
    "Dossier",
  );

const texte = (v: unknown) => (typeof v === "string" ? v : "");

// 88 — POST /dossiers
route("POST", "/dossiers", async ({ corps }) => {
  const { id } = await appelerServeur(() => creerDossier({ data: corpsDe(corps) }));
  return ligneDossier(id);
});

// 93 — PUT /dossiers/:id/stagiaires
route("PUT", "/dossiers/:id/stagiaires", async ({ params, corps }) => {
  const id = params["id"] ?? "";
  const ids = corpsDe(corps)["stagiaire_ids"];
  await appelerServeur(() =>
    definirStagiaires({
      data: { dossier_id: id, stagiaire_ids: Array.isArray(ids) ? ids.map(String) : [] },
    }),
  );
  return lireDossier(id);
});

// 95 — POST /dossiers/:id/actions/:action
route("POST", "/dossiers/:id/actions/:action", async ({ params, corps }) => {
  const id = params["id"] ?? "";
  const motif = corpsDe(corps)["motif"];
  await appelerServeur(() =>
    transiterDossier({
      data: {
        dossier_id: id,
        action: params["action"] ?? "",
        ...(typeof motif === "string" ? { motif } : {}),
      },
    }),
  );
  return lireDossier(id);
});

// 96 — POST /dossiers/:id/inviter
route("POST", "/dossiers/:id/inviter", ({ params, corps }) =>
  appelerServeur(() =>
    inviterApprenantDossier({
      data: { dossier_id: params["id"] ?? "", stagiaire_id: texte(corpsDe(corps)["stagiaire_id"]) },
    }),
  ),
);

// 97 — POST /dossiers/:id/relancer
route("POST", "/dossiers/:id/relancer", ({ params, corps }) =>
  appelerServeur(() =>
    relancerApprenantDossier({
      data: { dossier_id: params["id"] ?? "", stagiaire_id: texte(corpsDe(corps)["stagiaire_id"]) },
    }),
  ),
);

// 98 — POST /dossiers/:id/recreer
route("POST", "/dossiers/:id/recreer", async ({ params }) => {
  const { id } = await appelerServeur(() =>
    recreerDossier({ data: { dossier_id: params["id"] ?? "" } }),
  );
  return ligneDossier(id);
});
