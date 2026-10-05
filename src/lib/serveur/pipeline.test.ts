// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bdMemoire,
  ecritures,
  type Ligne,
  type OptionsMemoire,
  type Tables,
} from "@/test/bd-memoire";
import { ACTEURS } from "@/test/faux-supabase";
import { NOMENCLATURE } from "@/domaine/referentiel/pieces";
import type { Action } from "@/domaine/pipeline/transitions";
import type { Acteur } from "./acteur.server";
import { ErreurMetier } from "./erreurs.server";
import { brancherPortsLots, reinitialiserPortsLots } from "./ports-lots.server";
import { executerTransition } from "./pipeline.server";

type Qui = "admin" | "formateur" | "apprenant" | "systeme";
const ACTEUR: Record<Qui, Acteur | "systeme"> = {
  admin: ACTEURS.admin as unknown as Acteur,
  formateur: ACTEURS.formateurValide as unknown as Acteur,
  apprenant: ACTEURS.apprenant as unknown as Acteur,
  systeme: "systeme",
};

const DOSSIER: Ligne = {
  id: "d1",
  of_id: "of1",
  dossier_reference: "ADF-2026-0001",
  formateur_id: "f1",
  entreprise_id: "e1",
  formation_id: "fo1",
  sous_statut: "brouillon",
  mode_financement: "opco",
  formation_titre: "Soudure",
  formation_objectifs: "Souder",
  formation_programme: "Jour 1",
  formation_date_debut: "2026-11-02",
  formation_date_fin: "2026-11-03",
  formation_duree_heures_total: 14,
  formation_prix_unitaire_ht: 120000,
  formation_modalite: "presentiel",
  formation_lieu_adresse: "1 rue X",
  formation_lien_visio: "",
  signature_lieu: "Mulhouse",
  questionnaire_positionnement: null,
  questionnaire_acquis: null,
  coffre_ouvert: false,
  motif_renvoi: "",
  motif_refus: "",
  termine_le: null,
  archive_le: null,
};
const OF_COMPLET: Ligne = {
  id: "of1",
  of_nom: "Mon OF",
  of_adresse: "1 rue de l'OF",
  of_siret: "123",
  of_nda_numero: "42",
  of_dreets_region: "Grand Est",
  of_representant_prenom: "Alice",
  of_representant_nom: "Admin",
  of_email_pedagogie: "peda@of.fr",
  of_tribunal_competent: "Mulhouse",
};

/** Pièces `valide` du scénario : `[code, stagiaire]`. */
type Valide = [string, string | null];
function monter(
  statut: string,
  valides: Valide[] = [],
  options: { dossier?: Ligne; organisme?: Ligne; tables?: Tables } & OptionsMemoire = {},
) {
  const tables: Tables = {
    dossier_formation: [{ ...DOSSIER, ...options.dossier, sous_statut: statut }],
    stagiaire_dossier: [{ dossier_id: "d1", stagiaire_id: "s1", poste_occupe: "", rang: 1 }],
    stagiaire: [
      {
        id: "s1",
        of_id: "of1",
        formateur_id: "f1",
        utilisateur_id: null,
        stagiaire_prenom: "Anne",
        stagiaire_nom: "Apprenante",
        stagiaire_email: "anne@x.fr",
        stagiaire_poste: "",
      },
    ],
    piece_dossier: valides.map(([code, stagiaire_id]) => ({
      dossier_id: "d1",
      code,
      stagiaire_id,
      statut: "valide",
      chemin_depart: null,
    })),
    seance: [
      { id: "se1", dossier_id: "d1", date: "2026-11-02", heure_debut: "09:00", heure_fin: "12:00" },
    ],
    entreprise_cliente: [
      {
        id: "e1",
        entreprise_siret: "999",
        entreprise_representant_civilite: "Mme",
        entreprise_representant_nom: "Durand",
        entreprise_representant_email: "durand@acme.fr",
      },
    ],
    organisme_formation: [{ ...OF_COMPLET, ...options.organisme }],
    formateur: [
      {
        id: "f1",
        formateur_prenom: "Fred",
        formateur_nom: "Formateur",
        formateur_email: "fred@of.fr",
      },
    ],
    utilisateur: [
      { email: "admin@of.fr", of_id: "of1", role: "admin", actif: true, supprime_le: null },
    ],
    ...options.tables,
  };
  const bd = bdMemoire(tables, options);
  return { ...bd, courriers: () => tables["courrier"]?.map((c) => c["type"]) ?? [] };
}

const REQUISES_COMPLETUDE: Valide[] = NOMENCLATURE.filter((d) => d.requisePourCompletude).map(
  (d) => [
    d.code,
    [
      "00-AVT",
      "01-AVT",
      "05-AVT",
      "06-PDT",
      "07-FIN",
      "08-FIN",
      "09-FIN",
      "12-APR",
      "PRE",
    ].includes(d.code)
      ? "s1"
      : null,
  ],
);

interface Cas {
  action: Action;
  de: string;
  vers: string;
  autorises: Qui[];
  valides?: Valide[];
  motif?: string;
  /** Un statut où l'action n'est pas possible. */
  statutRefuse: string;
  /** Pièces manquantes qui bloquent la garde (le scénario `valides` sans elles). */
  gardeBloquante?: { valides: Valide[]; message: RegExp };
  motifRequis?: boolean;
  courriers: string[];
  colonnes?: Record<string, unknown>;
}

const CAS: Cas[] = [
  {
    action: "soumettre_validation",
    de: "brouillon",
    vers: "en_cours_validation",
    autorises: ["formateur"],
    valides: [
      ["00-AVT", "s1"],
      ["01-AVT", "s1"],
    ],
    statutRefuse: "dossier_valide",
    gardeBloquante: { valides: [["00-AVT", "s1"]], message: /test de positionnement/i },
    courriers: ["demande_validation"],
  },
  {
    action: "renvoyer_en_brouillon",
    de: "en_cours_validation",
    vers: "brouillon",
    autorises: ["admin"],
    motif: "Ajouter le programme",
    motifRequis: true,
    statutRefuse: "brouillon",
    courriers: ["renvoi_brouillon"],
    colonnes: { motif_renvoi: "Ajouter le programme" },
  },
  {
    action: "valider_dossier",
    de: "en_cours_validation",
    vers: "dossier_valide",
    autorises: ["admin"],
    statutRefuse: "brouillon",
    courriers: ["pieces_financement"],
  },
  {
    action: "declarer_depot",
    de: "dossier_valide",
    vers: "dossier_depose",
    autorises: ["apprenant", "formateur", "admin"],
    valides: [["02-AVT", null]],
    statutRefuse: "brouillon",
    gardeBloquante: { valides: [], message: /convention de formation doit être signée/i },
    courriers: ["depot_declare"],
  },
  {
    action: "enregistrer_accord",
    de: "dossier_depose",
    vers: "accord_financement",
    autorises: ["systeme"],
    valides: [["ACC", null]],
    statutRefuse: "brouillon",
    gardeBloquante: { valides: [], message: /accord de financement doit être déposé/i },
    courriers: ["odm"],
    colonnes: { coffre_ouvert: true },
  },
  {
    action: "enregistrer_refus",
    de: "dossier_depose",
    vers: "refus_financement",
    autorises: ["formateur", "admin"],
    valides: [["REF", null]],
    motif: "Prise en charge refusée",
    statutRefuse: "brouillon",
    gardeBloquante: { valides: [], message: /justificatif du refus/i },
    courriers: [],
    colonnes: { motif_refus: "Prise en charge refusée" },
  },
  {
    action: "envoyer_elements_pedagogiques",
    de: "accord_financement",
    vers: "envoi_elements_pedagogiques",
    autorises: ["formateur", "admin"],
    statutRefuse: "dossier_depose",
    courriers: ["elements_pedagogiques"],
  },
  {
    action: "demarrer_formation",
    de: "envoi_elements_pedagogiques",
    vers: "formation_debutee",
    autorises: ["formateur", "admin"],
    statutRefuse: "accord_financement",
    courriers: [],
  },
  {
    action: "terminer_formation",
    de: "formation_debutee",
    vers: "fin_dossier_incomplet",
    autorises: ["formateur", "admin"],
    statutRefuse: "envoi_elements_pedagogiques",
    courriers: [],
  },
  {
    action: "reevaluer_completude",
    de: "fin_dossier_incomplet",
    vers: "fin_dossier_complet",
    autorises: ["systeme"],
    valides: REQUISES_COMPLETUDE,
    statutRefuse: "formation_debutee",
    courriers: [],
  },
  {
    action: "demander_paiement",
    de: "fin_dossier_complet",
    vers: "demande_paiement",
    autorises: ["admin"],
    statutRefuse: "fin_dossier_incomplet",
    courriers: [],
  },
  {
    action: "enregistrer_paiement",
    de: "demande_paiement",
    vers: "paiement_receptionne",
    autorises: ["admin"],
    statutRefuse: "fin_dossier_complet",
    courriers: [],
  },
  {
    action: "cloturer",
    de: "paiement_receptionne",
    vers: "archive",
    autorises: ["admin"],
    valides: [["10-FIN", null]],
    statutRefuse: "demande_paiement",
    gardeBloquante: { valides: [], message: /facture du formateur doit être déposée/i },
    courriers: [],
  },
];
const TOUS: Qui[] = ["admin", "formateur", "apprenant", "systeme"];

const ecritureSousStatut = (appels: ReturnType<typeof monter>["appels"]) =>
  appels.filter(
    (a) =>
      a.op === "update" &&
      a.table === "dossier_formation" &&
      JSON.stringify(a.valeurs ?? {}).includes("sous_statut"),
  );

let genererPieces: ReturnType<typeof vi.fn>;
let envoyerFormulaires: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("APP_URL", "https://app.exemple.fr");
  vi.spyOn(console, "error").mockImplementation(() => {});
  genererPieces = vi.fn(async (_bd: unknown, _d: unknown, codes: string[]) =>
    codes.map((code) => ({
      id: `gen-${code}`,
      code,
      stagiaire_id: null,
      chemin_depart: `of1/dossiers/ADF-2026-0001/Pièces de départ/${code}.html`,
    })),
  );
  envoyerFormulaires = vi.fn(async () => 1);
  brancherPortsLots({
    genererPieces: genererPieces as never,
    envoyerFormulaires: envoyerFormulaires as never,
  });
});
afterEach(() => {
  reinitialiserPortsLots();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function refus(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErreurMetier);
    return e as ErreurMetier;
  }
  throw new Error("Un refus était attendu");
}

describe.each(CAS)("transition « $action »", (c) => {
  for (const qui of c.autorises)
    it(`${qui} : ${c.de} → ${c.vers}, écrit le sous-statut une seule fois et journalise`, async () => {
      const s = monter(c.de, c.valides);
      const d = await executerTransition(s.bd as never, ACTEUR[qui], "d1", c.action, {
        motif: c.motif,
      });
      expect(d.sous_statut).toBe(c.vers);
      expect(s.tables["dossier_formation"]![0]).toMatchObject({
        sous_statut: c.vers,
        ...c.colonnes,
      });
      // Une seule écriture de sous-statut, conditionnée à l'ancien sous-statut.
      const ecrits = ecritureSousStatut(s.appels);
      expect(ecrits).toHaveLength(1);
      expect(ecrits[0]!.filtres).toContainEqual(["eq", "sous_statut", c.de]);
      expect(s.tables["evenement"]![0]).toEqual(
        expect.objectContaining({
          type: "transition",
          acteur_role: qui,
          dossier_id: "d1",
          detail: { action: c.action, de: c.de, vers: c.vers, motif: c.motif ?? null },
        }),
      );
      expect(s.courriers()).toEqual(c.courriers);
    });

  for (const qui of TOUS.filter((r) => !c.autorises.includes(r)))
    it(`refuse ${qui} (rôle) sans rien écrire`, async () => {
      const s = monter(c.de, c.valides);
      const e = await refus(
        executerTransition(s.bd as never, ACTEUR[qui], "d1", c.action, { motif: c.motif ?? "x" }),
      );
      expect(e.code).toBe("interdit");
      expect(e.message).toMatch(/ne relève pas de votre rôle/);
      expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
      expect(s.courriers()).toEqual([]);
      expect(genererPieces).not.toHaveBeenCalled();
    });

  it(`refuse hors de son étape (${c.statutRefuse})`, async () => {
    const s = monter(c.statutRefuse, c.valides);
    const acteur = c.autorises[0]!;
    const e = await refus(
      executerTransition(s.bd as never, ACTEUR[acteur], "d1", c.action, { motif: "m" }),
    );
    expect(e.code).toBe("invalide");
    expect(e.message).toMatch(/n'est pas possible à cette étape/);
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
  });

  if (c.gardeBloquante) {
    const garde = c.gardeBloquante;
    it("refuse tant que la garde du noyau n'est pas satisfaite", async () => {
      const s = monter(c.de, garde.valides);
      const e = await refus(
        executerTransition(s.bd as never, ACTEUR[c.autorises[0]!], "d1", c.action, {
          motif: c.motif ?? "m",
        }),
      );
      expect(e.code).toBe("invalide");
      expect(e.message).toMatch(garde.message);
      expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
      expect(s.courriers()).toEqual([]);
    });
  }

  if (c.motifRequis || c.motif)
    it("exige un motif écrit quand la règle le demande", async () => {
      const s = monter(c.de, c.valides);
      const requis = c.motifRequis === true || c.action === "enregistrer_refus";
      const essai = executerTransition(s.bd as never, ACTEUR[c.autorises[0]!], "d1", c.action, {
        motif: "   ",
      });
      if (c.motifRequis) {
        expect((await refus(essai)).message).toMatch(/motif écrit est obligatoire/);
        expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
      } else {
        // Le refus de financement garde son motif facultatif : seul le justificatif est exigé.
        expect(requis).toBe(true);
        await expect(essai).resolves.toMatchObject({ sous_statut: c.vers });
      }
    });
});

describe("effets des transitions", () => {
  it("valider_dossier : génère les 6 pièces de départ, marque planning et programme transmis, journalise, joint les pièces à l'e-mail de l'entreprise", async () => {
    const s = monter("en_cours_validation");
    genererPieces.mockImplementation(async (_b: unknown, _d: unknown, codes: string[]) =>
      codes.map((code) => ({
        id: `gen-${code}`,
        code,
        stagiaire_id: null,
        chemin_depart: `of1/dossiers/ADF-2026-0001/Pièces de départ/${code}.html`,
      })),
    );
    // Les pièces générées existent en base avec leur chemin au moment de l'e-mail.
    s.tables["piece_dossier"]!.push(
      ...["PRE", "02-AVT", "03-AVT", "PRG"].map((code) => ({
        dossier_id: "d1",
        code,
        stagiaire_id: null,
        statut: "en_attente",
        chemin_depart: `of1/dossiers/ADF-2026-0001/Pièces de départ/${code}.html`,
      })),
    );
    await executerTransition(s.bd as never, ACTEUR.admin, "d1", "valider_dossier");
    expect(genererPieces.mock.calls[0]![2]).toEqual([
      "00-AVT",
      "01-AVT",
      "PRE",
      "02-AVT",
      "03-AVT",
      "PRG",
    ]);
    const courrier = s.tables["courrier"]![0]!;
    expect(courrier).toMatchObject({
      type: "pieces_financement",
      destinataire: "durand@acme.fr",
      dossier_id: "d1",
    });
    expect((courrier["pieces_jointes"] as unknown[]).length).toBe(4);
    expect(s.tables["evenement"]!.map((e) => e["type"])).toEqual(["transition", "pieces_generees"]);
    expect(s.tables["dossier_formation"]![0]).toMatchObject({
      valide_le: expect.any(String),
      motif_renvoi: "",
    });
    const transmises = s.appels.filter((a) => a.table === "piece_dossier" && a.op === "update");
    expect(transmises).toHaveLength(1);
    expect(transmises[0]!.valeurs).toHaveProperty("transmise_le");
  });

  it("valider_dossier : refusé tant que la configuration de l'organisme est incomplète", async () => {
    const s = monter("en_cours_validation", [], { organisme: { of_siret: "", of_nda_numero: "" } });
    const e = await refus(executerTransition(s.bd as never, ACTEUR.admin, "d1", "valider_dossier"));
    expect(e.code).toBe("invalide");
    expect(e.details?.manques).toEqual(["SIRET", "Numéro de déclaration d'activité"]);
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
    expect(genererPieces).not.toHaveBeenCalled();
  });

  it("soumettre_validation : refusé tant que la saisie du dossier est incomplète (manques renvoyés)", async () => {
    const s = monter(
      "brouillon",
      [
        ["00-AVT", "s1"],
        ["01-AVT", "s1"],
      ],
      {
        dossier: { formation_programme: "", signature_lieu: "" },
      },
    );
    const e = await refus(
      executerTransition(s.bd as never, ACTEUR.formateur, "d1", "soumettre_validation"),
    );
    expect(e.code).toBe("invalide");
    expect(e.message).toBe("Le dossier est incomplet : il ne peut pas encore être soumis.");
    expect(e.details?.manques).toEqual([
      "Programme détaillé de la formation (annexe de la convention)",
      "Lieu de signature de la convention",
    ]);
    expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
  });

  it("soumettre_validation : un e-mail par administrateur actif de l'organisme, pas aux autres", async () => {
    const s = monter(
      "brouillon",
      [
        ["00-AVT", "s1"],
        ["01-AVT", "s1"],
      ],
      {
        tables: {
          utilisateur: [
            { email: "a1@of.fr", of_id: "of1", role: "admin", actif: true, supprime_le: null },
            { email: "a2@of.fr", of_id: "of1", role: "admin", actif: true, supprime_le: null },
            {
              email: "inactif@of.fr",
              of_id: "of1",
              role: "admin",
              actif: false,
              supprime_le: null,
            },
            { email: "autre@of2.fr", of_id: "of2", role: "admin", actif: true, supprime_le: null },
            {
              email: "fred@of.fr",
              of_id: "of1",
              role: "formateur",
              actif: true,
              supprime_le: null,
            },
          ],
        },
      },
    );
    await executerTransition(s.bd as never, ACTEUR.formateur, "d1", "soumettre_validation");
    expect(s.tables["courrier"]!.map((c) => c["destinataire"])).toEqual(["a1@of.fr", "a2@of.fr"]);
  });

  it("enregistrer_accord : génère l'ODM, le joint à l'e-mail du formateur, marque sa transmission, ouvre le coffre", async () => {
    const s = monter("dossier_depose", [["ACC", null]]);
    await executerTransition(s.bd as never, "systeme", "d1", "enregistrer_accord");
    expect(genererPieces.mock.calls[0]![2]).toEqual(["04-AVT"]);
    expect(s.tables["courrier"]![0]).toMatchObject({
      type: "odm",
      destinataire: "fred@of.fr",
      pieces_jointes: [
        { nom: "04-AVT.html", chemin: "of1/dossiers/ADF-2026-0001/Pièces de départ/04-AVT.html" },
      ],
    });
    expect(s.tables["evenement"]!.map((e) => e["type"])).toEqual(["transition", "coffre_ouvert"]);
    expect(s.tables["evenement"]![0]).toMatchObject({ acteur_role: "systeme", acteur_id: null });
  });

  it("enregistrer_refus : archive le dossier en lecture seule (archive_le), plus aucune transition ensuite", async () => {
    const s = monter("dossier_depose", [["REF", null]]);
    await executerTransition(s.bd as never, ACTEUR.formateur, "d1", "enregistrer_refus", {
      motif: "Non",
    });
    expect(s.tables["dossier_formation"]![0]).toMatchObject({
      sous_statut: "refus_financement",
      motif_refus: "Non",
      archive_le: expect.any(String),
    });
    const e = await refus(
      executerTransition(s.bd as never, ACTEUR.admin, "d1", "demarrer_formation"),
    );
    expect(e.code).toBe("invalide");
    expect(e.message).toBe("Ce dossier est archivé : il n'est plus modifiable.");
  });

  it("envoyer_elements_pedagogiques : convocations, e-mail à chaque apprenant avec une invitation d'inscription (pas de compte créé)", async () => {
    const s = monter("accord_financement");
    s.tables["piece_dossier"]!.push({
      dossier_id: "d1",
      code: "05-AVT",
      stagiaire_id: "s1",
      statut: "en_attente",
      chemin_depart: "of1/dossiers/ADF-2026-0001/Pièces de départ/05_AVT_Convocation.html",
    });
    await executerTransition(
      s.bd as never,
      ACTEUR.formateur,
      "d1",
      "envoyer_elements_pedagogiques",
    );
    expect(genererPieces.mock.calls[0]![2]).toEqual(["05-AVT"]);
    expect(s.tables["courrier"]![0]).toMatchObject({
      type: "elements_pedagogiques",
      destinataire: "anne@x.fr",
      pieces_jointes: [{ nom: "05_AVT_Convocation.html" }],
    });
    const invitations = s.tables["invitation"]!;
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      role: "apprenant",
      stagiaire_id: "s1",
      email: "anne@x.fr",
      of_id: "of1",
    });
    expect(s.tables["utilisateur"]!.some((u) => u["role"] === "apprenant")).toBe(false);
  });

  it("demarrer_formation : génère l'émargement et l'évaluation des acquis", async () => {
    const s = monter("envoi_elements_pedagogiques");
    await executerTransition(s.bd as never, ACTEUR.admin, "d1", "demarrer_formation");
    expect(genererPieces.mock.calls[0]![2]).toEqual(["06-PDT", "07-FIN"]);
  });

  it("terminer_formation : facture du formateur FF-2026-0001 (une seule fois), pièces de fin, formulaires de fin, termine_le", async () => {
    const s = monter("formation_debutee");
    await executerTransition(s.bd as never, ACTEUR.formateur, "d1", "terminer_formation", {
      maintenant: new Date("2026-10-05T10:00:00Z"),
    });
    expect(s.tables["facture_formateur"]).toEqual([
      expect.objectContaining({
        dossier_id: "d1",
        facture_formateur_numero: "FF-2026-0001",
        facture_formateur_date: "2026-10-05",
      }),
    ]);
    expect(s.tables["compteur"]).toEqual([expect.objectContaining({ cle: "FF-2026", valeur: 1 })]);
    expect(genererPieces.mock.calls[0]![2]).toEqual(["08-FIN", "09-FIN"]);
    expect(envoyerFormulaires.mock.calls[0]![2]).toEqual(["acquis", "satisfaction_chaud"]);
    expect(s.tables["dossier_formation"]![0]).toMatchObject({
      termine_le: "2026-10-05T10:00:00.000Z",
    });
  });

  it("demander_paiement : facture de l'OF FA-AAAA-NNNN numérotée sans trou ni doublon, ODM de facture marquée transmise", async () => {
    const s = monter("fin_dossier_complet", [], {
      tables: { compteur: [{ of_id: "of1", cle: "FA-2026", valeur: 6 }] },
    });
    await executerTransition(s.bd as never, ACTEUR.admin, "d1", "demander_paiement", {
      maintenant: new Date("2026-10-05T10:00:00Z"),
    });
    expect(s.tables["facture_of"]).toEqual([
      expect.objectContaining({
        dossier_id: "d1",
        facture_of_numero: "FA-2026-0007",
        facture_of_date: "2026-10-05",
      }),
    ]);
    expect(genererPieces.mock.calls[0]![2]).toEqual(["11-FIN"]);
    expect(
      s.appels.some(
        (a) =>
          a.table === "piece_dossier" &&
          a.op === "update" &&
          a.valeurs &&
          "transmise_le" in (a.valeurs as object),
      ),
    ).toBe(true);
  });

  it("une facture déjà créée n'est pas recréée ni renumérotée", async () => {
    const s = monter("fin_dossier_complet", [], {
      tables: { facture_of: [{ dossier_id: "d1", facture_of_numero: "FA-2026-0003" }] },
    });
    await executerTransition(s.bd as never, ACTEUR.admin, "d1", "demander_paiement");
    expect(s.tables["facture_of"]).toHaveLength(1);
    expect(s.tables["compteur"] ?? []).toHaveLength(0);
  });

  it("cloturer : archive_le posé", async () => {
    const s = monter("paiement_receptionne", [["10-FIN", null]]);
    await executerTransition(s.bd as never, ACTEUR.admin, "d1", "cloturer");
    expect(s.tables["dossier_formation"]![0]).toMatchObject({
      sous_statut: "archive",
      archive_le: expect.any(String),
    });
  });

  it("reevaluer_completude sans changement : aucun effet, aucun journal", async () => {
    const s = monter("fin_dossier_incomplet", []);
    const d = await executerTransition(s.bd as never, "systeme", "d1", "reevaluer_completude");
    expect(d.sous_statut).toBe("fin_dossier_incomplet");
    expect(s.tables["evenement"] ?? []).toHaveLength(0);
  });

  it("synchronise les pièces attendues au nouveau sous-statut (elles apparaissent dans le dossier)", async () => {
    const s = monter("en_cours_validation");
    await executerTransition(s.bd as never, ACTEUR.admin, "d1", "valider_dossier");
    const codes = s.tables["piece_dossier"]!.map((p) => p["code"]);
    for (const c of ["00-AVT", "01-AVT", "PRE", "02-AVT", "03-AVT", "PRG"])
      expect(codes).toContain(c);
    expect(codes).not.toContain("04-AVT");
    expect(codes).not.toContain("REF");
  });
});

describe("cloisonnement et concurrence", () => {
  it("un dossier d'un autre formateur, d'un autre organisme, ou d'un apprenant non inscrit est introuvable", async () => {
    const autre = { ...ACTEURS.formateurValide, formateur_id: "f9" } as unknown as Acteur;
    const autreOf = { ...ACTEURS.admin, of_id: "of2" } as unknown as Acteur;
    const nonInscrit = { ...ACTEURS.apprenant, stagiaire_id: "s9" } as unknown as Acteur;
    for (const a of [autre, autreOf, nonInscrit]) {
      const s = monter("en_cours_validation");
      const e = await refus(executerTransition(s.bd as never, a, "d1", "valider_dossier"));
      expect(e).toMatchObject({ code: "introuvable", message: "Dossier introuvable." });
      expect(ecritures(s.appels, "dossier_formation")).toHaveLength(0);
    }
  });

  it("un formateur ne peut pas valider son propre dossier ni toucher au paiement (audit du 01/09/2026)", async () => {
    for (const [statut, action] of [
      ["en_cours_validation", "valider_dossier"],
      ["fin_dossier_complet", "demander_paiement"],
      ["demande_paiement", "enregistrer_paiement"],
      ["paiement_receptionne", "cloturer"],
    ] as const) {
      const s = monter(statut, [["10-FIN", null]]);
      const e = await refus(executerTransition(s.bd as never, ACTEUR.formateur, "d1", action));
      expect(e.code).toBe("interdit");
      expect(ecritureSousStatut(s.appels)).toHaveLength(0);
    }
  });

  it("deux clics simultanés : le second voit un sous-statut déjà changé, n'écrit rien et n'exécute aucun effet", async () => {
    const s = monter("en_cours_validation", [], {
      avantEcriture: (a, tables) => {
        if (a.table === "dossier_formation" && a.op === "update")
          tables["dossier_formation"]![0]!["sous_statut"] = "dossier_valide";
      },
    });
    const e = await refus(executerTransition(s.bd as never, ACTEUR.admin, "d1", "valider_dossier"));
    expect(e).toMatchObject({
      code: "conflit",
      message: "Le dossier vient de changer d'état. Rechargez la page.",
    });
    expect(genererPieces).not.toHaveBeenCalled();
    expect(s.tables["courrier"] ?? []).toHaveLength(0);
    expect(s.tables["evenement"] ?? []).toHaveLength(0);
  });

  it("l'acteur « systeme » lit le dossier sans filtre d'organisme (tâche interne), l'utilisateur non", async () => {
    const s = monter("fin_dossier_incomplet", REQUISES_COMPLETUDE);
    await expect(
      executerTransition(s.bd as never, "systeme", "d1", "reevaluer_completude"),
    ).resolves.toMatchObject({
      sous_statut: "fin_dossier_complet",
    });
  });

  it("une panne de la base ne produit pas de succès silencieux", async () => {
    const s = monter("en_cours_validation", [], {
      imposer: (a) =>
        a.table === "dossier_formation" && a.op === "update"
          ? { error: { message: "boom" } }
          : undefined,
    });
    await expect(
      executerTransition(s.bd as never, ACTEUR.admin, "d1", "valider_dossier"),
    ).rejects.toThrow(/écriture du sous-statut/);
    expect(genererPieces).not.toHaveBeenCalled();
  });
});
