/**
 * Contrôle de TOUS les gabarits livrés — c'est la « procédure de contrôle final » de la skill
 * conventions-s4m, exécutée à chaque `npm test` et dans la CI.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { analyserGabarit, balisesRestantes, rendreGabarit } from "@/domaine/gabarits/moteur";
import { NOMENCLATURE, estIndividuelle, type CodePiece } from "@/domaine/referentiel/pieces";
import { resoudreVariables } from "@/domaine/dossier/resolution";
import { dossierDeDemonstration } from "@/domaine/dossier/fixture";
import { chargerGabarit, chargerInclusions, gabaritExiste } from "./chargeur";

const GENEREES = NOMENCLATURE.filter((d) => d.mode === "generee").map((d) => d.code);
// La facture du formateur est déposée par lui, mais la plateforme lui en propose une trame pré-remplie.
const AVEC_GABARIT: CodePiece[] = [...GENEREES, "10-FIN"];

/** Variables qu'un gabarit peut légitimement laisser vides dans le dossier de démonstration. */
const FACULTATIVES = new Set(["of_tva_intracom", "of_certification_complementaire_numero"]);

function sourceComplete(code: CodePiece): string {
  const inclusions = chargerInclusions();
  return chargerGabarit(code).replace(/<!--\s*inclure:([a-z_]+)\s*-->/g, (_t, nom: string) => inclusions[nom] ?? "");
}

describe("gabarits des pièces", () => {
  it("existe pour chaque pièce générée, et pour rien d'autre", () => {
    for (const code of AVEC_GABARIT) expect(gabaritExiste(code), code).toBe(true);
    const fichiers = readdirSync(new URL("../../../gabarits/", import.meta.url)).filter((f) => f.endsWith(".html"));
    expect(fichiers.map((f) => f.replace(".html", "")).sort()).toEqual([...AVEC_GABARIT].sort());
  });

  it.each(AVEC_GABARIT)("%s — aucune variable hors dictionnaire, aucun bloc mal fermé, aucun crochet", (code) => {
    expect(analyserGabarit(sourceComplete(code)).defauts).toEqual([]);
  });

  it.each(AVEC_GABARIT)("%s — aucune donnée réelle codée en dur", (code) => {
    const source = sourceComplete(code);
    const interdits: Array<[RegExp, string]> = [
      [/skills4mation|formatrix|back\s*to\s*business/i, "nom d'un organisme réel"],
      [/albisser|benmara|garcia/i, "nom d'une personne réelle"],
      [/hirtzbach|rixheim/i, "adresse réelle"],
      [/\b\d{3}\s?\d{3}\s?\d{3}\s?\d{5}\b/, "SIRET en dur"],
      [/\bFR\d{2}[\s\d]{10,}/, "IBAN ou TVA en dur"],
      [/\b\d{2}\s\d{2}\s\d{5}\s\d{2}\b/, "numéro de déclaration d'activité en dur"],
      [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, "date en dur"],
      [/\d[\d\s]*,\d{2}\s?€/, "montant en dur"],
    ];
    for (const [re, quoi] of interdits) expect(re.test(source), `${code} : ${quoi}`).toBe(false);
  });

  it.each(AVEC_GABARIT)("%s — se rend complètement sur le dossier de démonstration", (code) => {
    const dossier = dossierDeDemonstration();
    const variables = resoudreVariables(dossier, estIndividuelle(code) ? { stagiaireId: "stg-1" } : {});
    const { html, manquantes } = rendreGabarit(chargerGabarit(code), { variables, inclusions: chargerInclusions() });
    expect(balisesRestantes(html)).toEqual([]);
    expect(manquantes.filter((m) => !FACULTATIVES.has(m))).toEqual([]);
    expect(html).toContain("ADF-2026-0001");
    expect(html).not.toMatch(/<!--\s*(repeter|si|sauf|inclure|zone)/);
  });

  it("porte l'identité de l'organisme par configuration : deux organismes, deux conventions", () => {
    const a = dossierDeDemonstration();
    const b = dossierDeDemonstration();
    b.organisme.of_nom = "AUTRE ORGANISME";
    b.organisme.of_siret = "99999999999999";
    const rendre = (d: typeof a) => rendreGabarit(chargerGabarit("02-AVT"), { variables: resoudreVariables(d), inclusions: chargerInclusions() }).html;
    expect(rendre(a)).toContain("ORGANISME DÉMO FORMATION");
    expect(rendre(b)).toContain("AUTRE ORGANISME");
    expect(rendre(b)).not.toContain("ORGANISME DÉMO FORMATION");
  });

  it("émargement : une case de signature par stagiaire et par séance", () => {
    const dossier = dossierDeDemonstration();
    const vus: string[] = [];
    rendreGabarit(chargerGabarit("06-PDT"), {
      variables: resoudreVariables(dossier, { stagiaireId: "stg-1" }),
      inclusions: chargerInclusions(),
      zones: { emargement_stagiaire: (r) => (vus.push(`${r.stagiaire}-${r.session}`), "") },
    });
    expect(vus).toEqual(["1-1", "1-2", "1-3", "1-4"]);
  });
});
