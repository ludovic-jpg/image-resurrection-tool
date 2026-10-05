import { describe, expect, it } from "vitest";
import { analyserGabarit, balisesRestantes, compterRangs, rendreGabarit } from "./moteur";
import { migrerGabarit } from "./migration";

describe("rendu d'un gabarit", () => {
  it("substitue les variables et n'en laisse aucune", () => {
    const { html, manquantes } = rendreGabarit(
      "<h1>{{formation_titre}}</h1><p>{{dossier_reference}}</p>",
      {
        variables: { formation_titre: "Excel avancé", dossier_reference: "ADF-2026-0001" },
      },
    );
    expect(html).toBe("<h1>Excel avancé</h1><p>ADF-2026-0001</p>");
    expect(manquantes).toEqual([]);
    expect(balisesRestantes(html)).toEqual([]);
  });

  it("échappe le HTML des valeurs saisies (pas d'injection dans une pièce contractuelle)", () => {
    const { html } = rendreGabarit("<p>{{entreprise_nom}}</p>", {
      variables: { entreprise_nom: `<script>alert("x")</script> & Fils` },
    });
    expect(html).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Fils</p>");
  });

  it("rend les sauts de ligne des textes longs", () => {
    const { html } = rendreGabarit("<p>{{formation_objectifs}}</p>", {
      variables: { formation_objectifs: "Objectif 1\nObjectif 2" },
    });
    expect(html).toBe("<p>Objectif 1<br>Objectif 2</p>");
  });

  it("signale les valeurs manquantes au lieu de produire un document silencieusement incomplet", () => {
    const { html, manquantes } = rendreGabarit("{{of_siret}} / {{of_nom}} / {{formation_titre}}", {
      variables: { of_nom: "Organisme", formation_titre: "  " },
    });
    expect(html).toBe("— / Organisme / —");
    expect(manquantes).toEqual(["formation_titre", "of_siret"]);
  });

  it("développe un groupe répétable sans laisser de ligne vide", () => {
    const gabarit =
      "<ul><!-- repeter:stagiaire --><li>{{rang_stagiaire}}. {{stagiaire_N_nom}} — {{stagiaire_N_poste}}</li><!-- /repeter:stagiaire --></ul>";
    const { html, manquantes } = rendreGabarit(gabarit, {
      variables: {
        stagiaire_1_nom: "Anne Martin",
        stagiaire_1_poste: "Comptable",
        stagiaire_2_nom: "Luc Petit",
        stagiaire_2_poste: "Assistant",
      },
    });
    expect(html).toBe(
      "<ul><li>1. Anne Martin — Comptable</li><li>2. Luc Petit — Assistant</li></ul>",
    );
    expect(manquantes).toEqual([]);
  });

  it("rend un groupe vide par… rien", () => {
    const { html } = rendreGabarit(
      "<ul><!-- repeter:session --><li>{{session_N_date}}</li><!-- /repeter:session --></ul>",
      {
        variables: {},
      },
    );
    expect(html).toBe("<ul></ul>");
  });

  it("imbrique stagiaires et séances (feuille d'émargement) et transmet les rangs aux zones", () => {
    const gabarit =
      "<!-- repeter:stagiaire --><h2>{{stagiaire_N_nom}}</h2><!-- repeter:session --><p>{{session_N_date}} <!-- zone:case --></p><!-- /repeter:session --><!-- /repeter:stagiaire -->";
    const { html } = rendreGabarit(gabarit, {
      variables: {
        stagiaire_1_nom: "A",
        stagiaire_2_nom: "B",
        session_1_date: "01/10",
        session_2_date: "02/10",
      },
      zones: { case: (r) => `[${r.stagiaire}-${r.session}]` },
    });
    expect(html).toBe(
      "<h2>A</h2><p>01/10 [1-1]</p><p>02/10 [1-2]</p><h2>B</h2><p>01/10 [2-1]</p><p>02/10 [2-2]</p>",
    );
  });

  it("applique les blocs conditionnels si / sauf", () => {
    const gabarit =
      "<!-- si:formation_lien_visio -->Visio : {{formation_lien_visio}}<!-- /si:formation_lien_visio --><!-- sauf:formation_lien_visio -->Sur site<!-- /sauf:formation_lien_visio -->";
    expect(
      rendreGabarit(gabarit, { variables: { formation_lien_visio: "https://visio.example" } }).html,
    ).toBe("Visio : https://visio.example");
    const sansLien = rendreGabarit(gabarit, { variables: {} });
    expect(sansLien.html).toBe("Sur site");
    expect(sansLien.manquantes).toEqual([]); // une variable d'un bloc écarté ne « manque » pas
  });

  it("insère fragments partagés et zones de confiance, et ignore une zone non fournie", () => {
    const { html } = rendreGabarit(
      "<style><!-- inclure:styles --></style><!-- zone:signature_apprenant --><!-- zone:absente -->",
      {
        variables: {},
        inclusions: { styles: "p{margin:0}" },
        zones: { signature_apprenant: () => "<img alt='signature'>" },
      },
    );
    expect(html).toBe("<style>p{margin:0}</style><img alt='signature'>");
  });

  it("borne les groupes répétables à 8 stagiaires et 20 séances", () => {
    expect(compterRangs({ stagiaire_12_nom: "x" }, "stagiaire")).toBe(8);
    expect(compterRangs({ session_3_date: "x", session_5_date: "" }, "session")).toBe(3);
  });
});

describe("contrôle statique d'un gabarit", () => {
  it("accepte un gabarit conforme", () => {
    const a = analyserGabarit(
      "{{of_nom}} <!-- repeter:stagiaire -->{{stagiaire_N_nom}}<!-- /repeter:stagiaire --> {{stagiaire_1_nom}}",
    );
    expect(a.defauts).toEqual([]);
    expect(a.variables).toEqual(["of_nom", "stagiaire_1_nom", "stagiaire_N_nom"]);
  });

  it("rejette anciens noms, crochets, résidus de code, espaces parasites et blocs mal fermés", () => {
    const a = analyserGabarit(
      "{{nbadf}} [NOM_STAGIAIRE] {{${varName}} {{format }} {{...}} <!-- repeter:stagiaire -->{{stagiaire_N_nom}} <!-- si:of_nom -->x",
    );
    expect(a.defauts).toEqual(
      expect.arrayContaining([
        "variable hors dictionnaire : nbadf",
        "ancienne syntaxe entre crochets : [NOM_STAGIAIRE]",
        expect.stringContaining("résidu de code"),
        expect.stringContaining("espace parasite"),
        expect.stringContaining("blocs « repeter » mal appariés"),
        expect.stringContaining("blocs « si » mal appariés"),
      ]),
    );
  });

  it("rejette une variable répétable utilisée hors de son bloc", () => {
    expect(analyserGabarit("{{session_N_date}}").defauts).toEqual([
      "variable répétable hors de son bloc « repeter » : session_N_date",
    ]);
  });
});

describe("migration d'un ancien gabarit", () => {
  it("remplace les anciens noms, scinde le formateur, et laisse à l'humain ce qui est douteux", () => {
    const r = migrerGabarit(
      "{{nbadf}} {{nomformateur}} {{format }} {{nomapp2}} {{prixun}} {{variable}} {{of_nom}}",
    );
    expect(r.html).toBe(
      "{{dossier_reference}} {{formateur_prenom}} {{formateur_nom}} {{formation_modalite}} {{stagiaire_2_nom}} {{prixun}} {{variable}} {{of_nom}}",
    );
    expect(r.ambigus.map((a) => a.ancien)).toEqual(["prixun"]);
    expect(r.inconnus).toEqual(["variable"]);
  });
});
