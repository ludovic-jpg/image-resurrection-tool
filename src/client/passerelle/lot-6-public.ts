/**
 * Lot 6 — page publique de positionnement, SANS compte (routes 10 à 12 de la carte). Le lien personnel de l'apprenant
 * est son seul justificatif : le serveur le hache (SHA-256) et retrouve la ligne ; aucune session, aucun JWT.
 *
 *   10  GET /public/positionnement/:jeton            lecture, SANS corrigé du test
 *   11  PUT /public/positionnement/:jeton/brouillon  « enregistrer et reprendre plus tard »
 *   12  POST /public/positionnement/:jeton/signer    contrôle, score, document scellé, archive, journal (IP), 2 e-mails
 *
 * Route 13 (GET …/pdf) : le lien `<a href="/api/public/positionnement/:jeton/pdf">` de l'écran est servi par la route
 * serveur `src/routes/api.public.positionnement.$jeton.pdf.ts` (un lien ne passe pas par ce routeur).
 *
 * Seuls les champs attendus sont transmis au serveur ; rien d'autre du corps n'est repris.
 */
import {
  enregistrerBrouillonPublic,
  lirePositionnementPublic,
  signerPositionnementPublic,
} from "@/lib/public-positionnement.functions";
import { appelerServeur, corpsDe } from "../appel-serveur";
import { route } from "../registre";
import type { PositionnementPublic } from "../api";

const retenir = (c: Record<string, unknown>, cles: readonly string[]) =>
  Object.fromEntries(cles.filter((k) => k in c).map((k) => [k, c[k]]));

route("GET", "/public/positionnement/:jeton", async ({ params }) => {
  const r: PositionnementPublic = await appelerServeur(() =>
    lirePositionnementPublic({ data: { jeton: params["jeton"] ?? "" } }),
  );
  return r;
});

route("PUT", "/public/positionnement/:jeton/brouillon", ({ params, corps }) =>
  appelerServeur(() =>
    enregistrerBrouillonPublic({
      data: {
        jeton: params["jeton"] ?? "",
        reponses: retenir(corpsDe(corps), ["recueil", "reponses", "date"]),
      },
    }),
  ),
);

route("POST", "/public/positionnement/:jeton/signer", ({ params, corps }) =>
  appelerServeur(() =>
    signerPositionnementPublic({
      data: {
        jeton: params["jeton"] ?? "",
        reponses: retenir(corpsDe(corps), [
          "recueil",
          "reponses",
          "date",
          "trace_png",
          "lieu",
          "consentement",
        ]),
      },
    }),
  ),
);
