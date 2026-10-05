/**
 * Coffre-fort pédagogique PAR PARCOURS — « Modification 1 » du 23/09/2026 :
 * « un onglet coffre-fort pédagogique classé par parcours de formation, avec l'ensemble des pièces ; il se remplit par
 * défaut des supports et tests associés au parcours ; le formateur peut y ajouter des supports ; c'est une page dédiée,
 * avec tous les documents en téléchargement mais aussi en chargement ; elle est interactive selon les pièces déposées
 * sur le plan administratif, et donne toujours accès à la partie pédagogique ».
 *
 * La page réunit, pour un parcours :
 *  - PÉDAGOGIQUE : fichiers du coffre par rubrique (dont les supports PPTX générés), questionnaires rattachés,
 *    programme (document produit à la volée) ;
 *  - ADMINISTRATIF : documents administratifs et qualité déposés, positionnements signés, et, pour chaque dossier
 *    ouvert sur ce parcours, l'état de ses pièces (déposée, validée, en attente) avec leur téléchargement.
 * Lecture : le formateur propriétaire et l'organisme. Écriture : le formateur.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import JSZip from "jszip";
import { CATEGORIES_COFFRE } from "@/domaine/pedagogie/listes";
import type { ModuleParcours } from "@/domaine/pedagogie/parcours";
import { libelleSousStatut, type SousStatut } from "@/domaine/pipeline/statuts";
import { definitionPiece, estCodePiece } from "@/domaine/referentiel/pieces";
import { coffreFichier, dossierFormation, entrepriseCliente, formateur, formation, modeleOutil, pieceDossier, positionnement, stagiaire, stagiaireDossier } from "../bd/schema";
import { nomSur } from "../ports/archive";
import { formationAccessible, listerCoffre } from "./formations";
import { lireOrganisme } from "./organisme";
import { positionnementsDuParcours } from "./positionnements";
import { documentOutil, documentProgramme } from "./supports";
import { exigerFormateurValide, interdit, introuvable, type Acteur, type Services } from "./socle";

/** Liste des parcours et de leur coffre (compteurs), pour l'onglet « Coffre-fort pédagogique ». */
export async function listerCoffresParcours(s: Services, acteur: Acteur) {
  if (acteur.role === "apprenant") throw interdit();
  const conditions = [eq(formation.of_id, acteur.of_id), eq(formation.archivee, false)];
  if (acteur.role === "formateur") conditions.push(eq(formation.formateur_id, exigerFormateurValide(acteur)));
  const formations = await s.bd
    .select({ f: formation, form: formateur })
    .from(formation)
    .innerJoin(formateur, eq(formateur.id, formation.formateur_id))
    .where(and(...conditions))
    .orderBy(asc(formation.formation_titre));
  if (formations.length === 0) return [];
  const ids = formations.map((x) => x.f.id);
  const fichiers = await s.bd.select({ formation_id: coffreFichier.formation_id, categorie: coffreFichier.categorie }).from(coffreFichier).where(and(inArray(coffreFichier.formation_id, ids), isNull(coffreFichier.supprime_le)));
  const outils = await s.bd.select({ formation_id: modeleOutil.formation_id }).from(modeleOutil).where(and(inArray(modeleOutil.formation_id, ids), isNull(modeleOutil.archive_le)));
  const dossiers = await s.bd.select({ formation_id: dossierFormation.formation_id }).from(dossierFormation).where(inArray(dossierFormation.formation_id, ids));
  const positions = await s.bd.select({ formation_id: positionnement.formation_id, statut: positionnement.statut }).from(positionnement).where(and(inArray(positionnement.formation_id, ids), isNull(positionnement.archive_le)));
  const administratif = new Set<string>(CATEGORIES_COFFRE.filter((c) => c.partie === "administratif").map((c) => c.valeur));
  return formations.map(({ f, form }) => ({
    id: f.id,
    formation_titre: f.formation_titre,
    formateur: `${form.formateur_prenom} ${form.formateur_nom}`,
    modules: (f.formation_modules as unknown[]).length,
    heures: f.formation_duree_heures_total,
    pedagogique: fichiers.filter((x) => x.formation_id === f.id && !administratif.has(x.categorie)).length + outils.filter((x) => x.formation_id === f.id).length + 1,
    administratif: fichiers.filter((x) => x.formation_id === f.id && administratif.has(x.categorie)).length,
    dossiers: dossiers.filter((x) => x.formation_id === f.id).length,
    positionnements_signes: positions.filter((x) => x.formation_id === f.id && x.statut === "complet").length,
    positionnements_attente: positions.filter((x) => x.formation_id === f.id && x.statut !== "complet").length,
  }));
}

/** Tout le contenu du coffre d'un parcours. */
export async function lireCoffreParcours(s: Services, acteur: Acteur, formationId: string) {
  if (acteur.role === "apprenant") throw interdit();
  const f = await formationAccessible(s, acteur, formationId);
  const fichiers = await listerCoffre(s, acteur, formationId);
  const corbeille = acteur.role === "formateur" ? await listerCoffre(s, acteur, formationId, { corbeille: true }) : [];
  const outils = await s.bd.select().from(modeleOutil).where(and(eq(modeleOutil.formation_id, formationId), isNull(modeleOutil.archive_le))).orderBy(asc(modeleOutil.type));

  // Dossiers ouverts sur ce parcours, et l'état de leurs pièces : la partie « administrative » interactive.
  const dossiers = await s.bd
    .select({ d: dossierFormation, ent: entrepriseCliente })
    .from(dossierFormation)
    .innerJoin(entrepriseCliente, eq(entrepriseCliente.id, dossierFormation.entreprise_id))
    .where(eq(dossierFormation.formation_id, formationId))
    .orderBy(desc(dossierFormation.cree_le));
  const idsDossiers = dossiers.map((x) => x.d.id);
  const pieces = idsDossiers.length ? await s.bd.select().from(pieceDossier).where(inArray(pieceDossier.dossier_id, idsDossiers)) : [];
  const inscrits = idsDossiers.length
    ? await s.bd.select({ dossier_id: stagiaireDossier.dossier_id, st: stagiaire }).from(stagiaireDossier).innerJoin(stagiaire, eq(stagiaire.id, stagiaireDossier.stagiaire_id)).where(inArray(stagiaireDossier.dossier_id, idsDossiers))
    : [];
  const nomStagiaire = (id: string | null) => {
    const st = inscrits.find((x) => x.st.id === id)?.st;
    return st ? `${st.stagiaire_prenom} ${st.stagiaire_nom}` : "";
  };

  return {
    formation: {
      id: f.id,
      formation_titre: f.formation_titre,
      formation_duree_heures_total: f.formation_duree_heures_total,
      formation_niveau: f.formation_niveau,
      modules: (f.formation_modules as ModuleParcours[]).map((m, i) => ({ rang: i + 1, titre: m.titre, duree_heures: m.duree_heures })),
      proprietaire: acteur.role === "formateur",
    },
    fichiers: fichiers.map((x) => ({ id: x.id, nom_fichier: x.nom_fichier, taille: x.taille, categorie: x.categorie, description: x.description, origine: x.origine, partageable: x.partageable, cree_le: x.cree_le })),
    corbeille: corbeille.map((x) => ({ id: x.id, nom_fichier: x.nom_fichier, taille: x.taille, categorie: x.categorie, supprime_le: x.supprime_le })),
    outils: outils.map((o) => ({ id: o.id, type: o.type, titre: o.titre, questions: ((o.contenu as { questions?: unknown[]; questions_supplementaires?: unknown[] }).questions ?? (o.contenu as { questions_supplementaires?: unknown[] }).questions_supplementaires ?? []).length, maj_le: o.maj_le })),
    positionnements: await positionnementsDuParcours(s, acteur, formationId),
    dossiers: dossiers.map(({ d, ent }) => {
      const sesPieces = pieces.filter((p) => p.dossier_id === d.id && estCodePiece(p.code));
      const deposees = sesPieces.filter((p) => p.chemin_depart || p.chemin_retour);
      return {
        id: d.id,
        reference: d.dossier_reference,
        entreprise: ent.entreprise_nom,
        statut: libelleSousStatut(d.sous_statut as SousStatut),
        stagiaires: inscrits.filter((x) => x.dossier_id === d.id).map((x) => `${x.st.stagiaire_prenom} ${x.st.stagiaire_nom}`),
        dates: d.formation_date_debut ? `${d.formation_date_debut} → ${d.formation_date_fin}` : "",
        progression: { validees: sesPieces.filter((p) => p.statut === "valide").length, total: sesPieces.length, disponibles: deposees.length },
        pieces: sesPieces
          .map((p) => {
            const def = definitionPiece(p.code as Parameters<typeof definitionPiece>[0]);
            return { id: p.id, code: p.code, ordre: def.ordre, libelle: def.libelle, stagiaire: nomStagiaire(p.stagiaire_id), statut: p.statut, depart: Boolean(p.chemin_depart), retour: Boolean(p.chemin_retour), suivi: def.suiviStatut };
          })
          .sort((a, b) => a.code.localeCompare(b.code)),
      };
    }),
  };
}

async function organismeDe(s: Services, of_id: string) {
  const of = await lireOrganisme(s, of_id);
  return { nom: of.of_nom || "Organisme de formation", couleur: of.couleur };
}

/** Programme du parcours, en PDF si possible (sinon HTML imprimable). */
export async function documentProgrammeParcours(s: Services, acteur: Acteur, formationId: string) {
  const f = await formationAccessible(s, acteur, formationId);
  const html = documentProgramme(f, await organismeDe(s, acteur.of_id));
  const pdf = await s.pdf.convertir(html);
  const base = `Programme - ${nomSur(f.formation_titre).slice(0, 100)}`;
  return pdf ? { nom: `${base}.pdf`, contenu: pdf, type_mime: "application/pdf" } : { nom: `${base}.html`, contenu: Buffer.from(html), type_mime: "text/html; charset=utf-8" };
}

/** Questionnaire imprimable. Le corrigé n'est proposé qu'au formateur et à l'organisme. */
export async function documentOutilParcours(s: Services, acteur: Acteur, outilId: string, avecCorrige: boolean) {
  if (acteur.role === "apprenant") throw interdit();
  const [o] = await s.bd.select().from(modeleOutil).where(and(eq(modeleOutil.id, outilId), eq(modeleOutil.of_id, acteur.of_id)));
  if (!o || (acteur.role === "formateur" && o.formateur_id !== acteur.formateur_id)) throw introuvable("Questionnaire");
  const [f] = o.formation_id ? await s.bd.select().from(formation).where(eq(formation.id, o.formation_id)) : [];
  const html = documentOutil(o, await organismeDe(s, acteur.of_id), f?.formation_titre ?? null, avecCorrige);
  const pdf = await s.pdf.convertir(html);
  const base = `${nomSur(o.titre).slice(0, 100)}${avecCorrige ? " - corrige" : ""}`;
  return pdf ? { nom: `${base}.pdf`, contenu: pdf, type_mime: "application/pdf" } : { nom: `${base}.html`, contenu: Buffer.from(html), type_mime: "text/html; charset=utf-8" };
}

/** Tout le coffre d'un parcours en une archive ZIP, rangée par rubrique (sauvegarde, envoi à un auditeur). */
export async function exporterCoffreZip(s: Services, acteur: Acteur, formationId: string) {
  const f = await formationAccessible(s, acteur, formationId);
  const zip = new JSZip();
  const of = await organismeDe(s, acteur.of_id);
  zip.file("00 - Programme.html", documentProgramme(f, of));
  for (const x of await listerCoffre(s, acteur, formationId)) {
    const rubrique = CATEGORIES_COFFRE.find((c) => c.valeur === x.categorie)?.libelle ?? "Divers";
    try {
      zip.file(`${nomSur(rubrique)}/${nomSur(x.nom_fichier)}`, await s.archive.lire(x.chemin));
    } catch {
      zip.file(`${nomSur(rubrique)}/MANQUANT - ${nomSur(x.nom_fichier)}.txt`, "Fichier introuvable dans l'archive.");
    }
  }
  const outils = await s.bd.select().from(modeleOutil).where(and(eq(modeleOutil.formation_id, formationId), isNull(modeleOutil.archive_le)));
  for (const o of outils) zip.file(`Questionnaires/${nomSur(o.titre)}.html`, documentOutil(o, of, f.formation_titre));
  const positions = await s.bd.select().from(positionnement).where(and(eq(positionnement.formation_id, formationId), eq(positionnement.statut, "complet")));
  for (const p of positions) {
    if (!p.chemin_pdf) continue;
    try {
      zip.file(`Positionnements signés/${p.chemin_pdf.split("/").pop()!}`, await s.archive.lire(p.chemin_pdf));
    } catch {
      /* fichier absent : ignoré */
    }
  }
  const contenu = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { nom: `Coffre-fort - ${nomSur(f.formation_titre).slice(0, 80)}.zip`, contenu, type_mime: "application/zip" };
}
