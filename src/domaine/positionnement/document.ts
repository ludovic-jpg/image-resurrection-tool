/**
 * Document archivé d'un positionnement signé : HTML autonome (référence scellée, `@page` A4 prêt à imprimer).
 * Règle PURE : aucune lecture de fichier, aucun gabarit externe — rien à embarquer au build pour Cloudflare Workers.
 * Toute donnée saisie est échappée ; le tracé de signature est une image `data:image/png` déjà validée par
 * `validerDemandeSignature`.
 */
import type { FormulaireDef } from "../formulaires/definitions";
import type { Questionnaire } from "../formulaires/qcm";
import { echapperHtml as e } from "../gabarits/moteur";
import { horodatageLisible } from "../signature/preuve";

export interface DonneesDocument {
  of_nom: string;
  couleur: string;
  formation: string;
  apprenant: string;
  email: string;
  entreprise: string;
  def: FormulaireDef;
  recueil: Record<string, string>;
  questionnaire: Questionnaire | null;
  reponses: Array<number | null>;
  score: number | null;
  /** AAAA-MM-JJ */
  date: string;
  lieu: string;
  /** Horodatage ISO 8601 posé par le serveur. */
  signe_le: string;
  trace_png: string;
  empreinte: string;
  reference: string;
}

export function documentPositionnement(o: DonneesDocument): string {
  const couleur = /^#[0-9a-f]{6}$/i.test(o.couleur) ? o.couleur : "#1d6a45";
  const dateFr = (iso: string) => iso.split("-").reverse().join("/");
  const recueil = o.def.champs
    .map(
      (c, i) =>
        `<tr><th>${i + 1}. ${e(c.libelle)}</th><td>${e(o.recueil[c.id] ?? "—").replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("");
  const test = o.questionnaire
    ? o.questionnaire.questions
        .map(
          (q, i) =>
            `<tr><th>${i + 1}. ${e(q.enonce)}</th><td>${e(q.propositions[o.reponses[i] ?? -1] ?? "—")}</td></tr>`,
        )
        .join("")
    : "";
  const horodatage = horodatageLisible(o.signe_le);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Positionnement — ${e(o.apprenant)}</title><style>
@page{size:A4;margin:16mm 15mm}body{font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#1f2a24;margin:0}
.of{font-weight:700;color:${couleur};letter-spacing:.02em}h1{font-size:18pt;margin:6pt 0 2pt}h2{font-size:12.5pt;margin:16pt 0 6pt;padding-bottom:3pt;border-bottom:1.5pt solid ${couleur}}
table{border-collapse:collapse;width:100%}td,th{border:.6pt solid #c9cfc9;padding:5pt 7pt;vertical-align:top;text-align:left}th{background:#f4f6f3;width:48%;font-weight:600}
.score{font-size:12pt;font-weight:700;color:${couleur}}.sig img{max-height:70pt}.pied{margin-top:16pt;font-size:8pt;color:#5b6472}
</style></head><body>
<div class="of">${e(o.of_nom)}</div><h1>Positionnement avant formation</h1><p>${e(o.formation)}</p>
<table><tr><th>Apprenant</th><td>${e(o.apprenant)}</td></tr><tr><th>Adresse e-mail</th><td>${e(o.email)}</td></tr>${o.entreprise ? `<tr><th>Entreprise</th><td>${e(o.entreprise)}</td></tr>` : ""}<tr><th>Date du positionnement</th><td>${e(dateFr(o.date))}</td></tr></table>
<h2>A. Recueil des besoins</h2><table>${recueil}</table>
${o.questionnaire ? `<h2>B. Test de positionnement — ${e(o.questionnaire.titre)}</h2><table>${test}</table><p class="score">Score de positionnement : ${o.score ?? "—"} / 100</p>` : ""}
<h2>Signature</h2><table><tr><th>Signé électroniquement par ${e(o.apprenant)}<br>à ${e(o.lieu)}, le ${e(horodatage)}</th><td class="sig"><img src="${e(o.trace_png)}" alt="Signature"></td></tr></table>
<p class="pied">Référence ${e(o.reference)} · Empreinte SHA-256 des réponses : ${e(o.empreinte)}. Signature électronique simple (tracé, horodatage serveur, empreinte). Indicateur Qualiopi n° 8 (positionnement à l'entrée) et n° 4 (analyse du besoin).</p>
</body></html>`;
}
