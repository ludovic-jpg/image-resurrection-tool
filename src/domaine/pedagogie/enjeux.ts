/**
 * Dossier d'enjeux d'une formation (version 7, 23/09/2026) : ce que l'IA a appris du sujet par recherche web, enregistré
 * sur la formation et réutilisé par tous les générateurs (parcours, tests, supports). Module pur : type, validation
 * stricte de la proposition de l'IA, et mise en forme pour les consignes suivantes.
 */
export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreurs: string[] };

export interface DossierEnjeux {
  /** Ce qu'il faut savoir du sujet, en quelques lignes, pour concevoir la formation. */
  resume: string;
  /** Pourquoi cette formation compte, pour l'entreprise et pour le stagiaire. */
  enjeux: string[];
  /** Cadre : réglementation, normes, référentiels, obligations applicables en France. */
  cadre: string[];
  /** Notions, méthodes et outils à maîtriser en priorité. */
  notions_cles: string[];
  /** Erreurs et idées reçues fréquentes chez les apprenants. */
  erreurs_frequentes: string[];
  /** Tendances et bonnes pratiques à jour. */
  pratiques_actuelles: string[];
  /** Public visé et prérequis, formulés pour la convention de formation. */
  public_vise: string;
  prerequis: string;
  glossaire: Array<{ terme: string; definition: string }>;
  sources: Array<{ titre: string; url: string }>;
}

const texte = (x: unknown): x is string => typeof x === "string";
const listeTexte = (x: unknown, max: number): string[] =>
  Array.isArray(x)
    ? x
        .filter(texte)
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

export function validerEnjeux(
  brut: unknown,
  sourcesConnues: Array<{ titre: string; url: string }> = [],
): Resultat<DossierEnjeux> {
  if (typeof brut !== "object" || brut === null)
    return { ok: false, erreurs: ["La réponse de l'IA n'est pas un objet."] };
  const o = brut as Record<string, unknown>;
  const sources = new Map<string, string>();
  for (const src of [...(Array.isArray(o.sources) ? o.sources : []), ...sourcesConnues]) {
    const x = (src ?? {}) as Record<string, unknown>;
    if (texte(x.url) && /^https?:\/\//.test(x.url.trim()) && !sources.has(x.url.trim()))
      sources.set(
        x.url.trim(),
        texte(x.titre) && x.titre.trim() ? x.titre.trim().slice(0, 200) : x.url.trim(),
      );
  }
  const d: DossierEnjeux = {
    resume: texte(o.resume) ? o.resume.trim().slice(0, 4000) : "",
    enjeux: listeTexte(o.enjeux, 10),
    cadre: listeTexte(o.cadre, 12),
    notions_cles: listeTexte(o.notions_cles, 20),
    erreurs_frequentes: listeTexte(o.erreurs_frequentes, 12),
    pratiques_actuelles: listeTexte(o.pratiques_actuelles, 12),
    public_vise: texte(o.public_vise) ? o.public_vise.trim().slice(0, 2000) : "",
    prerequis: texte(o.prerequis) ? o.prerequis.trim().slice(0, 2000) : "",
    glossaire: (Array.isArray(o.glossaire) ? o.glossaire : [])
      .map((g) => (g ?? {}) as Record<string, unknown>)
      .filter((g) => texte(g.terme) && texte(g.definition))
      .map((g) => ({
        terme: String(g.terme).trim().slice(0, 100),
        definition: String(g.definition).trim().slice(0, 500),
      }))
      .slice(0, 20),
    sources: [...sources].slice(0, 12).map(([url, titre]) => ({ titre, url })),
  };
  const erreurs: string[] = [];
  if (d.resume.length < 40) erreurs.push("Le résumé des enjeux est vide ou trop court.");
  if (d.enjeux.length < 2) erreurs.push("Au moins deux enjeux sont attendus.");
  if (d.notions_cles.length < 3) erreurs.push("Au moins trois notions clés sont attendues.");
  return erreurs.length > 0 ? { ok: false, erreurs } : { ok: true, valeur: d };
}

/** Le dossier d'enjeux, résumé pour être injecté dans les consignes suivantes. */
export function decrireEnjeux(e: DossierEnjeux | null | undefined): string {
  if (!e) return "";
  const bloc = (titre: string, l: string[]) =>
    l.length ? `${titre} :\n${l.map((x) => `- ${x}`).join("\n")}` : "";
  return [
    "DOSSIER D'ENJEUX (issu d'une recherche documentaire sur ce sujet — appuie-toi dessus, ne le recopie pas) :",
    e.resume ? `Résumé : ${e.resume}` : "",
    bloc("Enjeux", e.enjeux),
    bloc("Cadre réglementaire et normatif", e.cadre),
    bloc("Notions clés", e.notions_cles),
    bloc("Erreurs fréquentes", e.erreurs_frequentes),
    bloc("Pratiques actuelles", e.pratiques_actuelles),
    e.glossaire.length
      ? `Glossaire : ${e.glossaire.map((g) => `${g.terme} = ${g.definition}`).join(" ; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
