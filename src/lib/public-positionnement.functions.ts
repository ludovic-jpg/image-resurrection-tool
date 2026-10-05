/**
 * Fonctions serveur PUBLIQUES du positionnement (lot 6) — « Edge Function `public-positionnement` », routes 10 à 12.
 *
 * Aucun middleware d'authentification : l'apprenant n'a pas de compte, son lien personnel est son seul justificatif
 * (jeton haché SHA-256, voir `./serveur/positionnement-public.server`). Le client « service » est chargé DANS le
 * gestionnaire. La route 13 (document signé) est la route serveur `src/routes/api.public.positionnement.$jeton.pdf.ts`,
 * car l'écran l'ouvre par un simple lien.
 *
 * Un jeton invalide, échu ou déjà utilisé donne une erreur claire (résultat typé) qui ne révèle rien d'autre.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { clientService } from "./serveur/bd.server";
import { executer } from "./serveur/erreurs.server";
import {
  adresseIpDeLaRequete,
  enregistrerBrouillon,
  lirePublic,
  signer,
} from "./serveur/positionnement-public.server";

const Jeton = z.string().max(200);
// Le contenu des réponses est contrôlé par le domaine (messages français) : ici, seulement « c'est un objet ».
const Corps = z.record(z.string(), z.unknown());

export const lirePositionnementPublic = createServerFn({ method: "POST" })
  .validator(z.object({ jeton: Jeton }))
  .handler(({ data }) => executer(async () => lirePublic(await clientService(), data.jeton)));

export const enregistrerBrouillonPublic = createServerFn({ method: "POST" })
  .validator(z.object({ jeton: Jeton, reponses: Corps }))
  .handler(({ data }) =>
    executer(async () => enregistrerBrouillon(await clientService(), data.jeton, data.reponses)),
  );

export const signerPositionnementPublic = createServerFn({ method: "POST" })
  .validator(z.object({ jeton: Jeton, reponses: Corps }))
  .handler(({ data }) =>
    executer(async () =>
      signer(await clientService(), data.jeton, data.reponses, await adresseIpDeLaRequete()),
    ),
  );
