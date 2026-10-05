/**
 * Lot 3 — boîte d'envoi (routes 33 et 34 de la carte).
 *
 *  33  GET  /courriers              Client + RLS : politique `courrier_select` (administrateur : tout l'organisme ;
 *                                   formateur validé : ses courriers et ceux de ses dossiers). Pas d'écriture client.
 *  34  POST /courriers/:id/renvoyer fonction serveur `renvoyerCourrier` (relit les pièces jointes dans l'archive).
 */
import { renvoyerCourrier } from "@/lib/courriels-envoyer.functions";
import { appelerServeur, exigerActeur } from "../appel-serveur";
import { bd } from "../bd";
import { route } from "../registre";
import type { Courrier } from "../api";

route("GET", "/courriers", async () => {
  await exigerActeur(["admin", "formateur"], "Réservé au formateur et à l'organisme.");
  const { data, error } = await bd
    .from("courrier")
    .select("*")
    .order("cree_le", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as Courrier[];
});

route("POST", "/courriers/:id/renvoyer", async ({ params }) => {
  const r = await appelerServeur(() =>
    renvoyerCourrier({ data: { courrier_id: params["id"] ?? "" } }),
  );
  // Forme de l'ancien serveur : { id, statut, erreur } (`info` précise pourquoi rien n'est parti, le cas échéant).
  return r;
});
