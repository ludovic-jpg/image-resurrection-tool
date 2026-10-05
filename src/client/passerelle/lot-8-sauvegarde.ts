/**
 * Lot 8 — archives et corbeille, sauvegarde de l'espace pédagogique (routes 84, 85 et 86 de la carte).
 *
 *  • 84 GET /archives             — Client + RLS : six listes filtrées sur `archive_le` / `supprime_le` non nuls ;
 *  • 85 GET /sauvegarde/export    — fonction serveur : JSON de portabilité + journal. Renvoie `{ nom, contenu, type_mime }` ;
 *  • 86 POST /sauvegarde/import   — fonction serveur : recrée formations et questionnaires en copies + journal.
 *
 * Formes de réponse : celles de `src/serveur/services/sauvegarde.ts` (`Archives` de `../api`).
 */
import { construireArchives } from "@/domaine/archives/vue";
import { TAILLE_MAX_SAUVEGARDE } from "@/domaine/sauvegarde/sauvegarde";
import { exporterMesDonnees, importerMesDonnees } from "@/lib/sauvegarde.functions";
import type { Archives } from "../api";
import { appelerServeur } from "../appel-serveur";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";
import { route } from "../registre";
import { acteurCourant, exigerFormateurValide, lire } from "./lot-2-commun";

type Ligne = Record<string, unknown>;

// 84 — GET /archives (formateur validé ; la RLS limite à ses objets, le filtre sur sa fiche le redit)
route("GET", "/archives", async (): Promise<Archives> => {
  const formateurId = exigerFormateurValide(await acteurCourant());
  const [formations, outils, fichiers, stagiaires, entreprises, positionnements] =
    await Promise.all([
      bd
        .from("formation")
        .select("*")
        .eq("archivee", true)
        .eq("formateur_id", formateurId)
        .order("cree_le", { ascending: false }),
      bd
        .from("modele_outil")
        .select("*")
        .eq("formateur_id", formateurId)
        .not("archive_le", "is", null)
        .order("cree_le", { ascending: false }),
      bd
        .from("coffre_fichier")
        .select("*")
        .eq("formateur_id", formateurId)
        .not("supprime_le", "is", null)
        .order("supprime_le", { ascending: false }),
      bd
        .from("stagiaire")
        .select("*")
        .eq("formateur_id", formateurId)
        .not("archive_le", "is", null)
        .order("stagiaire_nom")
        .order("stagiaire_prenom"),
      bd
        .from("entreprise_cliente")
        .select("*")
        .eq("formateur_id", formateurId)
        .not("archive_le", "is", null)
        .order("entreprise_nom"),
      bd
        .from("positionnement_vue")
        .select("id, apprenant, formation_titre, archive_le")
        .eq("formateur_id", formateurId)
        .not("archive_le", "is", null)
        .order("cree_le", { ascending: false }),
    ]);
  const fichiersCorbeille = (lire(fichiers) ?? []) as Ligne[];
  const idsFormations = [...new Set(fichiersCorbeille.map((f) => String(f["formation_id"])))];
  const formationsDesFichiers = idsFormations.length
    ? ((lire(await bd.from("formation").select("id, formation_titre").in("id", idsFormations)) ??
        []) as Ligne[])
    : [];

  return construireArchives({
    formations: (lire(formations) ?? []) as Ligne[],
    outils: (lire(outils) ?? []) as Ligne[],
    fichiers: fichiersCorbeille,
    formations_des_fichiers: formationsDesFichiers,
    stagiaires: (lire(stagiaires) ?? []) as Ligne[],
    entreprises: (lire(entreprises) ?? []) as Ligne[],
    positionnements: (lire(positionnements) ?? []) as Ligne[],
  });
});

// 85 — GET /sauvegarde/export
route("GET", "/sauvegarde/export", () => appelerServeur(() => exporterMesDonnees()));

// 86 — POST /sauvegarde/import (le fichier est lu ici ; le serveur le valide et le restaure)
route("POST", "/sauvegarde/import", async ({ corps }) => {
  const fichier = corps instanceof FormData ? corps.get("fichier") : null;
  if (!(fichier instanceof File)) throw new ErreurApi("Aucun fichier reçu.", 400, "invalide", null);
  if (fichier.size > TAILLE_MAX_SAUVEGARDE)
    throw new ErreurApi(
      "Ce fichier est trop volumineux pour une sauvegarde.",
      400,
      "invalide",
      null,
    );
  const contenu = await fichier.text();
  return appelerServeur(() => importerMesDonnees({ data: { contenu } }));
});
