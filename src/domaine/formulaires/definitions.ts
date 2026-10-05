/**
 * Formulaires à questions fixes, renseignés en ligne : recueil des besoins (00-AVT),
 * satisfaction à chaud (08-FIN) et à froid (12-APR).
 * Les questions du recueil et de la grille à chaud reprennent les matrices Word de l'organisme.
 */
import type { CodePiece } from "../referentiel/pieces";

export type TypeChamp = "texte" | "texte_long" | "note" | "choix";

export interface Champ {
  id: string;
  libelle: string;
  type: TypeChamp;
  options?: readonly string[];
  requis?: boolean;
}

export interface FormulaireDef {
  code: CodePiece;
  titre: string;
  introduction: string;
  champs: readonly Champ[];
}

export const NOTE_MIN = 1;
export const NOTE_MAX = 5;

export const FORMULAIRES = {
  "00-AVT": {
    code: "00-AVT",
    titre: "Recueil des besoins — pré-formation",
    introduction:
      "Ces informations permettent d'adapter la formation à votre contexte et à votre niveau de départ.",
    champs: [
      {
        id: "poste_anciennete",
        libelle: "Quel poste occupez-vous au sein de l'entreprise ? Depuis combien de temps ?",
        type: "texte_long",
        requis: true,
      },
      {
        id: "niveau_maitrise",
        libelle:
          "Selon vous, quel est votre niveau de maîtrise dans le domaine de la formation choisie ?",
        type: "choix",
        options: ["Débutant", "Notions de base", "Intermédiaire", "Avancé"],
        requis: true,
      },
      {
        id: "attentes",
        libelle: "Quelles sont vos attentes en participant à cette formation ?",
        type: "texte_long",
        requis: true,
      },
      {
        id: "besoins_principaux",
        libelle: "De quoi pensez-vous avoir le plus besoin ?",
        type: "texte_long",
        requis: true,
      },
      {
        id: "handicap",
        libelle:
          "Êtes-vous en situation de handicap, ou souhaitez-vous un aménagement de la formation ?",
        type: "choix",
        options: ["Non", "Oui"],
        requis: true,
      },
      {
        id: "handicap_precision",
        libelle: "Si oui, précisez les aménagements souhaités",
        type: "texte_long",
      },
      {
        id: "programme_transmis",
        libelle: "Le programme de la formation vous a-t-il bien été transmis ?",
        type: "choix",
        options: ["Oui", "Non"],
        requis: true,
      },
    ],
  },
  "08-FIN": {
    code: "08-FIN",
    titre: "Évaluation « à chaud » de l'action de formation",
    introduction:
      "Votre retour en fin de formation nourrit notre démarche qualité. Notez chaque critère de 1 (insuffisant) à 5 (excellent).",
    champs: [
      { id: "contenu", libelle: "Contenu de la formation", type: "note", requis: true },
      { id: "attentes", libelle: "Réponse à vos attentes", type: "note", requis: true },
      {
        id: "adaptation",
        libelle: "Adaptation du programme aux besoins réels du stagiaire",
        type: "note",
        requis: true,
      },
      { id: "programme", libelle: "Programme du stage", type: "note", requis: true },
      {
        id: "application",
        libelle:
          "Application pratique possible des éléments de la formation dans votre environnement professionnel",
        type: "note",
        requis: true,
      },
      { id: "pedagogie", libelle: "Pédagogie du formateur", type: "note", requis: true },
      { id: "competences", libelle: "Compétences du formateur", type: "note", requis: true },
      { id: "supports", libelle: "Qualité des supports pédagogiques", type: "note", requis: true },
      {
        id: "environnement",
        libelle: "Environnement de travail (salle, matériel disponible, connexion)",
        type: "note",
        requis: true,
      },
      { id: "globale", libelle: "Appréciation globale", type: "note", requis: true },
      { id: "commentaire", libelle: "Commentaires et suggestions", type: "texte_long" },
    ],
  },
  "12-APR": {
    code: "12-APR",
    titre: "Évaluation « à froid » — trois mois après la formation",
    introduction:
      "Trois mois après la formation, mesurons ensemble ses effets sur votre activité. Notez de 1 (pas du tout) à 5 (tout à fait).",
    champs: [
      {
        id: "pratique",
        libelle: "J'ai mis en pratique les acquis de la formation",
        type: "note",
        requis: true,
      },
      {
        id: "effets",
        libelle: "La formation a produit des effets mesurables sur mon activité",
        type: "note",
        requis: true,
      },
      {
        id: "mobilisation",
        libelle: "Les compétences acquises sont toujours mobilisées",
        type: "note",
        requis: true,
      },
      {
        id: "accompagnement",
        libelle: "L'accompagnement après la formation a été suffisant",
        type: "note",
        requis: true,
      },
      {
        id: "recommandation",
        libelle: "Je recommanderais cette formation",
        type: "note",
        requis: true,
      },
      { id: "commentaire", libelle: "Commentaire libre", type: "texte_long" },
    ],
  },
} as const satisfies Partial<Record<CodePiece, FormulaireDef>>;

export type CodeFormulaire = keyof typeof FORMULAIRES;
export type Reponses = Record<string, string>;

export function estCodeFormulaire(code: string): code is CodeFormulaire {
  return code in FORMULAIRES;
}

/** Contrôle les réponses. Retourne les erreurs par identifiant de champ (objet vide = valide). */
export function validerReponses(def: FormulaireDef, reponses: Reponses): Record<string, string> {
  const erreurs: Record<string, string> = {};
  const connus = new Set(def.champs.map((c) => c.id));
  for (const cle of Object.keys(reponses)) if (!connus.has(cle)) erreurs[cle] = "Champ inconnu";

  for (const champ of def.champs) {
    const valeur = (reponses[champ.id] ?? "").trim();
    if (valeur === "") {
      if (champ.requis) erreurs[champ.id] = "Réponse obligatoire";
      continue;
    }
    if (champ.type === "note") {
      const n = Number(valeur);
      if (!Number.isInteger(n) || n < NOTE_MIN || n > NOTE_MAX)
        erreurs[champ.id] = `Note attendue entre ${NOTE_MIN} et ${NOTE_MAX}`;
    } else if (champ.type === "choix" && !champ.options?.includes(valeur)) {
      erreurs[champ.id] = "Choix non proposé";
    } else if (valeur.length > 4000) {
      erreurs[champ.id] = "Réponse trop longue (4 000 caractères au plus)";
    }
  }
  return erreurs;
}

/** Moyenne des notes d'un formulaire (sur 5), ou `null` s'il n'y en a aucune. */
export function moyenneNotes(def: FormulaireDef, reponses: Reponses): number | null {
  const notes = def.champs
    .filter((c) => c.type === "note")
    .map((c) => Number(reponses[c.id]))
    .filter((n) => Number.isFinite(n) && n >= NOTE_MIN && n <= NOTE_MAX);
  if (notes.length === 0) return null;
  return Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 100) / 100;
}
