/**
 * Lot 2 — schémas de validation des saisies (organisme, formation, outil, coffre, répertoire).
 *
 * Copie fidèle des schémas Zod de `src/serveur/services/` (organisme, formations, repertoire) : le service Node
 * validait avant d'écrire ; maintenant que le client écrit directement sous RLS, la validation se fait ici, avant
 * l'appel, et les contraintes `CHECK` de la base la doublent. Mêmes bornes, mêmes messages.
 */
import { z } from "zod";
import { validerEnjeux } from "@/domaine/pedagogie/enjeux";
import { CODES_CATEGORIES } from "@/domaine/pedagogie/listes";

// ——— Organisme ———

export const SchemaOrganisme = z
  .object({
    of_nom: z.string().trim().max(200),
    of_forme_juridique: z.string().trim().max(200),
    of_adresse: z.string().trim().max(400),
    of_siret: z.string().trim().max(20),
    of_nda_numero: z.string().trim().max(30),
    of_dreets_region: z.string().trim().max(100),
    of_qualiopi_numero: z.string().trim().max(60),
    of_certification_complementaire_numero: z.string().trim().max(60),
    of_representant_civilite: z.string().trim().max(20),
    of_representant_prenom: z.string().trim().max(100),
    of_representant_nom: z.string().trim().max(100),
    of_email_pedagogie: z.union([z.literal(""), z.string().trim().email()]),
    of_email_comptabilite: z.union([z.literal(""), z.string().trim().email()]),
    of_tribunal_competent: z.string().trim().max(200),
    of_iban: z.string().trim().max(50),
    of_bic: z.string().trim().max(20),
    of_banque_nom: z.string().trim().max(100),
    of_tva_intracom: z.string().trim().max(30),
    of_telephone: z.string().trim().max(30),
    formation_clause_subrogation: z.string().trim().max(2000),
    portage_commission_pourcentage: z.number().min(0).max(100),
    tva_pourcentage: z.number().min(0).max(100),
    delai_paiement_jours: z.number().int().min(0).max(365),
    conservation_annees: z.number().int().min(1).max(50),
    couleur: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB"),
    signature_representant_png: z.union([
      z.literal(""),
      z
        .string()
        .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
        .max(400_000),
    ]),
  })
  .partial();

// ——— Formation ———

const centimes = z.number().int().min(0).max(100_000_000).nullable().default(null);
const heures = z.number().min(0).max(2000).nullable().default(null);
const entier = (max: number) => z.number().int().min(0).max(max).nullable().default(null);

const SchemaModule = z.object({
  titre: z.string().trim().max(200),
  duree_heures: z.number().min(0).max(400),
  objectifs: z.array(z.string().trim().max(500)).max(8),
  contenus: z.array(z.string().trim().max(500)).max(15),
  methodes: z.string().trim().max(2000).default(""),
  mise_en_pratique: z.string().trim().max(2000).default(""),
  evaluation: z.string().trim().max(1000).default(""),
});

// Champs alignés sur les variables `formation_*` du dictionnaire (F-FORM-01), plus ceux de la convention.
export const SchemaFormation = z.object({
  formation_titre: z.string().trim().min(3, "L'intitulé est obligatoire.").max(200),
  formation_objectifs: z.string().trim().max(4000).default(""),
  formation_niveau: z.string().trim().max(100).default(""),
  formation_prerequis: z.string().trim().max(2000).default(""),
  formation_duree_heures_total: z.number().positive().max(2000).nullable().default(null),
  formation_duree_jours: z.number().positive().max(400).nullable().default(null),
  formation_modalite: z.enum(["presentiel", "distanciel", "mixte"]).default("presentiel"),
  formation_prix_unitaire_ht: centimes,
  programme: z.string().trim().max(20000).default(""),
  public_vise: z.string().trim().max(2000).default(""),
  formation_nb_modules: z.number().int().min(1).max(12).nullable().default(null),
  formation_modules: z.array(SchemaModule).max(12).default([]),
  formation_duree_heures_presentiel: heures,
  formation_duree_heures_distanciel: heures,
  formation_prix_groupe_ht: centimes,
  formation_effectif_min: entier(500),
  formation_effectif_max: entier(500),
  formation_lieu_nom: z.string().trim().max(200).default(""),
  formation_lieu_adresse: z.string().trim().max(400).default(""),
  formation_lieu_siret: z.string().trim().max(20).default(""),
  formation_lien_visio: z
    .union([z.literal(""), z.string().trim().url("Lien de connexion invalide.").max(500)])
    .default(""),
  mode_financement: z.enum(["opco", "faf", "entreprise", "fonds_propres"]).default("opco"),
  formation_opco: z.string().trim().max(200).default(""),
  formation_domaine: z.string().trim().max(200).default(""),
  formation_moyens_pedagogiques: z.string().trim().max(4000).default(""),
  formation_modalites_evaluation: z.string().trim().max(4000).default(""),
  formation_modalites_sanction: z.string().trim().max(500).default(""),
  formation_accessibilite: z.string().trim().max(2000).default(""),
  formation_delai_acces: z.string().trim().max(200).default(""),
  /** Dossier d'enjeux proposé par l'IA à la génération du parcours ; validé strictement, jamais « réparé ». */
  dossier_enjeux: z
    .unknown()
    .nullable()
    .default(null)
    .transform((x, ctx) => {
      if (x === null || x === undefined) return null;
      const r = validerEnjeux(x);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: `Dossier d'enjeux invalide : ${r.erreurs[0]}` });
        return z.NEVER;
      }
      return r.valeur;
    }),
});

// ——— Outils pédagogiques ———

export const SchemaQuestionnaire = z.object({
  titre: z.string().trim().max(200),
  questions: z
    .array(
      z.object({
        enonce: z.string().trim().max(1000),
        propositions: z.array(z.string().trim().max(500)).max(8),
        bonne_reponse: z.number().int(),
      }),
    )
    .max(40),
});

export const SchemaOutil = z.object({
  type: z.enum(["recueil", "positionnement", "acquis"]),
  titre: z.string().trim().min(1, "Le titre est obligatoire.").max(200),
  formation_id: z.string().nullable().default(null),
  contenu: z.unknown(),
});

export const SchemaRecueil = z.object({
  questions_supplementaires: z.array(z.string().trim().min(3).max(500)).max(10).default([]),
});

// ——— Coffre-fort d'une formation ———

export const SchemaDepot = z.object({
  categorie: z.enum(CODES_CATEGORIES).default("support"),
  description: z.string().trim().max(500).default(""),
  partageable: z.boolean().default(true),
});

// ——— Répertoire ———

const email = z.union([
  z.literal(""),
  z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
]);

// Champs alignés sur les variables `entreprise_*` du dictionnaire.
export const SchemaEntreprise = z.object({
  entreprise_nom: z.string().trim().min(2, "La raison sociale est obligatoire.").max(200),
  entreprise_nom_commercial: z.string().trim().max(200).default(""),
  entreprise_adresse: z.string().trim().max(400).default(""),
  entreprise_siret: z.string().trim().max(20).default(""),
  entreprise_representant_civilite: z.string().trim().max(20).default(""),
  entreprise_representant_prenom: z.string().trim().max(100).default(""),
  entreprise_representant_nom: z.string().trim().max(100).default(""),
  entreprise_representant_telephone: z.string().trim().max(30).default(""),
  entreprise_representant_email: email.default(""),
  entreprise_opco: z.string().trim().max(200).default(""),
});

// Champs alignés sur les variables `stagiaire_*`.
export const SchemaStagiaire = z.object({
  stagiaire_prenom: z.string().trim().min(1, "Le prénom est obligatoire.").max(100),
  stagiaire_nom: z.string().trim().min(1, "Le nom est obligatoire.").max(100),
  stagiaire_email: email.default(""),
  stagiaire_telephone: z.string().trim().max(30).default(""),
  stagiaire_poste: z.string().trim().max(200).default(""),
  stagiaire_situation_handicap: z.string().trim().max(500).default(""),
  entreprise_id: z.string().nullable().default(null),
});

/** « Modification 1 » : en créant un apprenant, on peut créer son entreprise dans le même geste. */
export const SchemaStagiaireAvecEntreprise = SchemaStagiaire.extend({
  nouvelle_entreprise: SchemaEntreprise.nullable().default(null),
});
