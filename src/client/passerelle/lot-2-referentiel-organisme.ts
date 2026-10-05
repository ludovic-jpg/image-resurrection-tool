/**
 * Lot 2 — référentiel embarqué (route 18) et configuration de l'organisme (routes 28 et 29).
 *
 * Le référentiel ne fait plus aucun appel réseau : c'est le noyau `src/domaine` lui-même. L'organisme complet
 * (IBAN, BIC, commission, signature du représentant) n'est lisible et modifiable que par l'admin, par la RLS de
 * `organisme_formation` ; le journal « organisme_modifie » est écrit par un déclencheur SQL, jamais par le client.
 */
import { ETAPES, SOUS_STATUTS } from "@/domaine/pipeline/statuts";
import { REGLES } from "@/domaine/pipeline/transitions";
import { NOMENCLATURE } from "@/domaine/referentiel/pieces";
import { champsOfManquants } from "@/domaine/referentiel/organisme";
import type { Organisme } from "../api";
import { bd } from "../bd";
import { route } from "../registre";
import { acteurCourant, corpsObjet, exigerRole, exiger, valider } from "./lot-2-commun";
import { SchemaOrganisme } from "./lot-2-schemas";

/** Route 18 : la même réponse que `GET /api/referentiel` du serveur Node, construite sur place. */
export function referentielEmbarque() {
  return {
    pieces: NOMENCLATURE,
    etapes: ETAPES,
    sous_statuts: SOUS_STATUTS,
    actions: Object.fromEntries(Object.entries(REGLES).map(([k, r]) => [k, r.libelle])),
  };
}

const lireOrganisme = async () =>
  exiger(await bd.from("organisme_formation").select("*").maybeSingle(), "Organisme") as Organisme;

const reponse = (organisme: Organisme) => ({
  organisme,
  manques: champsOfManquants(organisme),
});

// 18 — GET /referentiel
route("GET", "/referentiel", async () => referentielEmbarque());

// 28 — GET /admin/organisme (admin)
route("GET", "/admin/organisme", async () => {
  exigerRole(await acteurCourant(), "admin");
  return reponse(await lireOrganisme());
});

// 29 — PATCH /admin/organisme (admin)
route("PATCH", "/admin/organisme", async ({ corps }) => {
  const donnees = corpsObjet(corps);
  const acteur = await acteurCourant();
  exigerRole(acteur, "admin");
  const valeurs = valider(() => SchemaOrganisme.parse(donnees));
  if (Object.keys(valeurs).length === 0) return reponse(await lireOrganisme());
  const modifie = await bd
    .from("organisme_formation")
    .update(valeurs)
    .eq("id", acteur.of_id)
    .select()
    .maybeSingle();
  return reponse(exiger(modifie, "Organisme") as Organisme);
});
