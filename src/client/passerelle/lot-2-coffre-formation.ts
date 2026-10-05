/**
 * Lot 2 — coffre-fort d'une formation (routes 44 à 49), téléchargement d'un fichier (55) et coffres de l'apprenant (56).
 *
 * Fichiers : bucket Storage privé `coffre`, chemin `<of_id>/coffres/<formation_id>/…`. Le dépôt va du navigateur
 * directement vers Storage (politique : formateur validé, sur SES formations) puis une ligne `coffre_fichier` est
 * insérée ; si l'insertion échoue, le fichier déposé est retiré. Le téléchargement passe par une URL signée de 60 s,
 * créée seulement si la ligne `coffre_fichier` est visible de l'appelant : c'est la RLS de cette table (propriétaire,
 * admin de l'organisme, apprenant dont le dossier a atteint l'accord de financement, fichier partageable) qui décide.
 * La purge définitive est refusée par la politique tant que le fichier n'est pas à la corbeille ; son journal
 * (`coffre_purge`) est écrit par un déclencheur SQL.
 */
import { cheminCoffre, erreurFichierCoffre, typeMimeDe } from "@/domaine/fichiers/regles";
import type { CoffreApprenant } from "../api";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { erreurInconnue } from "../aiguilleur";
import { route } from "../registre";
import {
  acteurCourant,
  corpsObjet,
  erreurStockage,
  exiger,
  exigerFormateurValide,
  exigerRole,
  invalide,
  maintenant,
  valider,
  validerPartiel,
} from "./lot-2-commun";
import { exigerFormateurOuAdmin, exigerFormationVisible, listerCoffre } from "./lot-2-lectures";
import { SchemaDepot } from "./lot-2-schemas";

/** Le fichier et les champs texte d'un envoi `api.fichier(…)` (FormData). */
function fichierDe(corps: unknown): { fichier: File; champs: Record<string, string> } {
  if (!(corps instanceof FormData)) throw invalide("Aucun fichier reçu.");
  const f = corps.get("fichier");
  if (!(f instanceof File)) throw invalide("Aucun fichier reçu.");
  const champs: Record<string, string> = {};
  for (const [cle, valeur] of corps.entries()) if (typeof valeur === "string") champs[cle] = valeur;
  return { fichier: f, champs };
}

/** Met à jour une ligne du coffre ; « aucune ligne » (RLS comprise) = fichier introuvable. */
async function modifierFichier(id: string, valeurs: Record<string, unknown>): Promise<void> {
  if (Object.keys(valeurs).length === 0) {
    exiger(await bd.from("coffre_fichier").select("id").eq("id", id).maybeSingle(), "Fichier");
    return;
  }
  const modifie = await bd
    .from("coffre_fichier")
    .update(valeurs)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  exiger(modifie, "Fichier");
}

// 44 — GET /formations/:id/coffre (formateur validé, admin)
route("GET", "/formations/:id/coffre", async ({ params }) => {
  exigerFormateurOuAdmin(await acteurCourant());
  const id = params["id"] ?? "";
  await exigerFormationVisible(id);
  return listerCoffre(id);
});

// 45 — POST /formations/:id/coffre : dépôt (Storage `coffre` puis ligne `coffre_fichier`)
route("POST", "/formations/:id/coffre", async ({ params, corps }) => {
  const acteur = await acteurCourant();
  const formateurId = exigerFormateurValide(acteur);
  const formationId = params["id"] ?? "";
  await exigerFormationVisible(formationId);
  const { fichier, champs } = fichierDe(corps);
  const refus = erreurFichierCoffre({ nom: fichier.name, taille: fichier.size });
  if (refus) throw invalide(refus);
  const options = valider(() =>
    SchemaDepot.parse({
      partageable: champs["partageable"] !== "non",
      categorie: champs["categorie"] || undefined,
      description: champs["description"] || undefined,
    }),
  );
  const id = crypto.randomUUID();
  const chemin = cheminCoffre(acteur.of_id, formationId, `${id.slice(0, 8)}_${fichier.name}`);
  const depot = await bd.storage
    .from("coffre")
    .upload(chemin, fichier, { contentType: typeMimeDe(fichier.name), upsert: false });
  if (depot.error) throw erreurStockage(depot.error);
  const ligne = await bd.from("coffre_fichier").insert({
    id,
    of_id: acteur.of_id,
    formateur_id: formateurId,
    formation_id: formationId,
    nom_fichier: fichier.name,
    chemin,
    taille: fichier.size,
    type_mime: typeMimeDe(fichier.name),
    partageable: options.partageable,
    categorie: options.categorie,
    description: options.description,
    origine: "depot",
  });
  if (ligne.error) {
    // Pas de fichier orphelin : on retire ce qu'on vient de déposer avant de signaler l'échec.
    await bd.storage.from("coffre").remove([chemin]);
    throw erreurInconnue(ligne.error);
  }
  return listerCoffre(formationId);
});

// 46 — PATCH /coffre/:id : partage seul, ou catégorie / description / partage
route("PATCH", "/coffre/:id", async ({ params, corps }) => {
  const donnees = corpsObjet(corps);
  exigerFormateurValide(await acteurCourant());
  const seulementPartage = Object.keys(donnees).length === 1 && "partageable" in donnees;
  const valeurs = seulementPartage
    ? { partageable: donnees["partageable"] === true }
    : validerPartiel(SchemaDepot, donnees);
  await modifierFichier(params["id"] ?? "", valeurs);
  return { ok: true };
});

// 47 — DELETE /coffre/:id : corbeille (le fichier reste dans Storage et se restaure)
route("DELETE", "/coffre/:id", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  await modifierFichier(params["id"] ?? "", { supprime_le: maintenant() });
  return { ok: true };
});

// 48 — POST /coffre/:id/restaurer
route("POST", "/coffre/:id/restaurer", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  await modifierFichier(params["id"] ?? "", { supprime_le: null });
  return { ok: true };
});

// 49 — DELETE /coffre/:id/definitif : purge, seulement depuis la corbeille
route("DELETE", "/coffre/:id/definitif", async ({ params }) => {
  exigerFormateurValide(await acteurCourant());
  const id = params["id"] ?? "";
  const f = exiger(
    await bd.from("coffre_fichier").select("id, chemin, supprime_le").eq("id", id).maybeSingle(),
    "Fichier",
  ) as { id: string; chemin: string; supprime_le: string | null };
  if (!f.supprime_le)
    throw new ErreurApi("Mettez d'abord le fichier à la corbeille.", 409, "conflit", null);
  // La ligne d'abord : si la politique la refuse, le fichier reste intact. Le journal est écrit par un déclencheur.
  const supprime = await bd.from("coffre_fichier").delete().eq("id", id).select("id").maybeSingle();
  exiger(supprime, "Fichier");
  const retrait = await bd.storage.from("coffre").remove([f.chemin]);
  if (retrait.error)
    console.warn("[coffre] fichier à retirer de Storage :", f.chemin, retrait.error);
  return { ok: true };
});

// 55 — GET /coffre/:id/telecharger : URL signée de 60 s (formateur propriétaire, admin, apprenant autorisé par RG-08)
route("GET", "/coffre/:id/telecharger", async ({ params }) => {
  await acteurCourant();
  const f = exiger(
    await bd
      .from("coffre_fichier")
      .select("nom_fichier, chemin, type_mime")
      .eq("id", params["id"] ?? "")
      .maybeSingle(),
    "Fichier",
  ) as { nom_fichier: string; chemin: string; type_mime: string };
  const signee = await bd.storage
    .from("coffre")
    .createSignedUrl(f.chemin, 60, { download: f.nom_fichier });
  if (signee.error) throw erreurStockage(signee.error);
  return {
    nom: f.nom_fichier,
    type_mime: f.type_mime || typeMimeDe(f.nom_fichier),
    url: signee.data.signedUrl,
  };
});

// 56 — GET /coffres (apprenant) : RPC qui encapsule la règle RG-08
route("GET", "/coffres", async () => {
  exigerRole(await acteurCourant(), "apprenant");
  const { data, error } = await bd.rpc("s4m_coffres_apprenant");
  if (error) throw erreurInconnue(error);
  return (data ?? []) as CoffreApprenant[];
});
