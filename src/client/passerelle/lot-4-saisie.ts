/**
 * Lot 4 — saisies sur un dossier (Client + RLS, RPC SQL) : routes 90, 91, 92 et 94 de la carte.
 *
 *   90  PATCH  /dossiers/:id                      `update` sous RLS (colonnes de saisie seulement)
 *   91  DELETE /dossiers/:id                      `delete` sous RLS (brouillon, formateur propriétaire)
 *   92  PUT    /dossiers/:id/seances              RPC `s4m_definir_seances()` (delete + insert atomiques)
 *   94  PATCH  /dossiers/:id/objectifs-atteints   RPC `s4m_objectifs_atteints()` (une colonne, definer contrôlée)
 *
 * JAMAIS d'écriture de `sous_statut`, des motifs, de `valide_le`, `termine_le`, `archive_le`, `coffre_ouvert`, ni de
 * l'identité du dossier (`of_id`, `formateur_id`, `dossier_reference`) : seules les colonnes de
 * `CHAMPS_DOSSIER_MODIFIABLES` (noyau) partent à la base, et un déclencheur SQL refuse le reste. Le pipeline passe
 * uniquement par la fonction serveur `pipeline-transiter` (`lot-4-serveur.ts`).
 */
import {
  MESSAGE_DOSSIER_FIGE,
  MESSAGE_SUPPRESSION_REFUSEE,
  brouillonSupprimable,
  dossierModifiable,
} from "@/domaine/dossier/droits";
import { validerSaisieDossier, validerSeances } from "@/domaine/dossier/saisie";
import type { SousStatut } from "@/domaine/pipeline/statuts";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import { acteurCourant, corpsObjet, exiger, exigerRole, interdit, invalide } from "./lot-2-commun";
import { lireDossier } from "./lot-4-dossier";

/** Le dossier tel que la RLS le laisse voir à un acteur interne : « introuvable » sinon. */
async function dossierInterne(id: string) {
  const d = exiger<{ id: string; sous_statut: SousStatut }>(
    await bd.from("dossier_formation").select("id, sous_statut").eq("id", id).maybeSingle(),
    "Dossier",
  );
  return d;
}

/** Les triggers et fonctions SQL signalent une règle métier par une exception : son message est déjà en français. */
function erreurDeRegleSql(e: unknown): unknown {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "P0001" && err.message) {
    if (/introuvable/i.test(err.message))
      return new ErreurApi(err.message, 404, "introuvable", null);
    if (/interdit/i.test(err.message)) return interdit(err.message);
    if (/modifiable|archiv/i.test(err.message))
      return new ErreurApi(err.message, 409, "conflit", null);
    return invalide(err.message);
  }
  return e;
}

// 90 — PATCH /dossiers/:id
route("PATCH", "/dossiers/:id", async ({ params, corps }) => {
  const id = params["id"] ?? "";
  const acteur = await acteurCourant();
  const d = await dossierInterne(id);
  if (!dossierModifiable(acteur.role, d.sous_statut))
    throw new ErreurApi(MESSAGE_DOSSIER_FIGE, 409, "conflit", null);
  const v = validerSaisieDossier(corpsObjet(corps));
  if (!v.ok) throw invalide(v.message, { champs: v.champs });
  if (Object.keys(v.valeurs).length > 0) {
    // `maj_le` est posé par le déclencheur `s4m_maj_le`. La RLS (`s4m_dossier_modifiable`) rejoue la règle de statut.
    const { data, error } = await bd
      .from("dossier_formation")
      .update(v.valeurs)
      .eq("id", id)
      .select("id");
    if (error) throw erreurDeRegleSql(error);
    if (!data?.length) throw new ErreurApi(MESSAGE_DOSSIER_FIGE, 409, "conflit", null);
  }
  return lireDossier(id, acteur);
});

// 91 — DELETE /dossiers/:id : un brouillon se supprime, rien d'autre.
route("DELETE", "/dossiers/:id", async ({ params }) => {
  const id = params["id"] ?? "";
  const acteur = await acteurCourant();
  const d = await dossierInterne(id);
  if (!brouillonSupprimable(acteur.role, d.sous_statut))
    throw new ErreurApi(MESSAGE_SUPPRESSION_REFUSEE, 409, "conflit", null);
  const { data, error } = await bd.from("dossier_formation").delete().eq("id", id).select("id");
  if (error) throw erreurDeRegleSql(error);
  if (!data?.length) throw new ErreurApi(MESSAGE_SUPPRESSION_REFUSEE, 409, "conflit", null);
  return { ok: true };
});

// 92 — PUT /dossiers/:id/seances
route("PUT", "/dossiers/:id/seances", async ({ params, corps }) => {
  const id = params["id"] ?? "";
  const acteur = await acteurCourant();
  const d = await dossierInterne(id);
  if (!dossierModifiable(acteur.role, d.sous_statut))
    throw new ErreurApi(MESSAGE_DOSSIER_FIGE, 409, "conflit", null);
  const v = validerSeances(corpsObjet(corps)["seances"]);
  if (!v.ok) throw invalide(v.message, { champs: v.champs });
  const { error } = await bd.rpc("s4m_definir_seances", { p_dossier_id: id, p_seances: v.valeurs });
  if (error) throw erreurDeRegleSql(error);
  return lireDossier(id, acteur);
});

// 94 — PATCH /dossiers/:id/objectifs-atteints
route("PATCH", "/dossiers/:id/objectifs-atteints", async ({ params, corps }) => {
  const acteur = await acteurCourant();
  exigerRole(acteur, "admin", "formateur");
  const texte = corpsObjet(corps)["texte"];
  const { error } = await bd.rpc("s4m_objectifs_atteints", {
    p_dossier_id: params["id"] ?? "",
    p_valeur: typeof texte === "string" ? texte : "",
  });
  // « Dossier introuvable. » (404), « Accès interdit. » (403), « Ce dossier est archivé. » (409) : messages de la fonction SQL.
  if (error) throw erreurDeRegleSql(error);
  return { ok: true };
});
