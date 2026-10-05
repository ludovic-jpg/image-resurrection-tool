/**
 * Assemblage de la page « Coffre-fort pédagogique » d'un parcours.
 *
 * Version PURE du corps de `lireCoffreParcours` (`src/serveur/services/coffre.ts`) : le client lit les tables sous
 * RLS (formation, fichiers, outils, dossiers, pièces, inscrits, positionnements) et ce module en tire exactement la
 * forme que renvoyait le service Node. Il ne lit rien lui-même et ne filtre rien : ce que la RLS ne montre pas
 * n'arrive jamais ici.
 */
import { libelleSousStatut, type SousStatut } from "../pipeline/statuts";
import { definitionPiece, estCodePiece } from "../referentiel/pieces";
import type { ModuleParcours } from "./parcours";

export interface FichierCoffreLu {
  id: string;
  nom_fichier: string;
  taille: number;
  categorie: string;
  description: string;
  origine: string;
  partageable: boolean;
  cree_le: string;
  supprime_le: string | null;
}

export interface OutilLu {
  id: string;
  type: "recueil" | "positionnement" | "acquis";
  titre: string;
  contenu: unknown;
  maj_le: string;
}

export interface DossierLu {
  id: string;
  dossier_reference: string;
  sous_statut: string;
  formation_date_debut: string;
  formation_date_fin: string;
  entreprise_nom: string;
}

export interface PieceLue {
  id: string;
  dossier_id: string;
  code: string;
  stagiaire_id: string | null;
  statut: "en_attente" | "valide";
  chemin_depart: string | null;
  chemin_retour: string | null;
}

export interface InscritLu {
  dossier_id: string;
  stagiaire_id: string;
  stagiaire_prenom: string;
  stagiaire_nom: string;
}

export interface PositionnementLu {
  id: string;
  apprenant: string;
  entreprise: string;
  statut: "envoye" | "en_cours" | "complet";
  score: number | null;
  signe_le: string | null;
  pdf: boolean;
  expire: boolean;
}

export interface EntreesCoffreParcours {
  formation: {
    id: string;
    formation_titre: string;
    formation_duree_heures_total: number | null;
    formation_niveau: string;
    formation_modules: ModuleParcours[];
  };
  /** Vrai pour le formateur propriétaire, faux pour l'organisme (qui ne dépose ni ne supprime). */
  proprietaire: boolean;
  fichiers: FichierCoffreLu[];
  /** Vide pour l'organisme : seule la personne qui a déposé voit la corbeille. */
  corbeille: FichierCoffreLu[];
  outils: OutilLu[];
  positionnements: PositionnementLu[];
  dossiers: DossierLu[];
  pieces: PieceLue[];
  inscrits: InscritLu[];
}

const nombreDeQuestions = (contenu: unknown): number => {
  const c = (contenu ?? {}) as { questions?: unknown[]; questions_supplementaires?: unknown[] };
  return (c.questions ?? c.questions_supplementaires ?? []).length;
};

export function assemblerCoffreParcours(e: EntreesCoffreParcours) {
  const { formation: f } = e;
  const nomStagiaire = (id: string | null) => {
    const st = e.inscrits.find((x) => x.stagiaire_id === id);
    return st ? `${st.stagiaire_prenom} ${st.stagiaire_nom}` : "";
  };
  return {
    formation: {
      id: f.id,
      formation_titre: f.formation_titre,
      formation_duree_heures_total: f.formation_duree_heures_total,
      formation_niveau: f.formation_niveau,
      modules: f.formation_modules.map((m, i) => ({
        rang: i + 1,
        titre: m.titre,
        duree_heures: m.duree_heures,
      })),
      proprietaire: e.proprietaire,
    },
    fichiers: e.fichiers.map((x) => ({
      id: x.id,
      nom_fichier: x.nom_fichier,
      taille: x.taille,
      categorie: x.categorie,
      description: x.description,
      origine: x.origine,
      partageable: x.partageable,
      cree_le: x.cree_le,
    })),
    corbeille: e.corbeille.map((x) => ({
      id: x.id,
      nom_fichier: x.nom_fichier,
      taille: x.taille,
      categorie: x.categorie,
      supprime_le: x.supprime_le,
    })),
    outils: e.outils.map((o) => ({
      id: o.id,
      type: o.type,
      titre: o.titre,
      questions: nombreDeQuestions(o.contenu),
      maj_le: o.maj_le,
    })),
    positionnements: e.positionnements.map(
      ({ id, apprenant, entreprise, statut, score, signe_le, pdf, expire }) => ({
        id,
        apprenant,
        entreprise,
        statut,
        score,
        signe_le,
        pdf,
        expire,
      }),
    ),
    dossiers: e.dossiers.map((d) => {
      const sesPieces = e.pieces.filter((p) => p.dossier_id === d.id && estCodePiece(p.code));
      const deposees = sesPieces.filter((p) => p.chemin_depart || p.chemin_retour);
      return {
        id: d.id,
        reference: d.dossier_reference,
        entreprise: d.entreprise_nom,
        statut: libelleSousStatut(d.sous_statut as SousStatut),
        stagiaires: e.inscrits
          .filter((x) => x.dossier_id === d.id)
          .map((x) => `${x.stagiaire_prenom} ${x.stagiaire_nom}`),
        dates: d.formation_date_debut ? `${d.formation_date_debut} → ${d.formation_date_fin}` : "",
        progression: {
          validees: sesPieces.filter((p) => p.statut === "valide").length,
          total: sesPieces.length,
          disponibles: deposees.length,
        },
        pieces: sesPieces
          .map((p) => {
            const def = definitionPiece(p.code as Parameters<typeof definitionPiece>[0]);
            return {
              id: p.id,
              code: p.code,
              ordre: def.ordre,
              libelle: def.libelle,
              stagiaire: nomStagiaire(p.stagiaire_id),
              statut: p.statut,
              depart: Boolean(p.chemin_depart),
              retour: Boolean(p.chemin_retour),
              suivi: def.suiviStatut,
            };
          })
          .sort((a, b) => a.code.localeCompare(b.code)),
      };
    }),
  };
}
