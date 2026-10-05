/** Configuration de l'organisme de formation (tenant). Tout ce qui l'identifie vit ici, jamais dans un gabarit. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Organisme } from "@/domaine/dossier/agregat";
import { organismeFormation } from "../bd/schema";
import { exigerRole, introuvable, journaliser, type Acteur, type Services } from "./socle";

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

/**
 * Champs sans lesquels une pièce contractuelle n'est pas émissible. Tant qu'ils sont vides, la validation
 * d'un dossier est refusée : mieux vaut un refus clair qu'une convention sans SIRET.
 * (Les incohérences relevées par la skill — deux SIRET, deux TVA, tribunal — se tranchent ICI, par saisie.)
 */
export const CHAMPS_OF_OBLIGATOIRES = [
  "of_nom",
  "of_adresse",
  "of_siret",
  "of_nda_numero",
  "of_dreets_region",
  "of_representant_prenom",
  "of_representant_nom",
  "of_email_pedagogie",
  "of_tribunal_competent",
] as const;

const LIBELLES: Record<(typeof CHAMPS_OF_OBLIGATOIRES)[number], string> = {
  of_nom: "Raison sociale",
  of_adresse: "Adresse",
  of_siret: "SIRET",
  of_nda_numero: "Numéro de déclaration d'activité",
  of_dreets_region: "Région de la DREETS",
  of_representant_prenom: "Prénom du représentant légal",
  of_representant_nom: "Nom du représentant légal",
  of_email_pedagogie: "E-mail pédagogie",
  of_tribunal_competent: "Tribunal compétent",
};

export function champsOfManquants(of: Partial<Record<string, unknown>>): string[] {
  return CHAMPS_OF_OBLIGATOIRES.filter((c) => !String(of[c] ?? "").trim()).map((c) => LIBELLES[c]);
}

export async function lireOrganisme(s: Services, of_id: string) {
  const [of] = await s.bd.select().from(organismeFormation).where(eq(organismeFormation.id, of_id));
  if (!of) throw introuvable("Organisme");
  return of;
}

export function versOrganismeDuNoyau(of: typeof organismeFormation.$inferSelect): Organisme {
  // Les colonnes portent le nom des variables : la conversion est une simple projection.
  const {
    id: _id,
    cree_le: _c,
    couleur: _co,
    signature_representant_png: _s,
    conservation_annees: _a,
    ...reste
  } = of;
  return reste;
}

export async function mettreAJourOrganisme(s: Services, acteur: Acteur, donnees: unknown) {
  exigerRole(acteur, "admin");
  const valeurs = SchemaOrganisme.parse(donnees);
  if (Object.keys(valeurs).length > 0)
    await s.bd.update(organismeFormation).set(valeurs).where(eq(organismeFormation.id, acteur.of_id));
  await journaliser(s, {
    of_id: acteur.of_id,
    acteur,
    type: "organisme_modifie",
    libelle: "Configuration de l'organisme modifiée",
    detail: { champs: Object.keys(valeurs) },
  });
  return lireOrganisme(s, acteur.of_id);
}
