/** Module 8 — Page BPF (F-BPF-01, F-BPF-02). Le calcul est dans le noyau ; ce service rassemble les lignes. */
import { eq, inArray } from "drizzle-orm";
import { agregerBpf, bpfEnCsv, exercicesDisponibles, type LigneRealise } from "@/domaine/bpf/agregation";
import { calculer } from "@/domaine/dossier/calculs";
import { dureeSeanceHeures } from "@/domaine/dossier/formats";
import type { SousStatut } from "@/domaine/pipeline/statuts";
import { dossierFormation, formateur, seance } from "../bd/schema";
import { chargerAgregat } from "./agregat";
import { interdit, type Acteur, type Services } from "./socle";

/** L'admin voit le BPF de l'organisme ; un formateur, le sien seulement (F-BPF-01 : « relatives au formateur »). */
async function lignesRealisees(s: Services, acteur: Acteur): Promise<LigneRealise[]> {
  if (acteur.role === "apprenant") throw interdit();
  const dossiers =
    acteur.role === "admin"
      ? await s.bd.select().from(dossierFormation).where(eq(dossierFormation.of_id, acteur.of_id))
      : await s.bd.select().from(dossierFormation).where(eq(dossierFormation.formateur_id, acteur.formateur_id ?? ""));
  if (dossiers.length === 0) return [];
  const formateurs = await s.bd.select().from(formateur).where(eq(formateur.of_id, acteur.of_id));
  const seances = await s.bd.select().from(seance).where(inArray(seance.dossier_id, dossiers.map((d) => d.id)));

  const lignes: LigneRealise[] = [];
  for (const d of dossiers) {
    const agregat = await chargerAgregat(s, d);
    const c = calculer(agregat);
    const f = formateurs.find((x) => x.id === d.formateur_id);
    const planifiees = seances.filter((se) => se.dossier_id === d.id).reduce((t, se) => t + dureeSeanceHeures(se.heure_debut, se.heure_fin), 0);
    lignes.push({
      dossier_reference: d.dossier_reference,
      sous_statut: d.sous_statut as SousStatut,
      formation_titre: d.formation_titre,
      formation_date_debut: d.formation_date_debut,
      formation_date_fin: d.formation_date_fin,
      mode_financement: d.mode_financement,
      formateur_id: d.formateur_id,
      formateur_nom: f ? `${f.formateur_nom} ${f.formateur_prenom}`.trim() : "Formateur",
      nb_stagiaires: agregat.stagiaires.length,
      heures_stagiaires: Math.round(Object.values(agregat.heures_realisees ?? {}).reduce((a, h) => a + h, 0) * 100) / 100,
      heures_dispensees: planifiees || (d.formation_duree_heures_total ?? 0),
      montant_ht: c.formation_prix_total_ht ?? 0,
      montant_sous_traite: c.formateur_montant_total ?? 0,
    });
  }
  return lignes;
}

export async function lireBpf(s: Services, acteur: Acteur, exercice?: number) {
  const lignes = await lignesRealisees(s, acteur);
  const exercices = exercicesDisponibles(lignes);
  const retenu = exercice ?? exercices[0] ?? s.horloge.maintenant().getUTCFullYear();
  return { exercices, bpf: agregerBpf(lignes, retenu) };
}

export async function exporterBpfCsv(s: Services, acteur: Acteur, exercice: number): Promise<{ nom: string; contenu: string }> {
  const { bpf } = await lireBpf(s, acteur, exercice);
  return { nom: `BPF_${exercice}.csv`, contenu: bpfEnCsv(bpf) };
}
