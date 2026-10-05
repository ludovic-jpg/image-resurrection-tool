/**
 * Lot 8 — BPF (routes 115 et 116 de la carte).
 *
 * Fonction serveur (`src/lib/bpf.functions.ts`) : le calcul parcourt tous les dossiers de l'organisme. Le rôle est
 * contrôlé par le serveur (apprenant : 403 en français). Forme de réponse : celle de `lireBpf` de l'ancien service.
 *
 * L'export CSV n'est plus un fichier servi par une adresse (`<a href="/api/bpf/export">` ne porte pas le jeton de
 * session) : la route renvoie `{ nom, contenu, type_mime }` et `lot-8-telechargements.ts` remet le fichier au navigateur.
 */
import { exporterBpfCsv, lireBpf } from "@/lib/bpf.functions";
import type { VueBpf } from "../api";
import { appelerServeur } from "../appel-serveur";
import { ErreurApi } from "../erreur";
import { route } from "../registre";

/** `?exercice=AAAA` : absent → `undefined` ; présent mais illisible → 400. */
function exerciceDe(requete: URLSearchParams, obligatoire: boolean): number | undefined {
  const brut = requete.get("exercice");
  if (brut === null || brut === "") {
    if (obligatoire) throw new ErreurApi("Précisez l'exercice (AAAA).", 400, "invalide", null);
    return undefined;
  }
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 1900 || n > 2200)
    throw new ErreurApi("Exercice invalide.", 400, "invalide", null);
  return n;
}

// 115 — GET /bpf[?exercice=AAAA]
route("GET", "/bpf", async ({ requete }) => {
  const exercice = exerciceDe(requete, false);
  return (await appelerServeur(() => lireBpf({ data: { exercice } }))) as unknown as VueBpf;
});

// 116 — GET /bpf/export?exercice=AAAA
route("GET", "/bpf/export", async ({ requete }) => {
  const exercice = exerciceDe(requete, true) as number;
  return appelerServeur(() => exporterBpfCsv({ data: { exercice } }));
});
