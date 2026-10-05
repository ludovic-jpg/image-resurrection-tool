import { describe, expect, it } from "vitest";
import {
  blocSignatureHtml,
  certificatHtml,
  validerDemandeSignature,
  verifierIntegrite,
  type PreuveSignature,
} from "./preuve";

const TRACE = `data:image/png;base64,${"A".repeat(800)}`;
const hacherTest = (contenu: string) => `h${contenu.length}-${contenu.charCodeAt(0)}`;

const preuve: PreuveSignature = {
  signataire_nom: "Anne <Martin>",
  signataire_role: "apprenant",
  signataire_email: "anne@exemple.example",
  trace_png: TRACE,
  lieu: "Mulhouse",
  horodatage: "2026-10-10T08:30:00.000Z",
  empreinte_document: hacherTest("<html>convention</html>"),
};

describe("demande de signature", () => {
  it("accepte un tracé PNG avec lieu et consentement", () => {
    expect(validerDemandeSignature({ trace_png: TRACE, lieu: "Mulhouse", consentement: true })).toEqual([]);
  });

  it("refuse l'absence de consentement, de lieu, un tracé vide ou un format détourné", () => {
    expect(validerDemandeSignature({ trace_png: TRACE, lieu: " ", consentement: false })).toHaveLength(2);
    expect(
      validerDemandeSignature({ trace_png: "data:image/png;base64,AAAA", lieu: "Ici", consentement: true }),
    ).toEqual(["Le tracé de signature est vide."]);
    expect(
      validerDemandeSignature({
        trace_png: "data:image/svg+xml;base64,PHN2Zz4=",
        lieu: "Ici",
        consentement: true,
      })[0],
    ).toMatch(/format non reconnu/);
    expect(
      validerDemandeSignature({ trace_png: `javascript:alert(1)`, lieu: "Ici", consentement: true })[0],
    ).toMatch(/format non reconnu/);
    expect(
      validerDemandeSignature({
        trace_png: `data:image/png;base64,${"A".repeat(500_000)}`,
        lieu: "Ici",
        consentement: true,
      })[0],
    ).toMatch(/volumineux/);
  });
});

describe("intégrité et preuve", () => {
  it("détecte un document modifié après signature", async () => {
    expect(await verifierIntegrite("<html>convention</html>", preuve, hacherTest)).toBe(true);
    expect(await verifierIntegrite("<html>convention modifiée</html>", preuve, hacherTest)).toBe(false);
  });

  it("affiche l'attente puis la signature, en échappant le nom du signataire", () => {
    expect(blocSignatureHtml(null)).toContain("En attente de signature");
    const html = blocSignatureHtml(preuve);
    expect(html).toContain("Anne &lt;Martin&gt;");
    expect(html).toContain("10 octobre 2026");
    expect(html).toContain("10:30:00"); // Europe/Paris, et non UTC
  });

  it("produit un certificat complet", () => {
    const html = certificatHtml(preuve, {
      code: "02-AVT",
      libelle: "Convention de formation",
      dossier_reference: "ADF-2026-0001",
    });
    for (const attendu of [
      "02-AVT — Convention de formation",
      "ADF-2026-0001",
      preuve.empreinte_document,
      "2026-10-10T08:30:00.000Z",
      "eIDAS",
    ]) {
      expect(html).toContain(attendu);
    }
  });
});
