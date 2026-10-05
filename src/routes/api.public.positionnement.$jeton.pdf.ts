/**
 * Route 13 — GET /api/public/positionnement/:jeton/pdf : le document signé, sans session (lien personnel).
 *
 * Route serveur (pas une fonction) car l'écran l'ouvre par un simple lien `<a href>`. Le jeton du chemin est haché
 * SHA-256 puis comparé ; rien d'autre n'authentifie la demande. Le fichier est lu dans le bucket privé `archive`.
 * Tout est chargé À L'APPEL (jamais en tête de fichier) : le client « service » ne doit pas entrer dans le bundle navigateur.
 */
import { createFileRoute } from "@tanstack/react-router";

const entetesJson = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

// Le chemin est ajouté à `routeTree.gen.ts` par la génération (dev / build) ; tant que ce fichier généré, qu'on ne
// modifie pas à la main, ne le contient pas, le typage strict des chemins ne le connaît pas.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- chemin absent de l'arbre généré committé ; accepté dès qu'il est régénéré
export const Route = createFileRoute("/api/public/positionnement/$jeton/pdf")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { jeton: string } }) => {
        const { clientService } = await import("@/lib/serveur/bd.server");
        const { fichierPublic } = await import("@/lib/serveur/positionnement-public.server");
        const { versEchec } = await import("@/lib/serveur/erreurs.server");
        try {
          const f = await fichierPublic(await clientService(), params.jeton);
          const nomAscii = f.nom
            .normalize("NFD")
            .replace(/[^\x20-\x7e]/g, "")
            .replace(/["\\]/g, "_");
          return new Response(f.contenu as BodyInit, {
            status: 200,
            headers: {
              "content-type": f.type_mime,
              "content-disposition": `attachment; filename="${nomAscii}"; filename*=UTF-8''${encodeURIComponent(f.nom)}`,
              "x-content-type-options": "nosniff",
              // Document d'un tiers : ouvert hors de toute interprétation active.
              "content-security-policy":
                "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
              "cache-control": "private, no-store",
            },
          });
        } catch (e) {
          const echec = versEchec(e);
          return new Response(JSON.stringify({ erreur: echec.message, code: echec.code }), {
            status: echec.statut,
            headers: entetesJson,
          });
        }
      },
    },
  },
});
