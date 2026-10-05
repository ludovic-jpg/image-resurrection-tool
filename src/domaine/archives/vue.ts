/**
 * Vue « Archives et corbeille » d'un formateur — règle PURE (mise en forme des lignes lues sous RLS).
 * Reprise de `archivesEtCorbeille` (`src/serveur/services/sauvegarde.ts`) : mêmes champs, mêmes libellés.
 */

type Ligne = Record<string, unknown>;

export type TypeOutil = "recueil" | "positionnement" | "acquis";

export interface VueArchives {
  formations: Array<{ id: string; titre: string; depuis: string | null }>;
  outils: Array<{ id: string; titre: string; type: TypeOutil; depuis: string | null }>;
  fichiers: Array<{
    id: string;
    nom: string;
    formation: string;
    formation_id: string;
    depuis: string | null;
    taille: number;
  }>;
  stagiaires: Array<{ id: string; nom: string; depuis: string | null }>;
  entreprises: Array<{ id: string; nom: string; depuis: string | null }>;
  positionnements: Array<{ id: string; nom: string; depuis: string | null }>;
}

const texte = (v: unknown) => (typeof v === "string" ? v : "");
const dateOuNull = (v: unknown) => (typeof v === "string" ? v : null);

export function construireArchives(e: {
  formations: readonly Ligne[];
  outils: readonly Ligne[];
  /** Fichiers de coffre à la corbeille, du plus récemment supprimé au plus ancien. */
  fichiers: readonly Ligne[];
  /** Formations des fichiers de la corbeille (pour le titre), même archivées. */
  formations_des_fichiers: readonly Ligne[];
  stagiaires: readonly Ligne[];
  entreprises: readonly Ligne[];
  /** Lignes de la vue `positionnement_vue` (porte déjà le nom de l'apprenant), archivées. */
  positionnements: readonly Ligne[];
}): VueArchives {
  const titreFormation = new Map(
    e.formations_des_fichiers.map((f) => [texte(f["id"]), texte(f["formation_titre"])]),
  );
  return {
    formations: e.formations.map((f) => ({
      id: texte(f["id"]),
      titre: texte(f["formation_titre"]),
      depuis: dateOuNull(f["archivee_le"]),
    })),
    outils: e.outils.map((o) => ({
      id: texte(o["id"]),
      titre: texte(o["titre"]),
      type: texte(o["type"]) as TypeOutil,
      depuis: dateOuNull(o["archive_le"]),
    })),
    // Comme l'ancienne jointure interne : un fichier dont la formation n'est pas lisible n'est pas listé.
    fichiers: e.fichiers
      .filter((c) => titreFormation.has(texte(c["formation_id"])))
      .map((c) => ({
        id: texte(c["id"]),
        nom: texte(c["nom_fichier"]),
        formation: titreFormation.get(texte(c["formation_id"])) ?? "",
        formation_id: texte(c["formation_id"]),
        depuis: dateOuNull(c["supprime_le"]),
        taille: Number(c["taille"] ?? 0),
      })),
    stagiaires: e.stagiaires.map((s) => ({
      id: texte(s["id"]),
      nom: `${texte(s["stagiaire_prenom"])} ${texte(s["stagiaire_nom"])}`,
      depuis: dateOuNull(s["archive_le"]),
    })),
    entreprises: e.entreprises.map((x) => ({
      id: texte(x["id"]),
      nom: texte(x["entreprise_nom"]),
      depuis: dateOuNull(x["archive_le"]),
    })),
    positionnements: e.positionnements.map((p) => ({
      id: texte(p["id"]),
      nom: `${texte(p["apprenant"])} — ${texte(p["formation_titre"])}`,
      depuis: dateOuNull(p["archive_le"]),
    })),
  };
}
