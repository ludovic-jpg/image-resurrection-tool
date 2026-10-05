/**
 * Lot 2 — outils communs aux gestionnaires de lecture et de saisie simple (Client + RLS, RPC SQL).
 *
 * Principe : la RLS cloisonne. Ces aides ne filtrent jamais « à la main » à la place des politiques ; elles
 * reconstruisent l'acteur (RPC `s4m_moi`, jamais le corps de la requête), refusent le mauvais RÔLE (403, comme le
 * service Node), et traduisent « aucune ligne » en 404 « introuvable » : un objet cloisonné ne révèle pas qu'il existe.
 */
import { ZodError, type ZodObject, type ZodRawShape, type z } from "zod";
import type { Moi } from "../api";
import { erreurInconnue } from "../aiguilleur";
import { bd } from "../bd";
import { ErreurApi } from "../erreur";

export type Acteur = NonNullable<Moi["acteur"]>;
type Role = Acteur["role"];

export const interdit = (message = "Cette action ne vous est pas permise.") =>
  new ErreurApi(message, 403, "interdit", null);
export const introuvable = (quoi = "Élément") =>
  new ErreurApi(`${quoi} introuvable.`, 404, "introuvable", null);
export const invalide = (message: string, details: ErreurApi["details"] = null) =>
  new ErreurApi(message, 400, "invalide", details);

/** L'acteur connecté, tel que le calcule `s4m_moi()` côté base. */
export async function acteurCourant(): Promise<Acteur> {
  const { data, error } = await bd.rpc("s4m_moi");
  if (error) throw erreurInconnue(error);
  const acteur = (data as Moi | null)?.acteur;
  if (!acteur)
    throw new ErreurApi("Votre session a expiré. Reconnectez-vous.", 401, "non_connecte", null);
  return acteur;
}

export function exigerRole(acteur: Acteur, ...roles: Role[]): void {
  if (!roles.includes(acteur.role)) throw interdit();
}

/** Un formateur dont la candidature n'est pas validée n'accède qu'à sa candidature. Renvoie son identifiant. */
export function exigerFormateurValide(acteur: Acteur): string {
  if (acteur.role !== "formateur" || !acteur.formateur_id) throw interdit();
  if (!acteur.formateur_valide)
    throw interdit(
      "Votre candidature doit être validée par l'organisme avant d'accéder à cet espace.",
    );
  return acteur.formateur_id;
}

/** Résultat d'une requête supabase-js : les données, ou l'erreur traduite pour les écrans. */
export function lire<T>(r: { data: T | null; error: unknown }): T | null {
  if (r.error) throw erreurInconnue(r.error);
  return r.data;
}

/** Comme `lire`, mais « aucune ligne » (RLS comprise) devient 404 « <quoi> introuvable ». */
export function exiger<T>(r: { data: T | null; error: unknown }, quoi: string): T {
  const data = lire(r);
  if (data === null || data === undefined) throw introuvable(quoi);
  return data;
}

/** Erreur d'une RPC : les `raise exception '… introuvable.'` de la base deviennent des 404 propres. */
export function erreurRpc(error: unknown): ErreurApi {
  const message = (error as { message?: string } | null)?.message ?? "";
  if (/introuvable/i.test(message)) return new ErreurApi(message, 404, "introuvable", null);
  return erreurInconnue(error);
}

/** Erreur de Storage : un objet absent ou refusé est « introuvable » ; le reste suit `erreurInconnue`. */
export function erreurStockage(error: unknown): ErreurApi {
  const e = error as { message?: string; statusCode?: string | number; status?: number } | null;
  const statut = Number(e?.statusCode ?? e?.status ?? 0);
  if (statut === 404 || statut === 403 || /not found|introuvable/i.test(e?.message ?? ""))
    return introuvable("Fichier");
  return erreurInconnue(error);
}

/** Corps de requête JSON : un objet, sinon 400 (comme `corps()` du serveur Node). */
export function corpsObjet(corps: unknown): Record<string, unknown> {
  if (typeof corps !== "object" || corps === null || corps instanceof FormData)
    throw invalide("Corps de requête illisible.");
  return corps as Record<string, unknown>;
}

/** Traduit une `ZodError` dans le format d'erreur que les écrans lisent (`details.champs`). */
export function erreurValidation(erreur: ZodError): ErreurApi {
  const champs = Object.fromEntries(erreur.issues.map((i) => [i.path.join(".") || "_", i.message]));
  return invalide(Object.values(champs)[0] ?? "Données invalides.", { champs });
}

/** Exécute une validation Zod ; toute `ZodError` devient une erreur 400 lisible. */
export function valider<T>(operation: () => T): T {
  try {
    return operation();
  } catch (e) {
    if (e instanceof ZodError) throw erreurValidation(e);
    throw e;
  }
}

/** Validation d'une modification partielle : seules les clés réellement présentes dans les données sont gardées. */
export function validerPartiel<T extends ZodRawShape>(
  schema: ZodObject<T>,
  donnees: unknown,
): Partial<z.infer<ZodObject<T>>> {
  if (typeof donnees !== "object" || donnees === null) throw invalide("Données illisibles.");
  const valeurs = valider(() => schema.partial().parse(donnees)) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(valeurs).filter(([cle]) => cle in donnees)) as Partial<
    z.infer<ZodObject<T>>
  >;
}

export const maintenant = () => new Date().toISOString();
