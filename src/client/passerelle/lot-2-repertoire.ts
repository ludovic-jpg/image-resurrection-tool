/**
 * Lot 2 — répertoires : entreprises clientes et fiches apprenant (routes 71 à 78).
 *
 * Tout passe sous RLS : le formateur validé lit et écrit SES fiches, l'admin lit celles de l'organisme. Un formateur
 * ne voit jamais les fiches d'un autre ; une fiche qui n'est pas la sienne est « introuvable » (404), jamais
 * « interdite ». `utilisateur_id` d'un apprenant n'est jamais écrit ici : le compte se relie à l'inscription.
 * Archiver retire une fiche des listes sans rien effacer ; elle se restaure.
 */
import type { Entreprise, Stagiaire } from "../api";
import { bd } from "../bd";
import { route } from "../registre";
import {
  acteurCourant,
  corpsObjet,
  exiger,
  exigerFormateurValide,
  lire,
  maintenant,
  valider,
  validerPartiel,
} from "./lot-2-commun";
import { SchemaEntreprise, SchemaStagiaireAvecEntreprise } from "./lot-2-schemas";

type Fiche = "entreprise_cliente" | "stagiaire";

async function lister<T>(table: Fiche, archives: boolean, tri: string[]): Promise<T[]> {
  const requete = bd.from(table).select("*");
  let filtree = archives ? requete.not("archive_le", "is", null) : requete.is("archive_le", null);
  for (const colonne of tri) filtree = filtree.order(colonne, { ascending: true });
  return (lire(await filtree) ?? []) as T[];
}

async function exigerEntreprise(id: string): Promise<void> {
  exiger(await bd.from("entreprise_cliente").select("id").eq("id", id).maybeSingle(), "Entreprise");
}

async function archiver(table: Fiche, quoi: string, id: string, archiver: boolean) {
  const r = await bd
    .from(table)
    .update({ archive_le: archiver ? maintenant() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  exiger(r, quoi);
  return { ok: true };
}

async function creerEntreprise(
  of_id: string,
  formateur_id: string,
  valeurs: ReturnType<typeof SchemaEntreprise.parse>,
): Promise<Entreprise> {
  const r = await bd
    .from("entreprise_cliente")
    .insert({ ...valeurs, of_id, formateur_id })
    .select()
    .single();
  return exiger(r, "Entreprise") as Entreprise;
}

// 71 — GET /entreprises[?archives=1]
route("GET", "/entreprises", async ({ requete }) => {
  exigerFormateurValide(await acteurCourant());
  return lister<Entreprise>("entreprise_cliente", requete.get("archives") === "1", [
    "entreprise_nom",
  ]);
});

// 72 — POST /entreprises/:id/archiver { archiver?: boolean }
route("POST", "/entreprises/:id/archiver", async ({ params, corps }) => {
  const donnees = corpsObjet(corps);
  exigerFormateurValide(await acteurCourant());
  return archiver(
    "entreprise_cliente",
    "Entreprise",
    params["id"] ?? "",
    donnees["archiver"] !== false,
  );
});

// 73 — POST /stagiaires/:id/archiver { archiver?: boolean }
route("POST", "/stagiaires/:id/archiver", async ({ params, corps }) => {
  const donnees = corpsObjet(corps);
  exigerFormateurValide(await acteurCourant());
  return archiver(
    "stagiaire",
    "Fiche apprenant",
    params["id"] ?? "",
    donnees["archiver"] !== false,
  );
});

// 74 — POST /entreprises
route("POST", "/entreprises", async ({ corps }) => {
  const donnees = corpsObjet(corps);
  const acteur = await acteurCourant();
  const formateurId = exigerFormateurValide(acteur);
  const valeurs = valider(() => SchemaEntreprise.parse(donnees));
  return creerEntreprise(acteur.of_id, formateurId, valeurs);
});

// 75 — PATCH /entreprises/:id
route("PATCH", "/entreprises/:id", async ({ params, corps }) => {
  const donnees = corpsObjet(corps);
  exigerFormateurValide(await acteurCourant());
  const id = params["id"] ?? "";
  const valeurs = validerPartiel(SchemaEntreprise, donnees);
  const requete =
    Object.keys(valeurs).length > 0
      ? bd.from("entreprise_cliente").update(valeurs).eq("id", id).select()
      : bd.from("entreprise_cliente").select("*").eq("id", id);
  return exiger(await requete.maybeSingle(), "Entreprise") as Entreprise;
});

// 76 — GET /stagiaires[?archives=1]
route("GET", "/stagiaires", async ({ requete }) => {
  exigerFormateurValide(await acteurCourant());
  return lister<Stagiaire>("stagiaire", requete.get("archives") === "1", [
    "stagiaire_nom",
    "stagiaire_prenom",
  ]);
});

// 77 — POST /stagiaires (« nouvelle entreprise dans le même geste » : deux insertions enchaînées)
route("POST", "/stagiaires", async ({ corps }) => {
  const donnees = corpsObjet(corps);
  const acteur = await acteurCourant();
  const formateurId = exigerFormateurValide(acteur);
  const { nouvelle_entreprise, ...valeurs } = valider(() =>
    SchemaStagiaireAvecEntreprise.parse(donnees),
  );
  let entrepriseCreee: string | null = null;
  if (nouvelle_entreprise) {
    entrepriseCreee = (await creerEntreprise(acteur.of_id, formateurId, nouvelle_entreprise)).id;
    valeurs.entreprise_id = entrepriseCreee;
  } else if (valeurs.entreprise_id) await exigerEntreprise(valeurs.entreprise_id);
  const cree = await bd
    .from("stagiaire")
    .insert({ ...valeurs, of_id: acteur.of_id, formateur_id: formateurId })
    .select()
    .single();
  if (cree.error && entrepriseCreee) {
    // Pas de fiche entreprise orpheline dans les listes : on archive celle qu'on vient de créer.
    await bd
      .from("entreprise_cliente")
      .update({ archive_le: maintenant() })
      .eq("id", entrepriseCreee);
  }
  return exiger(cree, "Fiche apprenant") as Stagiaire;
});

// 78 — PATCH /stagiaires/:id
route("PATCH", "/stagiaires/:id", async ({ params, corps }) => {
  const donnees = corpsObjet(corps);
  const acteur = await acteurCourant();
  const formateurId = exigerFormateurValide(acteur);
  const id = params["id"] ?? "";
  const { nouvelle_entreprise, ...valeurs } = validerPartiel(
    SchemaStagiaireAvecEntreprise,
    donnees,
  );
  if (nouvelle_entreprise) {
    valeurs.entreprise_id = (
      await creerEntreprise(acteur.of_id, formateurId, nouvelle_entreprise)
    ).id;
  } else if (valeurs.entreprise_id) await exigerEntreprise(valeurs.entreprise_id);
  const requete =
    Object.keys(valeurs).length > 0
      ? bd.from("stagiaire").update(valeurs).eq("id", id).select()
      : bd.from("stagiaire").select("*").eq("id", id);
  return exiger(await requete.maybeSingle(), "Fiche apprenant") as Stagiaire;
});
