/**
 * BPF — lecture et export CSV. Équivalent serveur de `src/serveur/services/bpf.ts`.
 *
 * Le serveur lit les dossiers (client « service », filtrés par organisme et, pour un formateur, par fiche formateur
 * — l'apprenant est refusé) puis laisse le noyau calculer (`@/domaine/bpf`) : aucune règle n'est réécrite ici.
 * Seuls les dossiers qui ont atteint « fin de dossier incomplet » sont lus : ce sont les seuls que `agregerBpf` retient
 * (`estRealisee`), le résultat est donc le même qu'en chargeant tout, avec moins de lignes à rapatrier.
 */
import {
  agregerBpf,
  bpfEnCsv,
  exercicesDisponibles,
  type Bpf,
  type LigneRealise,
} from "@/domaine/bpf/agregation";
import {
  entrepriseDuNoyau,
  ligneRealisee,
  nomFormateurBpf,
  organismeDuNoyau,
  type DossierBpf,
  type SeanceBase,
} from "@/domaine/bpf/lignes";
import { aAtteint, SOUS_STATUTS } from "@/domaine/pipeline/statuts";
import type { Acteur } from "./acteur.server";
import type { BdService } from "./bd.server";
import { interdit, introuvable, leverSiErreurBd } from "./erreurs.server";
import { lireParLots, lireTout } from "./lecture.server";

type Ligne = Record<string, unknown>;

const STATUTS_REALISES = SOUS_STATUTS.map((s) => s.cle).filter((s) =>
  aAtteint(s, "fin_dossier_incomplet"),
);

const parId = <T extends { id: unknown }>(lignes: T[]): Map<string, T> =>
  new Map(lignes.map((l) => [String(l.id), l]));

/** L'admin voit le BPF de l'organisme ; un formateur, le sien seulement (F-BPF-01 : « relatives au formateur »). */
export async function chargerLignesRealisees(
  bd: BdService,
  acteur: Acteur,
): Promise<LigneRealise[]> {
  if (acteur.role === "apprenant") throw interdit();
  const filtre = acteur.role === "admin" ? null : (acteur.formateur_id ?? "");

  const dossiers = await lireTout<DossierBpf & { id: string }>((de, a) => {
    let q = bd
      .from("dossier_formation")
      .select("*")
      .eq("of_id", acteur.of_id)
      .in("sous_statut", STATUTS_REALISES);
    if (filtre !== null) q = q.eq("formateur_id", filtre);
    return q.order("id").range(de, a);
  }, "lecture des dossiers");
  if (dossiers.length === 0) return [];
  const idsDossiers = dossiers.map((d) => d.id);

  const { data: of, error: errOf } = await bd
    .from("organisme_formation")
    .select("*")
    .eq("id", acteur.of_id)
    .maybeSingle();
  leverSiErreurBd(errOf, "lecture de l'organisme");
  if (!of) throw introuvable("Organisme");

  const [formateurs, entreprises, liens, seances] = await Promise.all([
    lireTout<Ligne>(
      (de, a) =>
        bd.from("formateur").select("*").eq("of_id", acteur.of_id).order("id").range(de, a),
      "lecture des formateurs",
    ),
    lireParLots<Ligne>(
      dossiers.map((d) => String(d["entreprise_id"])),
      (lot, de, a) =>
        bd.from("entreprise_cliente").select("*").in("id", lot).order("id").range(de, a),
      "lecture des entreprises",
    ),
    lireParLots<Ligne>(
      idsDossiers,
      (lot, de, a) =>
        bd
          .from("stagiaire_dossier")
          .select("*")
          .in("dossier_id", lot)
          .order("dossier_id")
          .order("rang")
          .order("id")
          .range(de, a),
      "lecture des inscriptions",
    ),
    lireParLots<Ligne & SeanceBase>(
      idsDossiers,
      (lot, de, a) => bd.from("seance").select("*").in("dossier_id", lot).order("id").range(de, a),
      "lecture des séances",
    ),
  ]);
  const [stagiaires, emargements, feuilles] = await Promise.all([
    lireParLots<Ligne>(
      liens.map((l) => String(l["stagiaire_id"])),
      (lot, de, a) => bd.from("stagiaire").select("*").in("id", lot).order("id").range(de, a),
      "lecture des stagiaires",
    ),
    lireParLots<Ligne>(
      seances.map((s) => s.id),
      (lot, de, a) =>
        bd
          .from("emargement")
          .select("seance_id, stagiaire_id")
          .in("seance_id", lot)
          .eq("signataire", "stagiaire")
          .order("id")
          .range(de, a),
      "lecture des émargements",
    ),
    lireParLots<Ligne>(
      idsDossiers,
      (lot, de, a) =>
        bd
          .from("piece_dossier")
          .select("dossier_id, stagiaire_id, statut, mode_retour")
          .in("dossier_id", lot)
          .eq("code", "06-PDT")
          .order("id")
          .range(de, a),
      "lecture des feuilles d'émargement",
    ),
  ]);

  const formateurParId = parId(formateurs as Array<Ligne & { id: string }>);
  const entrepriseParId = parId(entreprises as Array<Ligne & { id: string }>);
  const stagiaireParId = parId(stagiaires as Array<Ligne & { id: string }>);
  const organisme = organismeDuNoyau(of as Ligne);

  return dossiers.map((d) => {
    const entreprise = entrepriseParId.get(String(d["entreprise_id"]));
    const formateur = formateurParId.get(d.formateur_id);
    if (!entreprise || !formateur) throw introuvable("Dossier");
    const seancesDuDossier = seances.filter((s) => s["dossier_id"] === d.id);
    const inscrits = liens
      .filter((l) => l["dossier_id"] === d.id)
      .flatMap((lien) => {
        const st = stagiaireParId.get(String(lien["stagiaire_id"]));
        return st ? [{ lien, st }] : [];
      });
    return ligneRealisee({
      dossier: d,
      organisme,
      entreprise: entrepriseDuNoyau(entreprise),
      formateur: formateur as never,
      formateur_nom: nomFormateurBpf(formateur as never),
      stagiaires: inscrits.map(({ lien, st }) => ({
        id: String(st["id"]),
        nom: `${st["stagiaire_prenom"]} ${st["stagiaire_nom"]}`.trim(),
        poste: String(lien["poste_occupe"] || st["stagiaire_poste"] || ""),
        email: String(st["stagiaire_email"] ?? ""),
        situation_handicap: String(st["stagiaire_situation_handicap"] ?? ""),
      })),
      seances: seancesDuDossier,
      emargements: emargements.filter((e) =>
        seancesDuDossier.some((s) => s.id === e["seance_id"]),
      ) as Array<{ seance_id: string; stagiaire_id: string }>,
      feuilles_sur_papier: feuilles
        .filter(
          (f) =>
            f["dossier_id"] === d.id &&
            f["statut"] === "valide" &&
            f["mode_retour"] === "depot" &&
            f["stagiaire_id"],
        )
        .map((f) => String(f["stagiaire_id"])),
    });
  });
}

export async function lireBpf(
  bd: BdService,
  acteur: Acteur,
  exercice?: number,
): Promise<{ exercices: number[]; bpf: Bpf }> {
  const lignes = await chargerLignesRealisees(bd, acteur);
  const exercices = exercicesDisponibles(lignes);
  const retenu = exercice ?? exercices[0] ?? new Date().getUTCFullYear();
  return { exercices, bpf: agregerBpf(lignes, retenu) };
}

export async function exporterBpfCsv(
  bd: BdService,
  acteur: Acteur,
  exercice: number,
): Promise<{ nom: string; contenu: string; type_mime: string }> {
  const { bpf } = await lireBpf(bd, acteur, exercice);
  return {
    nom: `BPF_${exercice}.csv`,
    contenu: bpfEnCsv(bpf),
    type_mime: "text/csv; charset=utf-8",
  };
}
