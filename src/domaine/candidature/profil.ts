/**
 * Profil du formateur candidat (route 20, PATCH /candidature) — validation PURE d'une mise à jour PARTIELLE.
 *
 * Copie fidèle de `SchemaProfilFormateur` de l'ancien serveur, sans Zod : seules les clés réellement envoyées sont
 * retenues (piège de Zod noté dans `socle.ts` : un `partial()` appliquait les valeurs par défaut des champs absents).
 * Les messages sont en français et indexés par champ, comme `ErreurApi.details.champs` l'attend.
 */

export interface ProfilFormateur {
  formateur_prenom: string;
  formateur_nom: string;
  formateur_telephone: string;
  formateur_entreprise_nom: string;
  formateur_entreprise_adresse: string;
  formateur_entreprise_siret: string;
  formateur_nda_numero: string;
  formateur_dreets_region: string;
  formateur_iban: string;
  formateur_bic: string;
  parcours: string;
  formateur_statut_juridique: string;
  formateur_domaines: string[];
  formateur_zones: string;
  formateur_langues: string;
  /** Centimes. */
  formateur_tarif_journalier: number | null;
  formateur_bio: string;
  formateur_linkedin: string;
  formateur_disponibilites: string;
  formateur_assurance_rc: string;
}

/** Longueur maximale des champs texte (le prénom et le nom doivent en plus être non vides). */
const LONGUEURS: Record<string, number> = {
  formateur_prenom: 100,
  formateur_nom: 100,
  formateur_telephone: 30,
  formateur_entreprise_nom: 200,
  formateur_entreprise_adresse: 400,
  formateur_entreprise_siret: 20,
  formateur_nda_numero: 30,
  formateur_dreets_region: 100,
  formateur_iban: 50,
  formateur_bic: 20,
  parcours: 8000,
  formateur_statut_juridique: 100,
  formateur_zones: 500,
  formateur_langues: 200,
  formateur_bio: 1500,
  formateur_linkedin: 300,
  formateur_disponibilites: 1000,
  formateur_assurance_rc: 300,
};
const NON_VIDES = new Set(["formateur_prenom", "formateur_nom"]);

export type ResultatProfil =
  { ok: true; valeurs: Partial<ProfilFormateur> } | { ok: false; champs: Record<string, string> };

function urlValide(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validerProfilFormateur(donnees: unknown): ResultatProfil {
  if (typeof donnees !== "object" || donnees === null || Array.isArray(donnees))
    return { ok: false, champs: { _: "Données illisibles." } };
  const brut = donnees as Record<string, unknown>;
  const valeurs: Record<string, unknown> = {};
  const champs: Record<string, string> = {};

  for (const [cle, max] of Object.entries(LONGUEURS)) {
    if (!(cle in brut)) continue;
    const v = brut[cle];
    if (typeof v !== "string") {
      champs[cle] = "Valeur invalide.";
      continue;
    }
    const t = v.trim();
    if (NON_VIDES.has(cle) && t.length === 0) champs[cle] = "Ce champ est obligatoire.";
    else if (t.length > max) champs[cle] = `Trop long (${max} caractères au maximum).`;
    else if (cle === "formateur_linkedin" && t !== "" && !urlValide(t))
      champs[cle] = "Adresse de profil invalide.";
    else valeurs[cle] = t;
  }

  if ("formateur_domaines" in brut) {
    const d = brut["formateur_domaines"];
    if (!Array.isArray(d) || d.length > 20 || d.some((x) => typeof x !== "string"))
      champs["formateur_domaines"] = "Liste de domaines invalide (20 au maximum).";
    else {
      const propres = (d as string[]).map((x) => x.trim());
      if (propres.some((x) => x.length === 0 || x.length > 100))
        champs["formateur_domaines"] = "Chaque domaine doit faire de 1 à 100 caractères.";
      else valeurs["formateur_domaines"] = propres;
    }
  }

  if ("formateur_tarif_journalier" in brut) {
    const t = brut["formateur_tarif_journalier"];
    if (t === null) valeurs["formateur_tarif_journalier"] = null;
    else if (typeof t !== "number" || !Number.isInteger(t) || t < 0 || t > 10_000_000)
      champs["formateur_tarif_journalier"] =
        "Tarif invalide (montant en centimes, entier positif).";
    else valeurs["formateur_tarif_journalier"] = t;
  }

  return Object.keys(champs).length > 0
    ? { ok: false, champs }
    : { ok: true, valeurs: valeurs as Partial<ProfilFormateur> };
}

/** Après validation, l'identité ne se modifie plus que par l'organisme (elle figure sur les contrats signés). */
export const CHAMPS_FIGES_APRES_VALIDATION = ["formateur_prenom", "formateur_nom"] as const;

export const MESSAGE_IDENTITE_FIGEE =
  "Après validation, votre nom et votre prénom ne se modifient que par l'organisme de formation.";
export const MESSAGE_PROFIL_EN_ETUDE =
  "Votre candidature est en cours d'étude : attendez la décision pour modifier votre profil.";
export const MESSAGE_PIECES_EN_ETUDE =
  "Votre candidature est en cours d'étude : attendez la décision pour ajouter des pièces.";
