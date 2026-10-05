/**
 * Rendu d'un support de cours PPTX (16:9) — port de `rendrePptx` de `src/serveur/services/supports.ts`.
 *
 * Aucun appel à l'IA ici : on met en forme un plan que le formateur a vu et validé. La bibliothèque `pptxgenjs` est
 * chargée à l'appel ; elle a été exécutée sous workerd (le moteur de Cloudflare Workers) avec les options utilisées ici
 * (formes, texte, notes, `uint8array`) — voir le compte rendu du lot 7. Aucune image distante n'est jamais chargée :
 * le code de `pptxgenjs` qui touche à `node:fs` / `node:https` (images par adresse) n'est donc pas exécuté.
 */
import { heuresTexte, type Diapo, type ModuleParcours } from "@/domaine/pedagogie/parcours";

const hex = (c: string, defaut = "1D6A45") =>
  /^#?[0-9a-f]{6}$/i.test(c) ? c.replace("#", "").toUpperCase() : defaut;

/** Éclaircit une couleur (mélange avec du blanc) pour les fonds doux. */
function doux(c: string, part = 0.88): string {
  const n = parseInt(c, 16);
  const m = (v: number) =>
    Math.round(v + (255 - v) * part)
      .toString(16)
      .padStart(2, "0");
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
export async function rendrePptx(o: {
  formation_titre: string;
  organisme: string;
  couleur: string;
  module: ModuleParcours;
  rang: number;
  diapos: Diapo[];
}): Promise<Uint8Array> {
  // Import différé : la bibliothèque n'est chargée que lorsqu'un support est réellement produit.
  const { default: PptxGenJS } = await import("pptxgenjs");
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
      slide.addText(`MODULE ${o.rang}`, {
        x: 0.8,
        y: 1.3,
        w: 11.7,
        h: 0.5,
        fontFace: police,
        fontSize: 16,
        bold: true,
        color: doux(accent, 0.7),
        charSpacing: 4,
      });
      slide.addText(o.module.titre, {
        x: 0.8,
        y: 1.9,
        w: 11.7,
        h: 2.2,
        fontFace: police,
        fontSize: 40,
        bold: true,
        color: "FFFFFF",
        valign: "top",
        fit: "shrink",
      });
      slide.addText(o.formation_titre, {
        x: 0.8,
        y: 4.4,
        w: 11.7,
        h: 0.6,
        fontFace: police,
        fontSize: 20,
        color: "FFFFFF",
      });
      slide.addText(`Durée : ${heuresTexte(o.module.duree_heures)}`, {
        x: 0.8,
        y: 5.0,
        w: 11.7,
        h: 0.5,
        fontFace: police,
        fontSize: 16,
        color: doux(accent, 0.7),
      });
      slide.addText(o.organisme, {
        x: 0.8,
        y: 6.6,
        w: 11.7,
        h: 0.4,
        fontFace: police,
        fontSize: 12,
        color: doux(accent, 0.6),
      });
      return;
    }

    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.18,
      h: 7.5,
      fill: { color: accent },
      line: { color: accent },
    });
    const etiquette = ETIQUETTES[d.type];
    let y = 0.45;
    if (etiquette) {
      const couleur = etiquette.couleur ?? accent;
      slide.addText(etiquette.texte, {
        x: 0.7,
        y,
        w: 3.2,
        h: 0.36,
        fontFace: police,
        fontSize: 11,
        bold: true,
        color: couleur,
        fill: { color: doux(couleur) },
        align: "center",
        valign: "middle",
        charSpacing: 2,
      });
      y += 0.5;
    }
    slide.addText(d.titre, {
      x: 0.7,
      y,
      w: 11.9,
      h: 0.95,
      fontFace: police,
      fontSize: 30,
      bold: true,
      color: encre,
      valign: "top",
      fit: "shrink",
    });

    const avecVisuel = Boolean(d.visuel);
    const largeurTexte = avecVisuel ? 7.4 : 11.9;
    const encadre = d.type === "point_etape" || d.type === "quiz" || d.type === "pratique";
    if (encadre)
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.6,
        y: 2.05,
        w: largeurTexte + 0.2,
        h: 4.45,
        fill: { color: doux(accent, 0.93) },
        line: { color: doux(accent, 0.75) },
        rectRadius: 0.12,
      });
    if (d.points.length > 0) {
      const numeroter = d.type === "point_etape" || d.type === "quiz";
      slide.addText(
        d.points.map((p) => ({
          text: p,
          options: {
            bullet: numeroter ? { type: "number" as const } : { code: "25A0" },
            paraSpaceAfter: 14,
          },
        })),
        {
          x: 0.8,
          y: 2.2,
          w: largeurTexte - 0.2,
          h: 4.2,
          fontFace: police,
          fontSize: d.points.length > 4 ? 18 : 21,
          color: encre,
          valign: "top",
          fit: "shrink",
        },
      );
    }
    if (avecVisuel) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 8.55,
        y: 2.05,
        w: 4.25,
        h: 4.45,
        fill: { color: doux(accent, 0.9) },
        line: { color: doux(accent, 0.7), dashType: "dash" },
        rectRadius: 0.12,
      });
      slide.addText("VISUEL SUGGÉRÉ", {
        x: 8.75,
        y: 2.3,
        w: 3.85,
        h: 0.4,
        fontFace: police,
        fontSize: 11,
        bold: true,
        color: accent,
        align: "center",
        charSpacing: 2,
      });
      slide.addText(d.visuel, {
        x: 8.75,
        y: 2.9,
        w: 3.85,
        h: 3.2,
        fontFace: police,
        fontSize: 15,
        italic: true,
        color: gris,
        align: "center",
        valign: "middle",
        fit: "shrink",
      });
    }
    slide.addText(`${o.formation_titre} · Module ${o.rang}`, {
      x: 0.7,
      y: 6.95,
      w: 10,
      h: 0.35,
      fontFace: police,
      fontSize: 10,
      color: gris,
    });
    slide.addText(`${i + 1} / ${total}`, {
      x: 11.3,
      y: 6.95,
      w: 1.5,
      h: 0.35,
      fontFace: police,
      fontSize: 10,
      color: gris,
      align: "right",
    });
  });

  // `uint8array` (et non `nodebuffer`) : Cloudflare Workers n'a pas de `Buffer` sans polyfill.
  return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}
