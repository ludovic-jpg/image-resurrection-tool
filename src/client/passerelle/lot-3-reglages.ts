/**
 * Lot 3 — réglages de l'organisme (routes 30, 31 et 32 de la carte).
 *
 *  30  GET   /admin/reglages               Client + RLS : lecture de la vue `reglage_vue` (aucun secret, seulement des
 *                                          indicateurs « défini ») + constantes du noyau (modèles d'IA, préréglages).
 *  31  PATCH /admin/reglages               fonction serveur `enregistrerReglages` (chiffrement des secrets, journal).
 *  32  POST  /admin/reglages/test-courriel fonction serveur `envoyerCourrielTest`.
 */
import { MODELES_IA, PREREGLAGES_SMTP } from "@/domaine/reglages/catalogue";
import { enregistrerReglages, etatConfiguration } from "@/lib/reglages.functions";
import { envoyerCourrielTest } from "@/lib/courriels-envoyer.functions";
import { appelerServeur, corpsDe, exigerActeur, introuvable } from "../appel-serveur";
import { bd } from "../bd";
import { route } from "../registre";
import type { Reglages, ResultatTestCourriel } from "../api";

const MESSAGE_ADMIN = "Cette action est réservée à l'administrateur de l'organisme.";

async function lireReglages(): Promise<Reglages> {
  await exigerActeur(["admin"], MESSAGE_ADMIN);
  const { data, error } = await bd.from("reglage_vue").select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw introuvable("Réglages");
  const { of_id: _ofId, ...visibles } = data as Record<string, unknown>;
  // Information de configuration du serveur : si elle est indisponible, on affiche « non » plutôt que d'échouer.
  let iaDefautServeur = false;
  try {
    const etat = await etatConfiguration();
    if (etat.ok) iaDefautServeur = etat.donnees.ia_defaut_serveur;
  } catch {
    /* sans importance pour l'affichage */
  }
  return {
    ...visibles,
    ia_defaut_serveur: iaDefautServeur,
    modeles: MODELES_IA,
    prereglages: PREREGLAGES_SMTP,
  } as unknown as Reglages;
}

route("GET", "/admin/reglages", () => lireReglages());

route("PATCH", "/admin/reglages", async ({ corps }) => {
  await appelerServeur(() => enregistrerReglages({ data: corpsDe(corps) }));
  return lireReglages();
});

route(
  "POST",
  "/admin/reglages/test-courriel",
  async () =>
    (await appelerServeur(() => envoyerCourrielTest())) as unknown as ResultatTestCourriel,
);
