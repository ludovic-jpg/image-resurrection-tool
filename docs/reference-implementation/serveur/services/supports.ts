/**
 * Production des documents de l'espace pédagogique — « Modification 1 » du 23/09/2026 :
 *  - supports de cours PPTX, un fichier de 20 diapositives par module, à partir d'un PLAN (proposé par l'IA ou par la
 *    trame, puis relu et aménagé par le formateur) ;
 *  - documents imprimables du coffre-fort : programme du parcours, questionnaires (test de positionnement,
 *    évaluation des acquis, recueil), en HTML et en PDF si un Chromium est disponible.
 *
 * Aucun appel à l'IA ici : ce service met en forme ce qu'on lui donne (test de garde `ia-perimetre.test.ts`).
 */
import PptxGenJS from "pptxgenjs";
import { echapperHtml as e } from "@/domaine/gabarits/moteur";
import { FORMULAIRES } from "@/domaine/formulaires/definitions";
import type { Questionnaire } from "@/domaine/formulaires/qcm";
import { heuresTexte, type Diapo, type ModuleParcours } from "@/domaine/pedagogie/parcours";
import { libelleModeFinancement } from "@/domaine/pedagogie/listes";
import type { formation, modeleOutil } from "../bd/schema";

type Formation = typeof formation.$inferSelect;
type Outil = typeof modeleOutil.$inferSelect;

const hex = (c: string, defaut = "1D6A45") => (/^#?[0-9a-f]{6}$/i.test(c) ? c.replace("#", "").toUpperCase() : defaut);

/** Éclaircit une couleur (mélange avec du blanc) pour les fonds doux. */
function doux(c: string, part = 0.88): string {
  const n = parseInt(c, 16);
  const m = (v: number) => Math.round(v + (255 - v) * part).toString(16).padStart(2, "0");
  return `${m((n >> 16) & 255)}${m((n >> 8) & 255)}${m(n & 255)}`.toUpperCase();
}

const ETIQUETTES: Partial<Record<Diapo["type"], { texte: string; couleur?: string }>> = {
  amorce: { texte: "ÉCHANGE" },
  point_etape: { texte: "POINT D'ÉTAPE" },
  pratique: { texte: "MISE EN PRATIQUE" },
  debriefing: { texte: "DÉBRIEFING" },
  vigilance: { texte: "POINT DE VIGILANCE", couleur: "B7791F" },
  synthese: { texte: "À RETENIR" },
  quiz: { texte: "QUIZ" },
  exemple: { texte: "EXEMPLE" },
  schema: { texte: "SCHÉMA" },
};

/**
 * Construit un diaporama PPTX (16:9). Mise en page sobre et lisible : un titre, peu de points, un emplacement de
 * visuel légendé (le formateur y place son image ou son schéma), les notes du formateur dans le mode présentateur.
 */
export async function rendrePptx(o: { formation_titre: string; organisme: string; couleur: string; module: ModuleParcours; rang: number; diapos: Diapo[] }): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13,33 × 7,5 pouces
  pptx.author = o.organisme;
  pptx.company = o.organisme;
  pptx.title = `${o.formation_titre} — Module ${o.rang}`;
  const accent = hex(o.couleur);
  const encre = "1F2A24";
  const gris = "5B6472";
  const police = "Calibri";
  const total = o.diapos.length;

  o.diapos.forEach((d, i) => {
    const slide = pptx.addSlide();
    if (d.notes) slide.addNotes(d.notes);

    if (d.type === "titre") {
      slide.background = { color: accent };
      slide.addText(`MODULE ${o.rang}`, { x: 0.8, y: 1.3, w: 11.7, h: 0.5, fontFace: police, fontSize: 16, bold: true, color: doux(accent, 0.7), charSpacing: 4 });
      slide.addText(o.module.titre, { x: 0.8, y: 1.9, w: 11.7, h: 2.2, fontFace: police, fontSize: 40, bold: true, color: "FFFFFF", valign: "top", fit: "shrink" });
      slide.addText(o.formation_titre, { x: 0.8, y: 4.4, w: 11.7, h: 0.6, fontFace: police, fontSize: 20, color: "FFFFFF" });
      slide.addText(`Durée : ${heuresTexte(o.module.duree_heures)}`, { x: 0.8, y: 5.0, w: 11.7, h: 0.5, fontFace: police, fontSize: 16, color: doux(accent, 0.7) });
      slide.addText(o.organisme, { x: 0.8, y: 6.6, w: 11.7, h: 0.4, fontFace: police, fontSize: 12, color: doux(accent, 0.6) });
      return;
    }

    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: accent }, line: { color: accent } });
    const etiquette = ETIQUETTES[d.type];
    let y = 0.45;
    if (etiquette) {
      const couleur = etiquette.couleur ?? accent;
      slide.addText(etiquette.texte, { x: 0.7, y, w: 3.2, h: 0.36, fontFace: police, fontSize: 11, bold: true, color: couleur, fill: { color: doux(couleur) }, align: "center", valign: "middle", charSpacing: 2 });
      y += 0.5;
    }
    slide.addText(d.titre, { x: 0.7, y, w: 11.9, h: 0.95, fontFace: police, fontSize: 30, bold: true, color: encre, valign: "top", fit: "shrink" });

    const avecVisuel = Boolean(d.visuel);
    const largeurTexte = avecVisuel ? 7.4 : 11.9;
    const encadre = d.type === "point_etape" || d.type === "quiz" || d.type === "pratique";
    if (encadre) slide.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 2.05, w: largeurTexte + 0.2, h: 4.45, fill: { color: doux(accent, 0.93) }, line: { color: doux(accent, 0.75) }, rectRadius: 0.12 });
    if (d.points.length > 0) {
      const numeroter = d.type === "point_etape" || d.type === "quiz";
      slide.addText(
        d.points.map((p) => ({ text: p, options: { bullet: numeroter ? { type: "number" as const } : { code: "25A0" }, paraSpaceAfter: 14 } })),
        { x: 0.8, y: 2.2, w: largeurTexte - 0.2, h: 4.2, fontFace: police, fontSize: d.points.length > 4 ? 18 : 21, color: encre, valign: "top", fit: "shrink" },
      );
    }
    if (avecVisuel) {
      slide.addShape(pptx.ShapeType.roundRect, { x: 8.55, y: 2.05, w: 4.25, h: 4.45, fill: { color: doux(accent, 0.9) }, line: { color: doux(accent, 0.7), dashType: "dash" }, rectRadius: 0.12 });
      slide.addText("VISUEL SUGGÉRÉ", { x: 8.75, y: 2.3, w: 3.85, h: 0.4, fontFace: police, fontSize: 11, bold: true, color: accent, align: "center", charSpacing: 2 });
      slide.addText(d.visuel, { x: 8.75, y: 2.9, w: 3.85, h: 3.2, fontFace: police, fontSize: 15, italic: true, color: gris, align: "center", valign: "middle", fit: "shrink" });
    }
    slide.addText(`${o.formation_titre} · Module ${o.rang}`, { x: 0.7, y: 6.95, w: 10, h: 0.35, fontFace: police, fontSize: 10, color: gris });
    slide.addText(`${i + 1} / ${total}`, { x: 11.3, y: 6.95, w: 1.5, h: 0.35, fontFace: police, fontSize: 10, color: gris, align: "right" });
  });

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

export const nomSupport = (rang: number, titre: string) => `Support — Module ${rang} — ${titre.replace(/[\\/:*?"<>|]/g, " ").slice(0, 80).trim()}.pptx`;

// ——— Documents imprimables du coffre-fort ———

function page(titre: string, sousTitre: string, corps: string, couleur: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(titre)}</title>
<style>
@page{size:A4;margin:18mm 16mm}
body{font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f2a24;margin:0}
h1{font-size:19pt;margin:0 0 4pt;color:${couleur}}
h2{font-size:13pt;margin:18pt 0 6pt;padding-bottom:3pt;border-bottom:1.5pt solid ${couleur}}
h3{font-size:11.5pt;margin:12pt 0 4pt}
.sous{color:#5b6472;margin:0 0 14pt}
table{border-collapse:collapse;width:100%;margin:6pt 0}
td,th{border:0.6pt solid #c9cfc9;padding:5pt 7pt;vertical-align:top;text-align:left}
th{background:#f2f4f1;width:32%}
ul{margin:4pt 0 4pt 16pt;padding:0}
.q{margin:10pt 0;page-break-inside:avoid}
.prop{margin:2pt 0 2pt 14pt}
.case{display:inline-block;width:9pt;height:9pt;border:0.8pt solid #1f2a24;margin-right:6pt;vertical-align:-1pt}
.ligne{border-bottom:0.6pt solid #9aa39b;height:20pt}
.pied{margin-top:22pt;font-size:8.5pt;color:#5b6472}
</style></head><body><h1>${e(titre)}</h1><p class="sous">${e(sousTitre)}</p>${corps}<p class="pied">Document produit par la plateforme — version du ${new Date().toLocaleDateString("fr-FR")}.</p></body></html>`;
}

const ligneTableau = (libelle: string, valeur: string | null | undefined) => (valeur ? `<tr><th>${e(libelle)}</th><td>${e(valeur).replace(/\n/g, "<br>")}</td></tr>` : "");
const euros = (c: number | null) => (c === null ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(c / 100));

/** Programme du parcours (fiche formation) : ce qui est remis au stagiaire et au financeur (indicateurs Qualiopi 1 à 3). */
export function documentProgramme(f: Formation, organisme: { nom: string; couleur: string }): string {
  const modules = (f.formation_modules ?? []) as ModuleParcours[];
  const infos = [
    ligneTableau("Public visé", f.public_vise),
    ligneTableau("Prérequis", f.formation_prerequis),
    ligneTableau("Niveau", f.formation_niveau),
    ligneTableau("Durée", f.formation_duree_heures_total ? `${heuresTexte(f.formation_duree_heures_total)}${f.formation_duree_jours ? ` sur ${String(f.formation_duree_jours).replace(".", ",")} jour(s)` : ""}` : ""),
    ligneTableau("Modalité", { presentiel: "Présentiel", distanciel: "Distanciel", mixte: "Mixte" }[f.formation_modalite]),
    ligneTableau("Effectif", f.formation_effectif_min || f.formation_effectif_max ? `De ${f.formation_effectif_min ?? 1} à ${f.formation_effectif_max ?? "—"} stagiaires` : ""),
    ligneTableau("Tarif", [f.formation_prix_unitaire_ht !== null ? `${euros(f.formation_prix_unitaire_ht)} HT par stagiaire` : "", f.formation_prix_groupe_ht !== null ? `${euros(f.formation_prix_groupe_ht)} HT en intra (groupe)` : ""].filter(Boolean).join(" · ")),
    ligneTableau("Financement", `${libelleModeFinancement(f.mode_financement)}${f.formation_opco ? ` — ${f.formation_opco}` : ""}`),
    ligneTableau("Délai d'accès", f.formation_delai_acces),
    ligneTableau("Accessibilité (handicap)", f.formation_accessibilite),
    ligneTableau("Moyens pédagogiques", f.formation_moyens_pedagogiques),
    ligneTableau("Modalités d'évaluation", f.formation_modalites_evaluation),
    ligneTableau("Sanction", f.formation_modalites_sanction),
  ].join("");
  const objectifs = f.formation_objectifs.split("\n").filter((x) => x.trim());
  const corps = [
    `<h2>Informations clés</h2><table>${infos}</table>`,
    objectifs.length ? `<h2>Objectifs pédagogiques</h2><ul>${objectifs.map((o) => `<li>${e(o)}</li>`).join("")}</ul>` : "",
    modules.length
      ? `<h2>Parcours en ${modules.length} module(s)</h2>${modules
          .map(
            (m, i) => `<h3>Module ${i + 1} — ${e(m.titre)} (${e(heuresTexte(m.duree_heures))})</h3>
<table>${ligneTableau("Objectifs", m.objectifs.join("\n"))}${ligneTableau("Contenus", m.contenus.map((c) => `• ${c}`).join("\n"))}${ligneTableau("Méthodes", m.methodes)}${ligneTableau("Mise en pratique", m.mise_en_pratique)}${ligneTableau("Évaluation", m.evaluation)}</table>`,
          )
          .join("")}`
      : f.programme
        ? `<h2>Programme détaillé</h2><p>${e(f.programme).replace(/\n/g, "<br>")}</p>`
        : "",
  ].join("");
  return page(f.formation_titre, `Programme de formation — ${organisme.nom}`, corps, `#${hex(organisme.couleur)}`);
}

/** Questionnaire imprimable (version papier, SANS le corrigé) — pour une passation hors ligne. */
export function documentOutil(o: Outil, organisme: { nom: string; couleur: string }, formationTitre: string | null, avecCorrige = false): string {
  const TYPES: Record<string, string> = { recueil: "Recueil des besoins", positionnement: "Test de positionnement", acquis: "Évaluation des acquis" };
  const entete = `<table>${ligneTableau("Formation", formationTitre ?? "Toutes formations")}<tr><th>Nom et prénom</th><td><div class="ligne"></div></td></tr><tr><th>Date</th><td><div class="ligne"></div></td></tr></table>`;
  let corps = entete;
  if (o.type === "recueil") {
    const supp = ((o.contenu as { questions_supplementaires?: string[] }).questions_supplementaires ?? []).map((q) => ({ libelle: q }));
    const questions: Array<{ libelle: string; options?: readonly string[] }> = [
      ...FORMULAIRES["00-AVT"].champs.map((c) => ({ libelle: c.libelle, options: "options" in c ? (c.options as readonly string[]) : undefined })),
      ...supp,
    ];
    corps += questions
      .map((c, i) => `<div class="q"><strong>${i + 1}. ${e(c.libelle)}</strong>${c.options ? c.options.map((p) => `<div class="prop"><span class="case"></span>${e(p)}</div>`).join("") : '<div class="ligne"></div><div class="ligne"></div>'}</div>`)
      .join("");
  } else {
    const q = o.contenu as Questionnaire;
    corps += q.questions
      .map((x, i) => `<div class="q"><strong>${i + 1}. ${e(x.enonce)}</strong>${x.propositions.map((p, j) => `<div class="prop"><span class="case"></span>${e(p)}${avecCorrige && j === x.bonne_reponse ? " <strong>✔</strong>" : ""}</div>`).join("")}</div>`)
      .join("");
  }
  corps += `<h2>Signature</h2><table><tr><th>Signature du stagiaire</th><td style="height:60pt"></td></tr></table>`;
  return page(o.titre, `${TYPES[o.type] ?? o.type}${avecCorrige ? " — CORRIGÉ (réservé au formateur)" : ""} — ${organisme.nom}`, corps, `#${hex(organisme.couleur)}`);
}
