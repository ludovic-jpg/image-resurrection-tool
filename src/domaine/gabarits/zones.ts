/**
 * Fabrique du HTML des zones `<!-- zone:… -->` : réponses de formulaire, QCM, grilles de notes.
 * Tout texte d'origine utilisateur est échappé ICI ; le moteur insère ensuite ces zones telles quelles.
 */
import {
  NOTE_MAX,
  NOTE_MIN,
  type FormulaireDef,
  type Reponses,
  moyenneNotes,
} from "../formulaires/definitions";
import { corriger, type Questionnaire } from "../formulaires/qcm";
import { formaterNombre } from "../dossier/formats";
import { echapperHtml as e } from "./moteur";

/** Réponses d'un formulaire à questions ouvertes ou à choix (recueil des besoins). */
export function zoneReponses(def: FormulaireDef, reponses: Reponses | null | undefined): string {
  return def.champs
    .filter((c) => c.type !== "note")
    .map((c) => {
      const valeur = (reponses?.[c.id] ?? "").trim();
      const contenu = valeur === "" ? "&nbsp;" : e(valeur).replace(/\r?\n/g, "<br>");
      return `<h3>${e(c.libelle)}</h3><div class="reponse">${contenu}</div>`;
    })
    .join("\n");
}

/** Grille de notes (satisfaction à chaud / à froid), avec moyenne et commentaires. */
export function zoneGrilleNotes(def: FormulaireDef, reponses: Reponses | null | undefined): string {
  const echelle = Array.from({ length: NOTE_MAX - NOTE_MIN + 1 }, (_, i) => NOTE_MIN + i);
  const lignes = def.champs
    .filter((c) => c.type === "note")
    .map((c) => {
      const note = Number(reponses?.[c.id]);
      const cases = echelle
        .map((n) => `<td class="num">${n === note ? `<span class="v">●</span>` : "○"}</td>`)
        .join("");
      return `<tr><td>${e(c.libelle)}</td>${cases}</tr>`;
    })
    .join("");
  const moyenne = reponses ? moyenneNotes(def, reponses) : null;
  const libres = def.champs
    .filter((c) => c.type !== "note")
    .map(
      (c) =>
        `<h3>${e(c.libelle)}</h3><div class="reponse">${e((reponses?.[c.id] ?? "").trim()).replace(/\r?\n/g, "<br>") || "&nbsp;"}</div>`,
    )
    .join("");
  return (
    `<table><thead><tr><th>Critère</th>${echelle.map((n) => `<th class="num" style="width:11mm">${n}</th>`).join("")}</tr></thead><tbody>${lignes}</tbody></table>` +
    (moyenne === null
      ? ""
      : `<div class="encadre">Note moyenne : <span class="v">${formaterNombre(moyenne)} / ${NOTE_MAX}</span></div>`) +
    libres
  );
}

/** Questionnaire à choix multiples. Avec `reponses`, la copie de l'apprenant est reportée et corrigée. */
export function zoneQcm(
  q: Questionnaire | null | undefined,
  reponses?: ReadonlyArray<number | null> | null,
): string {
  if (!q) return `<p class="mention">Aucun questionnaire n'est rattaché à ce dossier.</p>`;
  const correction = reponses ? corriger(q, reponses) : null;
  const items = q.questions
    .map((question, i) => {
      const propositions = question.propositions
        .map((p, j) => {
          const choisie = reponses?.[i] === j;
          const juste = correction !== null && j === question.bonne_reponse;
          return `<li><span class="coche${choisie ? " choisie" : ""}"></span>${e(p)}${juste ? ` <span class="mention">— bonne réponse</span>` : ""}</li>`;
        })
        .join("");
      return `<li><div class="enonce">${e(question.enonce)}</div><ul class="propositions">${propositions}</ul></li>`;
    })
    .join("");
  const bilan = correction
    ? `<div class="encadre">Résultat : <span class="v">${correction.bonnes} bonne(s) réponse(s) sur ${correction.total} — ${correction.score} / 100</span></div>`
    : "";
  return `<div class="qcm"><h2>${e(q.titre)}</h2><ol>${items}</ol></div>${bilan}`;
}

/** Synthèse du positionnement pour le pré-dossier : le résultat, sans le détail des questions. */
export function zoneSynthesePositionnement(
  q: Questionnaire | null | undefined,
  reponses?: ReadonlyArray<number | null> | null,
): string {
  if (!q || !reponses) return `<p class="mention">Test de positionnement non encore renseigné.</p>`;
  const c = corriger(q, reponses);
  return `<div class="fiche"><div>Questionnaire</div><div>${e(q.titre)}</div><div>Résultat</div><div class="v">${c.bonnes} bonne(s) réponse(s) sur ${c.total} — ${c.score} / 100</div></div>`;
}
