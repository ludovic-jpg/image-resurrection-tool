/**
 * Outils communs de l'espace pédagogique côté serveur : formation du formateur (cloisonnée), modules, lecture d'un
 * corps de requête. Aucun appel à l'IA ici : ce fichier est partagé par la production de supports et par l'assistant.
 */
import { z } from "zod";
import type { ModuleParcours } from "@/domaine/pedagogie/parcours";
import type { ActeurFormateurValide } from "./acteur.server";
import type { BdService } from "./bd.server";
import { introuvable, invalide, leverSiErreurBd } from "./erreurs.server";

/** Ce que l'espace pédagogique lit de la formation. */
export interface FormationIa {
  id: string;
  of_id: string;
  formateur_id: string;
  formation_titre: string;
  formation_objectifs: string;
  formation_niveau: string;
  formation_prerequis: string;
  formation_modalite: string;
  formation_duree_heures_total: number | null;
  formation_modules: unknown;
  public_vise: string;
  programme: string;
  dossier_enjeux: unknown;
}

/** Erreur de validation d'un corps de requête → `invalide` avec le message du premier champ fautif. */
export function lireCorps<S extends z.ZodType>(schema: S, donnees: unknown): z.infer<S> {
  const r = schema.safeParse(donnees ?? {});
  if (r.success) return r.data;
  const champs: Record<string, string> = {};
  for (const i of r.error.issues) champs[i.path.join(".") || "_"] ??= i.message;
  throw invalide(r.error.issues[0]?.message ?? "Données invalides.", { champs });
}

// ——— Lecture de la formation : toujours cloisonnée au formateur propriétaire ———

/** La formation DU formateur, dans SON organisme ; sinon « introuvable » (jamais « interdit »). */
export async function lireFormation(
  bd: BdService,
  acteur: ActeurFormateurValide,
  id: string,
): Promise<FormationIa> {
  const { data, error } = await bd
    .from("formation")
    .select("*")
    .eq("id", id)
    .eq("of_id", acteur.of_id)
    .eq("formateur_id", acteur.formateur_id)
    .maybeSingle();
  leverSiErreurBd(error, "lecture de la formation");
  if (!data) throw introuvable("Formation");
  return data as FormationIa;
}

/** Modules d'une formation ; à défaut (ancienne formation), un module unique construit sur ses objectifs. */
export function modulesDe(f: FormationIa): ModuleParcours[] {
  const modules = (f.formation_modules ?? []) as ModuleParcours[];
  if (modules.length > 0) return modules;
  const objectifs = (f.formation_objectifs ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const contenus = (f.programme ?? "")
    .split("\n")
    .map((x) => x.replace(/^[-•\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 10);
  return [
    {
      titre: f.formation_titre,
      duree_heures: f.formation_duree_heures_total ?? 7,
      objectifs: objectifs.length
        ? objectifs
        : [`Maîtriser les fondamentaux de « ${f.formation_titre} »`],
      contenus: contenus.length ? contenus : [f.formation_titre],
      methodes: "",
      mise_en_pratique: "",
      evaluation: "",
    },
  ];
}
