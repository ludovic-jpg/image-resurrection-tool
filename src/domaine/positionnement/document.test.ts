import { describe, expect, it } from "vitest";
import { formulaireRecueil } from "./regles";
import { documentPositionnement, type DonneesDocument } from "./document";

const base = (): DonneesDocument => ({
  of_nom: "Skills4mation",
  couleur: "#1d6a45",
  formation: "Soudure <TIG>",
  apprenant: "Anne Martin",
  email: "anne@exemple.fr",
  entreprise: "Atelier & Fils",
  def: formulaireRecueil(["Contrainte ?"]),
  recueil: { attentes: "Du <b>concret</b>\nvite", supp_1: "RAS" },
  questionnaire: {
    titre: "Test d'entrée",
    questions: [
      { enonce: "Quel gaz ?", propositions: ["Argon", "Azote"], bonne_reponse: 0 },
      { enonce: "Quelle électrode ?", propositions: ["W", "Cu"], bonne_reponse: 0 },
    ],
  },
  reponses: [1, null],
  score: 0,
  date: "2026-10-05",
  lieu: "Rixheim",
  signe_le: "2026-10-05T08:30:00.000Z",
  trace_png: "data:image/png;base64,AAAA",
  empreinte: "abc123",
  reference: "pos-1",
});

describe("document de positionnement", () => {
  it("échappe toutes les données saisies", () => {
    const html = documentPositionnement(base());
    expect(html).toContain("Soudure &lt;TIG&gt;");
    expect(html).toContain("Atelier &amp; Fils");
    expect(html).toContain("Du &lt;b&gt;concret&lt;/b&gt;<br>vite");
    expect(html).not.toContain("<b>concret</b>");
  });

  it("montre la réponse choisie et le score, jamais la bonne réponse", () => {
    const html = documentPositionnement(base());
    expect(html).toContain("Azote");
    expect(html).toContain("Score de positionnement : 0 / 100");
    expect(html).not.toContain("bonne_reponse");
  });

  it("est autonome : horodatage lisible, empreinte, tracé en data-URL, aucune ressource externe", () => {
    const html = documentPositionnement(base());
    expect(html).toContain("5 octobre 2026");
    expect(html).toContain("abc123");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).not.toContain("{{");
  });

  it("retombe sur la couleur par défaut si elle n'est pas un code hexadécimal sûr", () => {
    const html = documentPositionnement({ ...base(), couleur: "red;}</style><script>" });
    expect(html).toContain("#1d6a45");
    expect(html).not.toContain("<script>");
  });

  it("sans test, pas de section B", () => {
    expect(documentPositionnement({ ...base(), questionnaire: null, score: null })).not.toContain(
      "B. Test de positionnement",
    );
  });
});
