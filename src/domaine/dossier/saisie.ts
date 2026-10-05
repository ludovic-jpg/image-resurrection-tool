/**
 * Validation des saisies de dossier — version pure des schémas `SchemaCreationDossier`, `SchemaDossier` et
 * `SchemaSeances` de l'ancien `src/serveur/services/dossiers.ts` (mêmes champs, mêmes bornes, mêmes messages).
 * Le serveur la rejoue avant d'écrire ; le client l'applique avant d'appeler la base.
 */
import type { Modalite, ModeFinancement } from "./agregat";

export type ResultatValidation<T> =
  { ok: true; valeurs: T } | { ok: false; message: string; champs: Record<string, string> };

const MODALITES: readonly string[] = ["presentiel", "distanciel", "mixte"];
const FINANCEMENTS: readonly string[] = ["opco", "faf", "entreprise", "fonds_propres"];
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

const echec = (
  champs: Record<string, string>,
): { ok: false; message: string; champs: typeof champs } => ({
  ok: false,
  message: Object.values(champs)[0] ?? "Données invalides.",
  champs,
});

// ——— Création (F-DOS-02) ———

export interface CreationDossier {
  stagiaire_ids: string[];
  entreprise_id: string;
  formation_id: string;
  formation_modalite: Modalite;
  mode_financement: ModeFinancement;
}

export function validerCreationDossier(brut: unknown): ResultatValidation<CreationDossier> {
  const o = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  const champs: Record<string, string> = {};
  const ids = Array.isArray(o["stagiaire_ids"]) ? o["stagiaire_ids"] : null;
  if (!ids || ids.length < 1 || !ids.every((x) => typeof x === "string"))
    champs["stagiaire_ids"] = "Sélectionnez au moins un apprenant.";
  else if (ids.length > 8) champs["stagiaire_ids"] = "Un dossier compte 8 apprenants au plus.";
  else if (new Set(ids).size !== ids.length)
    champs["stagiaire_ids"] = "Un apprenant est sélectionné deux fois.";
  const entreprise = typeof o["entreprise_id"] === "string" ? o["entreprise_id"] : "";
  if (!entreprise) champs["entreprise_id"] = "Sélectionnez l'entreprise.";
  const formation = typeof o["formation_id"] === "string" ? o["formation_id"] : "";
  if (!formation) champs["formation_id"] = "Sélectionnez la formation.";
  if (!MODALITES.includes(String(o["formation_modalite"])))
    champs["formation_modalite"] = "Choisissez la modalité de la formation.";
  if (!FINANCEMENTS.includes(String(o["mode_financement"])))
    champs["mode_financement"] = "Choisissez le mode de financement.";
  if (Object.keys(champs).length > 0) return echec(champs);
  return {
    ok: true,
    valeurs: {
      stagiaire_ids: ids as string[],
      entreprise_id: entreprise,
      formation_id: formation,
      formation_modalite: o["formation_modalite"] as Modalite,
      mode_financement: o["mode_financement"] as ModeFinancement,
    },
  };
}

/** Un dossier compte de 1 à 8 apprenants distincts (route « stagiaires »). */
export function validerListeStagiaires(brut: unknown): ResultatValidation<string[]> {
  const ids = Array.isArray(brut) ? brut.map(String) : [];
  if (ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length)
    return echec({ stagiaire_ids: "Un dossier compte de 1 à 8 apprenants distincts." });
  return { ok: true, valeurs: ids };
}

// ——— Modification (PATCH) ———

type Regle = (v: unknown) => { ok: true; valeur: unknown } | { ok: false; message: string };
const ok = (valeur: unknown) => ({ ok: true as const, valeur });

const texte =
  (max: number): Regle =>
  (v) => {
    if (typeof v !== "string") return { ok: false, message: "Texte attendu." };
    const t = v.trim();
    return t.length > max ? { ok: false, message: `${max} caractères au plus.` } : ok(t);
  };
const dateIso: Regle = (v) =>
  v === "" || (typeof v === "string" && RE_DATE.test(v))
    ? ok(v)
    : { ok: false, message: "Date attendue au format AAAA-MM-JJ" };
const nombre =
  (max: number, entier: boolean): Regle =>
  (v) => {
    if (v === null) return ok(null);
    if (typeof v !== "number" || !Number.isFinite(v))
      return { ok: false, message: "Nombre attendu." };
    if (entier && !Number.isInteger(v)) return { ok: false, message: "Nombre entier attendu." };
    if (v < 0 || v > max) return { ok: false, message: `Valeur comprise entre 0 et ${max}.` };
    return ok(v);
  };
const choix =
  (valeurs: readonly string[]): Regle =>
  (v) =>
    typeof v === "string" && valeurs.includes(v)
      ? ok(v)
      : { ok: false, message: "Valeur inconnue." };
const lienVisio: Regle = (v) => {
  if (v === "") return ok("");
  if (typeof v !== "string") return { ok: false, message: "Lien de connexion invalide." };
  const t = v.trim();
  try {
    const u = new URL(t);
    if (!/^https?:$/.test(u.protocol) || t.length > 500) throw new Error("lien");
  } catch {
    return { ok: false, message: "Lien de connexion invalide." };
  }
  return ok(t);
};

/** Champs d'un dossier modifiables par saisie (jamais le sous-statut, la référence, le formateur ni l'organisme). */
const CHAMPS_MODIFIABLES: Record<string, Regle> = {
  formation_titre: texte(200),
  formation_objectifs: texte(4000),
  formation_objectifs_atteints: texte(4000),
  formation_niveau: texte(100),
  formation_prerequis: texte(2000),
  formation_public_vise: texte(2000),
  formation_programme: texte(20000),
  formation_duree_heures_total: nombre(2000, false),
  formation_duree_jours: nombre(2000, false),
  formation_duree_heures_presentiel: nombre(2000, false),
  formation_duree_heures_distanciel: nombre(2000, false),
  formation_modalite: choix(MODALITES),
  formation_lieu_nom: texte(200),
  formation_lieu_adresse: texte(400),
  formation_lieu_siret: texte(20),
  formation_lien_visio: lienVisio,
  formation_date_debut: dateIso,
  formation_date_fin: dateIso,
  formation_opco: texte(200),
  formation_prix_unitaire_ht: nombre(100_000_000, true),
  formation_prix_presentiel_ht: nombre(100_000_000, true),
  signature_lieu: texte(120),
  mode_financement: choix(FINANCEMENTS),
};

export const CHAMPS_DOSSIER_MODIFIABLES = Object.keys(CHAMPS_MODIFIABLES);

/** Ne garde que les champs modifiables présents dans `brut` (les autres sont ignorés, comme le faisait Zod). */
export function validerSaisieDossier(
  brut: unknown,
): ResultatValidation<Record<string, string | number | null>> {
  const o = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  const valeurs: Record<string, string | number | null> = {};
  const champs: Record<string, string> = {};
  for (const [cle, regle] of Object.entries(CHAMPS_MODIFIABLES)) {
    if (!(cle in o) || o[cle] === undefined) continue;
    const r = regle(o[cle]);
    if (r.ok) valeurs[cle] = r.valeur as string | number | null;
    else champs[cle] = r.message;
  }
  return Object.keys(champs).length > 0 ? echec(champs) : { ok: true, valeurs };
}

// ——— Planning ———

export interface SeanceSaisie {
  date: string;
  heure_debut: string;
  heure_fin: string;
}

export function validerSeances(brut: unknown): ResultatValidation<SeanceSaisie[]> {
  if (!Array.isArray(brut)) return echec({ seances: "Planning invalide." });
  if (brut.length > 20) return echec({ seances: "Un planning compte 20 séances au plus." });
  const sortie: SeanceSaisie[] = [];
  for (const [i, s] of brut.entries()) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const cle = `seances.${i}`;
    if (typeof o["date"] !== "string" || !RE_DATE.test(o["date"]))
      return echec({ [cle]: "Date attendue au format AAAA-MM-JJ" });
    if (typeof o["heure_debut"] !== "string" || !RE_HEURE.test(o["heure_debut"]))
      return echec({ [cle]: "Heure attendue au format HH:MM" });
    if (typeof o["heure_fin"] !== "string" || !RE_HEURE.test(o["heure_fin"]))
      return echec({ [cle]: "Heure attendue au format HH:MM" });
    if (o["heure_fin"] <= o["heure_debut"])
      return echec({ [cle]: "L'heure de fin doit suivre l'heure de début." });
    sortie.push({ date: o["date"], heure_debut: o["heure_debut"], heure_fin: o["heure_fin"] });
  }
  return { ok: true, valeurs: sortie };
}
