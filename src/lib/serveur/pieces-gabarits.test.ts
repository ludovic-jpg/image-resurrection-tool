// @vitest-environment node
/**
 * Parité du rendu des gabarits : le module embarqué (`import.meta.glob ?raw`, sans disque à l'exécution) et le moteur
 * pur `rendrePieceHtml` donnent EXACTEMENT la sortie du service Node d'origine (chargeur sur disque + moteur) sur le
 * dossier de démonstration `src/domaine/dossier/fixture.ts`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dossierDeDemonstration } from "@/domaine/dossier/fixture";
import { resoudreVariables } from "@/domaine/dossier/resolution";
import { rendreGabarit } from "@/domaine/gabarits/moteur";
import { rendrePieceHtml, zonesDePiece, type DonneesRendu } from "@/domaine/pieces/rendu";
import { NOMENCLATURE, estIndividuelle, type CodePiece } from "@/domaine/referentiel/pieces";
import {
  chargerGabarit as chargerGabaritDisque,
  chargerInclusions,
} from "@/serveur/gabarits/chargeur";
import {
  chargerFragments,
  chargerGabarit,
  codesAvecGabarit,
  gabaritExiste,
} from "./pieces-gabarits.server";
import { inclusionsDe } from "@/domaine/pieces/rendu";

const RACINE = new URL("../../../gabarits/", import.meta.url);
const CODES: CodePiece[] = [
  ...NOMENCLATURE.filter((d) => d.mode === "generee").map((d) => d.code),
  "10-FIN",
];

const donnees = (code: CodePiece): DonneesRendu => {
  const agregat = dossierDeDemonstration();
  return {
    code,
    agregat,
    stagiaireId: estIndividuelle(code) ? (agregat.stagiaires[0]?.id ?? null) : null,
    organisme: { of_nom: agregat.organisme.of_nom },
    signatures: [],
    reponses: {},
    questionnaires: { positionnement: null, acquis: null },
    seances: [],
    pointages: [],
  };
};

describe("gabarits embarqués", () => {
  it("existent pour chaque pièce générée (et la trame 10-FIN), et pour rien d'autre", () => {
    for (const code of CODES) expect(gabaritExiste(code), code).toBe(true);
    const fichiers = readdirSync(RACINE)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(".html", ""))
      .sort();
    expect(codesAvecGabarit()).toEqual(fichiers);
    expect(fichiers).toEqual([...CODES].sort());
  });

  it.each(CODES)("%s — texte embarqué identique au fichier de gabarits/", (code) => {
    expect(chargerGabarit(code)).toBe(readFileSync(new URL(`${code}.html`, RACINE), "utf8"));
  });

  it("fragments embarqués identiques aux fichiers", () => {
    const f = chargerFragments();
    expect(f.styles).toBe(readFileSync(new URL("fragments/styles.css", RACINE), "utf8"));
    expect(f.entete).toBe(readFileSync(new URL("fragments/entete.html", RACINE), "utf8"));
    expect(f.pied).toBe(readFileSync(new URL("fragments/pied.html", RACINE), "utf8"));
  });

  it("un code sans gabarit lève une erreur claire", () => {
    expect(() => chargerGabarit("99-XXX" as CodePiece)).toThrow(/Aucun gabarit/);
  });
});

describe("parité du rendu avec le service Node", () => {
  it.each(CODES)("%s — même HTML, octet pour octet", (code) => {
    const d = donnees(code);
    const variables = resoudreVariables(
      d.agregat,
      estIndividuelle(code) && d.stagiaireId ? { stagiaireId: d.stagiaireId } : {},
    );
    const reference = rendreGabarit(chargerGabaritDisque(code), {
      variables,
      zones: zonesDePiece(d),
      inclusions: chargerInclusions(),
    });
    const rendu = rendrePieceHtml(chargerGabarit(code), chargerFragments(), d);
    expect(rendu.html).toBe(reference.html);
    expect(rendu.manquantes).toEqual(reference.manquantes);
  });

  it("la couleur de l'organisme est posée comme dans l'ancien chargeur", () => {
    expect(inclusionsDe(chargerFragments(), "#123abc")).toEqual(chargerInclusions("#123abc"));
    expect(inclusionsDe(chargerFragments(), "pas-une-couleur")).toEqual(chargerInclusions());
  });
});
