/**
 * Export du coffre-fort d'un parcours en archive ZIP — port de `exporterCoffreZip` de `src/serveur/services/coffre.ts`.
 *
 * Contenu : le programme imprimable (« 00 - Programme.html »), les fichiers du coffre rangés par rubrique, les
 * questionnaires en HTML imprimable (sans corrigé), les positionnements signés (PDF). Lecture de Storage par le client
 * « service », APRÈS avoir vérifié que la formation est celle de l'acteur (formateur propriétaire) ou de son organisme
 * (administrateur) : sinon « introuvable ».
 *
 * Un fichier illisible ne fait pas échouer l'export : il est remplacé par une note « MANQUANT ». Pour protéger la
 * mémoire d'un Worker, un coffre de plus de `LIMITE_OCTETS` est refusé avec un message qui propose le téléchargement
 * fichier par fichier (l'ancien serveur Node n'avait pas cette limite).
 */
import JSZip from "jszip";
import { nomSur } from "@/domaine/archive/chemins";
import { CATEGORIES_COFFRE } from "@/domaine/pedagogie/listes";
import {
  documentOutil,
  documentProgramme,
  type FormationImprimable,
  type OutilImprimable,
} from "@/domaine/pedagogie/documents";
import type { Acteur } from "./acteur.server";
import { ouvrirArchive } from "./archive.server";
import type { BdService } from "./bd.server";
import { introuvable, invalide, leverSiErreurBd } from "./erreurs.server";

/** Somme des tailles des fichiers du coffre au-delà de laquelle l'export est refusé (25 Mo). */
export const LIMITE_OCTETS = 25 * 1024 * 1024;

export interface ZipCoffre {
  nom: string;
  type_mime: "application/zip";
  taille: number;
  /** Le ZIP, en base64 (une fonction serveur renvoie du JSON). */
  contenu_base64: string;
}

function enBase64(octets: Uint8Array): string {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000)
    s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Un nom de fichier libre dans le dossier : « a.html », puis « a (2).html »… (JSZip écraserait en silence). */
function nomLibre(pris: Set<string>, chemin: string): string {
  if (!pris.has(chemin)) return (pris.add(chemin), chemin);
  const point = chemin.lastIndexOf(".");
  const base = point > chemin.lastIndexOf("/") ? chemin.slice(0, point) : chemin;
  const ext = base === chemin ? "" : chemin.slice(point);
  for (let n = 2; ; n++) {
    const essai = `${base} (${n})${ext}`;
    if (!pris.has(essai)) return (pris.add(essai), essai);
  }
}

export async function exporterCoffreZip(
  bd: BdService,
  acteur: Acteur,
  formationId: string,
): Promise<ZipCoffre> {
  // Cloisonnement : l'administrateur voit son organisme, le formateur ses formations ; le reste est « introuvable ».
  let requete = bd.from("formation").select("*").eq("id", formationId).eq("of_id", acteur.of_id);
  if (acteur.role === "formateur") requete = requete.eq("formateur_id", acteur.formateur_id);
  const { data: formation, error } = await requete.maybeSingle();
  leverSiErreurBd(error, "lecture de la formation");
  if (!formation) throw introuvable("Formation");
  const f = formation as FormationImprimable & { id: string; formation_titre: string };

  const { data: of, error: errOf } = await bd
    .from("organisme_formation")
    .select("of_nom, couleur")
    .eq("id", acteur.of_id)
    .maybeSingle();
  leverSiErreurBd(errOf, "lecture de l'organisme");
  const identite = {
    nom: (of as { of_nom?: string } | null)?.of_nom || "Organisme de formation",
    couleur: (of as { couleur?: string } | null)?.couleur ?? "#1d6a45",
  };

  const { data: fichiers, error: errFichiers } = await bd
    .from("coffre_fichier")
    .select("nom_fichier, chemin, categorie, taille")
    .eq("formation_id", f.id)
    .eq("of_id", acteur.of_id)
    .is("supprime_le", null)
    .order("cree_le", { ascending: true });
  leverSiErreurBd(errFichiers, "lecture du coffre-fort");
  const lignes = (fichiers ?? []) as Array<{
    nom_fichier: string;
    chemin: string;
    categorie: string;
    taille: number;
  }>;
  const total = lignes.reduce((s, x) => s + (x.taille || 0), 0);
  if (total > LIMITE_OCTETS)
    throw invalide(
      `Ce coffre-fort est trop volumineux pour un export en une fois (${Math.ceil(total / 1048576)} Mo, limite ${LIMITE_OCTETS / 1048576} Mo). Téléchargez les fichiers un par un.`,
    );

  const zip = new JSZip();
  const pris = new Set<string>();
  const ajouter = (chemin: string, contenu: string | Uint8Array) =>
    zip.file(nomLibre(pris, chemin), contenu);

  ajouter("00 - Programme.html", documentProgramme(f, identite));

  const coffre = ouvrirArchive(bd, { ofId: acteur.of_id, bucket: "coffre" });
  for (const x of lignes) {
    const rubrique = CATEGORIES_COFFRE.find((c) => c.valeur === x.categorie)?.libelle ?? "Divers";
    try {
      ajouter(`${nomSur(rubrique)}/${nomSur(x.nom_fichier)}`, await coffre.lire(x.chemin));
    } catch {
      ajouter(
        `${nomSur(rubrique)}/MANQUANT - ${nomSur(x.nom_fichier)}.txt`,
        "Fichier introuvable dans l'archive.",
      );
    }
  }

  const { data: outils, error: errOutils } = await bd
    .from("modele_outil")
    .select("type, titre, contenu")
    .eq("formation_id", f.id)
    .eq("of_id", acteur.of_id)
    .is("archive_le", null);
  leverSiErreurBd(errOutils, "lecture des questionnaires");
  for (const o of (outils ?? []) as OutilImprimable[])
    ajouter(
      `Questionnaires/${nomSur(o.titre)}.html`,
      documentOutil(o, identite, f.formation_titre),
    );

  const { data: positions, error: errPositions } = await bd
    .from("positionnement")
    .select("chemin_pdf")
    .eq("formation_id", f.id)
    .eq("of_id", acteur.of_id)
    .eq("statut", "complet");
  leverSiErreurBd(errPositions, "lecture des positionnements");
  const archive = ouvrirArchive(bd, { ofId: acteur.of_id, bucket: "archive" });
  for (const p of (positions ?? []) as Array<{ chemin_pdf: string | null }>) {
    if (!p.chemin_pdf) continue;
    try {
      ajouter(
        `Positionnements signés/${p.chemin_pdf.split("/").pop()!}`,
        await archive.lire(p.chemin_pdf),
      );
    } catch {
      /* fichier absent : ignoré, comme l'ancien serveur */
    }
  }

  const contenu = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return {
    nom: `Coffre-fort - ${nomSur(f.formation_titre).slice(0, 80)}.zip`,
    type_mime: "application/zip",
    taille: contenu.length,
    contenu_base64: enBase64(contenu),
  };
}
