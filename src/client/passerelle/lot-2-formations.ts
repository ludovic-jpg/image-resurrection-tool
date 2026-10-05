/**
 * Lot 2 — formations et versions (routes 35 à 43).
 *
 * Les formations se lisent et s'écrivent directement sous RLS : le formateur voit les siennes, l'admin lit celles de
 * l'organisme. Trois choses ne se font JAMAIS ici :
 *  - l'historique (`version_objet`) : le déclencheur `s4m_version` photographie l'état précédent à chaque
 *    modification ; la restauration passe par la RPC `s4m_restaurer_version` ;
 *  - le journal (`evenement`) : écrit par les déclencheurs `s4m_journal` (création, archivage, restauration) ;
 *  - la duplication : RPC `s4m_dupliquer_formation`, atomique (formation + outils actifs).
 */
import { completerDepuisModules, controlerCoherence, resumer } from "@/domaine/pedagogie/formation";
import type { ModuleParcours } from "@/domaine/pedagogie/parcours";
import type { Formation } from "../api";
import { bd } from "../bd";
import { erreurInconnue } from "../aiguilleur";
import { route } from "../registre";
import {
  acteurCourant,
  corpsObjet,
  erreurRpc,
  exiger,
  exigerFormateurValide,
  invalide,
  lire,
  maintenant,
  valider,
  validerPartiel,
} from "./lot-2-commun";
import { lireFormation } from "./lot-2-lectures";
import { SchemaFormation } from "./lot-2-schemas";

const typeDeVersion = (type: string | undefined): "formation" | "outil" => {
  if (type !== "formation" && type !== "outil") throw invalide("Type inconnu.");
  return type;
};

function exigerCoherence(f: Parameters<typeof controlerCoherence>[0]): void {
  const incoherence = controlerCoherence(f);
  if (incoherence) throw invalide(incoherence.message, incoherence.details);
}

// 35 — GET /formations[?archivees=1] (formateur validé)
route("GET", "/formations", async ({ requete }) => {
  exigerFormateurValide(await acteurCourant());
  const donnees = await bd
    .from("formation")
    .select("*")
    .eq("archivee", requete.get("archivees") === "1")
    .order("cree_le", { ascending: false });
  return (lire(donnees) ?? []) as Formation[];
});

// 36 — POST /formations/:id/restaurer : sort une formation des archives (journal : déclencheur)
route("POST", "/formations/:id/restaurer", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  const restauree = await bd
    .from("formation")
    .update({ archivee: false, archivee_le: null })
    .eq("id", params["id"] ?? "")
    .select()
    .maybeSingle();
  return exiger(restauree, "Formation") as Formation;
});

// 37 — GET /versions/:type/:id : historique en lecture seule, avec un aperçu d'une ligne
route("GET", "/versions/:type/:id", async ({ params }) => {
  const type = typeDeVersion(params["type"]);
  exigerFormateurValide(await acteurCourant());
  const id = params["id"] ?? "";
  // Un objet qui n'est pas le sien est « introuvable », même s'il n'a pas encore d'historique.
  exiger(
    await bd
      .from(type === "formation" ? "formation" : "modele_outil")
      .select("id")
      .eq("id", id)
      .maybeSingle(),
    type === "formation" ? "Formation" : "Outil pédagogique",
  );
  const versions = await bd
    .from("version_objet")
    .select("id, cree_le, libelle, snapshot")
    .eq("type", type)
    .eq("objet_id", id)
    .order("cree_le", { ascending: false });
  return (
    (lire(versions) as Array<{
      id: string;
      cree_le: string;
      libelle: string;
      snapshot: unknown;
    }> | null) ?? []
  ).map((v) => ({
    id: v.id,
    cree_le: v.cree_le,
    libelle: v.libelle,
    apercu: resumer(type, v.snapshot),
  }));
});

// 38 — POST /versions/:id/restaurer : RPC (l'état courant est mémorisé d'abord, la restauration est réversible)
route("POST", "/versions/:id/restaurer", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  const { data, error } = await bd.rpc("s4m_restaurer_version", {
    p_version_id: params["id"] ?? "",
  });
  if (error) throw erreurRpc(error);
  return data as { type: "formation" | "outil"; id: string };
});

// 39 — POST /formations
route("POST", "/formations", async ({ corps }) => {
  const donnees = corpsObjet(corps);
  const acteur = await acteurCourant();
  const formateurId = exigerFormateurValide(acteur);
  const valeurs = completerDepuisModules(valider(() => SchemaFormation.parse(donnees)));
  exigerCoherence(valeurs);
  const creee = await bd
    .from("formation")
    .insert({
      ...valeurs,
      of_id: acteur.of_id,
      formateur_id: formateurId,
      enjeux_le: valeurs.dossier_enjeux ? maintenant() : null,
    })
    .select()
    .single();
  return exiger(creee, "Formation") as Formation;
});

// 40 — GET /formations/:id
route("GET", "/formations/:id", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  return lireFormation(params["id"] ?? "");
});

// 41 — PATCH /formations/:id (la version précédente est gardée par le déclencheur `s4m_version`)
route("PATCH", "/formations/:id", async ({ params, corps }) => {
  const donnees = corpsObjet(corps);
  exigerFormateurValide(await acteurCourant());
  const id = params["id"] ?? "";
  const avant = await lireFormation(id);
  const valeurs = validerPartiel(SchemaFormation, donnees);
  if (Object.keys(valeurs).length === 0) return avant;
  exigerCoherence({ ...avant, ...valeurs } as unknown as Parameters<typeof controlerCoherence>[0]);
  const complete =
    "formation_modules" in valeurs
      ? completerDepuisModules({
          ...valeurs,
          formation_modules: valeurs.formation_modules as ModuleParcours[],
          programme: valeurs.programme ?? avant.programme,
          formation_objectifs: valeurs.formation_objectifs ?? avant.formation_objectifs,
        })
      : valeurs;
  const modifiee = await bd.from("formation").update(complete).eq("id", id).select().maybeSingle();
  return exiger(modifiee, "Formation") as Formation;
});

// 42 — POST /formations/:id/dupliquer : RPC atomique (formation + outils actifs, sans le coffre)
route("POST", "/formations/:id/dupliquer", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  const { data, error } = await bd.rpc("s4m_dupliquer_formation", {
    p_formation_id: params["id"] ?? "",
  });
  if (error) throw erreurRpc(error);
  if (!data) throw erreurInconnue(new Error("s4m_dupliquer_formation n'a rien renvoyé"));
  return data as Formation;
});

// 43 — DELETE /formations/:id : archive (rien n'est détruit) ; journal : déclencheur
route("DELETE", "/formations/:id", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  const archivee = await bd
    .from("formation")
    .update({ archivee: true, archivee_le: maintenant() })
    .eq("id", params["id"] ?? "")
    .select("id")
    .maybeSingle();
  exiger(archivee, "Formation");
  return { ok: true };
});
