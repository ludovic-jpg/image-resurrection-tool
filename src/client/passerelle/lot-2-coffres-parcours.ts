/**
 * Lot 2 — coffre-fort pédagogique par parcours (routes 50, 51, 52) et document imprimable d'un outil (route 54).
 *
 * Lecture seule, sous RLS : le formateur voit ses parcours, l'admin ceux de l'organisme, l'apprenant aucun (403).
 *  - 50 : RPC `s4m_coffres_parcours()` (compteurs agrégés en une requête) ;
 *  - 51 : lectures parallèles (formation, coffre, outils, positionnements, dossiers, pièces, inscrits) assemblées par
 *    `assemblerCoffreParcours` du noyau, qui reproduit la forme du service Node. Les pièces ne sont lues que dans leurs
 *    colonnes d'état : jamais d'empreinte ni de chemin de fichier ;
 *  - 52 et 54 : HTML imprimable produit sur place (le navigateur l'imprime ou l'enregistre en PDF). Le corrigé d'un
 *    questionnaire ne sort que pour le formateur propriétaire et l'organisme.
 * Le ZIP du coffre (route 53) est une fonction serveur du lot 7.
 */
import { assemblerCoffreParcours } from "@/domaine/pedagogie/coffre";
import { documentOutil, documentProgramme } from "@/domaine/pedagogie/documents";
import { nomSur } from "@/domaine/fichiers/regles";
import type { ModuleParcours } from "@/domaine/pedagogie/parcours";
import type { CarteCoffre, VueCoffre } from "../api";
import { bd } from "../bd";
import { erreurInconnue } from "../aiguilleur";
import { route } from "../registre";
import { acteurCourant, exiger, interdit, lire } from "./lot-2-commun";
import {
  exigerFormateurOuAdmin,
  identiteOrganisme,
  lireFormation,
  listerCoffre,
} from "./lot-2-lectures";

type Dossier = Parameters<typeof assemblerCoffreParcours>[0]["dossiers"][number];
type Piece = Parameters<typeof assemblerCoffreParcours>[0]["pieces"][number];
type Inscrit = Parameters<typeof assemblerCoffreParcours>[0]["inscrits"][number];
type Outil = Parameters<typeof assemblerCoffreParcours>[0]["outils"][number];
type Positionnement = Parameters<typeof assemblerCoffreParcours>[0]["positionnements"][number];

/** Un `select` avec jointure renvoie un objet (relation vers un seul) ; on accepte aussi un tableau d'un élément. */
const unique = <T>(x: T | T[] | null | undefined): T | undefined =>
  Array.isArray(x) ? x[0] : (x ?? undefined);

// 50 — GET /coffres-parcours (formateur validé, admin)
route("GET", "/coffres-parcours", async () => {
  exigerFormateurOuAdmin(await acteurCourant());
  const { data, error } = await bd.rpc("s4m_coffres_parcours");
  if (error) throw erreurInconnue(error);
  return (data ?? []) as CarteCoffre[];
});

// 51 — GET /coffres-parcours/:id
route("GET", "/coffres-parcours/:id", async ({ params }) => {
  const acteur = await acteurCourant();
  exigerFormateurOuAdmin(acteur);
  const id = params["id"] ?? "";
  const formation = await lireFormation(id);
  const proprietaire = acteur.role === "formateur";
  const [fichiers, corbeille, outils, positionnements, dossiersBruts] = await Promise.all([
    listerCoffre(id),
    proprietaire ? listerCoffre(id, { corbeille: true }) : Promise.resolve([]),
    bd
      .from("modele_outil")
      .select("id, type, titre, contenu, maj_le")
      .eq("formation_id", id)
      .is("archive_le", null)
      .order("type"),
    bd
      .from("positionnement_vue")
      .select("id, apprenant, entreprise, statut, score, signe_le, pdf, expire")
      .eq("formation_id", id)
      .is("archive_le", null)
      .order("cree_le", { ascending: false }),
    bd
      .from("dossier_formation")
      .select(
        "id, dossier_reference, sous_statut, formation_date_debut, formation_date_fin, entreprise_cliente!inner(entreprise_nom)",
      )
      .eq("formation_id", id)
      .order("cree_le", { ascending: false }),
  ]);
  const dossiers = (
    (lire(dossiersBruts) ?? []) as Array<
      Omit<Dossier, "entreprise_nom"> & {
        entreprise_cliente: { entreprise_nom: string } | Array<{ entreprise_nom: string }>;
      }
    >
  ).map(({ entreprise_cliente, ...d }) => ({
    ...d,
    entreprise_nom: unique(entreprise_cliente)?.entreprise_nom ?? "",
  }));
  const ids = dossiers.map((d) => d.id);
  let pieces: Piece[] = [];
  let inscrits: Inscrit[] = [];
  if (ids.length > 0) {
    const [piecesBrutes, inscritsBruts] = await Promise.all([
      bd
        .from("piece_dossier")
        .select("id, dossier_id, code, stagiaire_id, statut, chemin_depart, chemin_retour")
        .in("dossier_id", ids),
      bd
        .from("stagiaire_dossier")
        .select("dossier_id, stagiaire_id, stagiaire!inner(stagiaire_prenom, stagiaire_nom)")
        .in("dossier_id", ids)
        .order("rang"),
    ]);
    pieces = (lire(piecesBrutes) ?? []) as Piece[];
    inscrits = (
      (lire(inscritsBruts) ?? []) as Array<{
        dossier_id: string;
        stagiaire_id: string;
        stagiaire:
          | { stagiaire_prenom: string; stagiaire_nom: string }
          | Array<{ stagiaire_prenom: string; stagiaire_nom: string }>;
      }>
    ).map(({ stagiaire, ...x }) => ({
      ...x,
      stagiaire_prenom: unique(stagiaire)?.stagiaire_prenom ?? "",
      stagiaire_nom: unique(stagiaire)?.stagiaire_nom ?? "",
    }));
  }
  const vue: VueCoffre = assemblerCoffreParcours({
    formation: { ...formation, formation_modules: formation.formation_modules as ModuleParcours[] },
    proprietaire,
    fichiers,
    corbeille,
    outils: (lire(outils) ?? []) as Outil[],
    positionnements: (lire(positionnements) ?? []) as Positionnement[],
    dossiers,
    pieces,
    inscrits,
  });
  return vue;
});

const HTML = "text/html; charset=utf-8";

// 52 — GET /coffres-parcours/:id/programme : programme imprimable (HTML)
route("GET", "/coffres-parcours/:id/programme", async ({ params }) => {
  exigerFormateurOuAdmin(await acteurCourant());
  const f = await lireFormation(params["id"] ?? "");
  const html = documentProgramme(f, await identiteOrganisme());
  return {
    nom: `Programme - ${nomSur(f.formation_titre).slice(0, 100)}.html`,
    contenu: html,
    type_mime: HTML,
  };
});

// 54 — GET /outils/:id/document[?corrige=1] : questionnaire imprimable (HTML)
route("GET", "/outils/:id/document", async ({ params, requete }) => {
  const acteur = await acteurCourant();
  if (acteur.role === "apprenant") throw interdit();
  const outil = exiger(
    await bd
      .from("modele_outil")
      .select("type, titre, contenu, formation_id")
      .eq("id", params["id"] ?? "")
      .maybeSingle(),
    "Questionnaire",
  ) as { type: string; titre: string; contenu: unknown; formation_id: string | null };
  const formation = outil.formation_id
    ? lire(
        await bd
          .from("formation")
          .select("formation_titre")
          .eq("id", outil.formation_id)
          .maybeSingle(),
      )
    : null;
  const avecCorrige = requete.get("corrige") === "1";
  const html = documentOutil(
    outil,
    await identiteOrganisme(),
    (formation as { formation_titre: string } | null)?.formation_titre ?? null,
    avecCorrige,
  );
  return {
    nom: `${nomSur(outil.titre).slice(0, 100)}${avecCorrige ? " - corrige" : ""}.html`,
    contenu: html,
    type_mime: HTML,
  };
});
