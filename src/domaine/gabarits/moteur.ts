/**
 * Moteur de gabarits — décision D1 : fonctions pures, aucun accès disque, aucun navigateur.
 *
 * Repris de la base B (`render.ts`) : le principe `{{variable}}` échappé et la détection des balises
 * restantes. Abandonné : le script de « nettoyage » injecté dans le HTML, qui supprimait les lignes
 * vides côté navigateur — fragile, et inopérant sans navigateur. Les groupes répétables sont
 * désormais développés ici, de façon déterministe.
 *
 * Syntaxe d'un gabarit (tout le reste est du HTML ordinaire) :
 *
 *   {{formation_titre}}                      valeur échappée ; sauts de ligne rendus en <br>
 *   <!-- repeter:stagiaire --> … <!-- /repeter:stagiaire -->
 *                                            bloc répété une fois par stagiaire ; à l'intérieur,
 *                                            `{{stagiaire_N_nom}}` et `{{rang_stagiaire}}`
 *   <!-- repeter:session --> … <!-- /repeter:session -->      idem pour les séances (imbricable)
 *   <!-- si:formation_lien_visio --> … <!-- /si:formation_lien_visio -->
 *                                            bloc conservé seulement si la variable est renseignée
 *   <!-- sauf:formation_lien_visio --> … <!-- /sauf:formation_lien_visio -->   l'inverse
 *   <!-- inclure:styles -->                  insertion d'un fragment partagé (feuille de style…)
 *   <!-- zone:signature_apprenant -->        insertion de HTML produit par l'application
 *                                            (bloc de signature, case d'émargement)
 */
import { RANG_MAX, estVariableConnue, type GroupeRepetable } from "../referentiel/variables";

export type Variables = Record<string, string | undefined>;
export type Rangs = Partial<Record<GroupeRepetable, number>>;
export type Zone = (rangs: Rangs) => string;

export interface ContexteRendu {
  variables: Variables;
  /** Fragments insérés par `<!-- inclure:nom -->`. */
  inclusions?: Record<string, string>;
  /** HTML de confiance inséré par `<!-- zone:nom -->`. Zone absente = rien. */
  zones?: Record<string, Zone>;
  /** Texte rendu à la place d'une valeur manquante. */
  vide?: string;
}

export interface ResultatRendu {
  html: string;
  /** Variables utilisées par le gabarit mais sans valeur — le document est incomplet. */
  manquantes: string[];
}

const GROUPES: readonly GroupeRepetable[] = ["stagiaire", "session"];
const VARIABLES_TECHNIQUES = new Set(["rang_stagiaire", "rang_session"]);
const RE_BALISE = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function echapperHtml(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nombre d'éléments d'un groupe : plus haut rang dont au moins une variable est renseignée. */
export function compterRangs(variables: Variables, groupe: GroupeRepetable): number {
  let max = 0;
  const re = new RegExp(`^${groupe}_(\\d+)_`);
  for (const [nom, valeur] of Object.entries(variables)) {
    const m = re.exec(nom);
    if (m && valeur !== undefined && valeur.trim() !== "") max = Math.max(max, Number(m[1]));
  }
  return Math.min(max, RANG_MAX[groupe]);
}

function reBloc(type: string, nom: string): RegExp {
  // Le nom est répété dans la balise fermante : l'imbrication est donc sans ambiguïté.
  return new RegExp(`<!--\\s*${type}:${nom}\\s*-->([\\s\\S]*?)<!--\\s*/${type}:${nom}\\s*-->`, "g");
}

function developperRepetitions(html: string, variables: Variables): string {
  let sortie = html;
  for (const groupe of GROUPES) {
    sortie = sortie.replace(reBloc("repeter", groupe), (_tout, corps: string) => {
      const n = compterRangs(variables, groupe);
      let blocs = "";
      for (let rang = 1; rang <= n; rang++) {
        const instance = corps
          .replaceAll(`${groupe}_N_`, `${groupe}_${rang}_`)
          .replaceAll(`{{rang_${groupe}}}`, String(rang))
          // Les zones héritent du rang courant : <!-- zone:x --> devient <!-- zone:x@stagiaire=3 -->
          .replace(
            /<!--\s*zone:([a-z0-9_]+)((?:@[a-z]+=\d+)*)\s*-->/g,
            `<!-- zone:$1$2@${groupe}=${rang} -->`,
          );
        blocs += instance;
      }
      return blocs;
    });
  }
  return sortie;
}

function appliquerConditions(html: string, variables: Variables): string {
  let sortie = html;
  let precedent: string;
  // Boucle jusqu'à stabilité : autorise des conditions imbriquées.
  do {
    precedent = sortie;
    sortie = sortie.replace(
      /<!--\s*(si|sauf):([a-z0-9_]+)\s*-->([\s\S]*?)<!--\s*\/\1:\2\s*-->/g,
      (_tout, type: string, nom: string, corps: string) => {
        const renseignee = (variables[nom] ?? "").trim() !== "";
        return (type === "si") === renseignee ? corps : "";
      },
    );
  } while (sortie !== precedent);
  return sortie;
}

/** Rend un gabarit. Ne lève jamais : les manques sont rapportés, à l'appelant de décider. */
export function rendreGabarit(gabarit: string, contexte: ContexteRendu): ResultatRendu {
  const { variables, inclusions = {}, zones = {}, vide = "—" } = contexte;
  const manquantes = new Set<string>();

  let html = gabarit.replace(
    /<!--\s*inclure:([a-z0-9_]+)\s*-->/g,
    (_t, nom: string) => inclusions[nom] ?? "",
  );
  html = developperRepetitions(html, variables);
  html = appliquerConditions(html, variables);

  html = html.replace(
    /<!--\s*zone:([a-z0-9_]+)((?:@[a-z]+=\d+)*)\s*-->/g,
    (_t, nom: string, suffixe: string) => {
      const rangs: Rangs = {};
      for (const m of suffixe.matchAll(/@([a-z]+)=(\d+)/g)) rangs[m[1] as GroupeRepetable] = Number(m[2]);
      return zones[nom]?.(rangs) ?? "";
    },
  );

  html = html.replace(RE_BALISE, (_t, brut: string) => {
    const nom = brut.trim();
    const valeur = variables[nom];
    if (valeur === undefined || valeur.trim() === "") {
      manquantes.add(nom);
      return echapperHtml(vide);
    }
    return echapperHtml(valeur).replace(/\r?\n/g, "<br>");
  });

  return { html, manquantes: [...manquantes].sort() };
}

/** Balises `{{…}}` encore présentes après rendu — doit toujours être vide. */
export function balisesRestantes(html: string): string[] {
  return html.match(/\{\{[^{}]*\}\}/g) ?? [];
}

export interface AnalyseGabarit {
  /** Variables utilisées, telles qu'écrites (`stagiaire_N_nom`, `stagiaire_1_nom`, …). */
  variables: string[];
  /** Défauts bloquants : un gabarit qui en a n'est pas livrable. */
  defauts: string[];
}

/**
 * Contrôle statique d'un gabarit — c'est le « contrôle final » de la skill conventions-s4m, automatisé :
 * aucune syntaxe `[CROCHETS]`, aucun nom hors dictionnaire, aucun bloc mal fermé, aucun résidu de code.
 */
export function analyserGabarit(gabarit: string): AnalyseGabarit {
  const defauts: string[] = [];
  const variables = new Set<string>();

  // Expression volontairement plus large que celle du rendu : elle doit VOIR les balises malformées.
  for (const m of gabarit.matchAll(/\{\{([^}]*)\}\}/g)) {
    const nom = m[1]!.trim();
    if (VARIABLES_TECHNIQUES.has(nom)) continue;
    variables.add(nom);
    if (nom === "" || /[${}.]/.test(nom)) defauts.push(`résidu de code dans une balise : ${m[0]}`);
    else if (m[1] !== nom) defauts.push(`espace parasite dans la balise : ${m[0]}`);
    else if (!estVariableConnue(nom)) defauts.push(`variable hors dictionnaire : ${nom}`);
  }

  for (const m of gabarit.matchAll(/<!--\s*(si|sauf):([a-z0-9_]+)\s*-->/g)) {
    if (!estVariableConnue(m[2]!)) defauts.push(`condition sur une variable hors dictionnaire : ${m[2]}`);
  }

  for (const type of ["repeter", "si", "sauf"]) {
    const ouvertures = [...gabarit.matchAll(new RegExp(`<!--\\s*${type}:([a-z0-9_]+)\\s*-->`, "g"))].map(
      (m) => m[1]!,
    );
    const fermetures = [...gabarit.matchAll(new RegExp(`<!--\\s*/${type}:([a-z0-9_]+)\\s*-->`, "g"))].map(
      (m) => m[1]!,
    );
    if ([...ouvertures].sort().join() !== [...fermetures].sort().join()) {
      defauts.push(
        `blocs « ${type} » mal appariés (${ouvertures.length} ouverture(s), ${fermetures.length} fermeture(s))`,
      );
    }
    if (type === "repeter") {
      for (const nom of ouvertures) {
        if (!GROUPES.includes(nom as GroupeRepetable)) defauts.push(`groupe répétable inconnu : ${nom}`);
      }
    }
  }

  // Une variable en `_N_` n'a de sens que dans le bloc « repeter » de son groupe.
  let horsBlocs = gabarit;
  for (const groupe of GROUPES) horsBlocs = horsBlocs.replace(reBloc("repeter", groupe), "");
  for (const m of horsBlocs.matchAll(RE_BALISE)) {
    if (/^(stagiaire|session)_N_/.test(m[1]!.trim()))
      defauts.push(`variable répétable hors de son bloc « repeter » : ${m[1]!.trim()}`);
  }

  for (const m of gabarit.matchAll(/\[[A-ZÉÈÀ_ ]{3,}\]/g))
    defauts.push(`ancienne syntaxe entre crochets : ${m[0]}`);

  return { variables: [...variables].sort(), defauts };
}
