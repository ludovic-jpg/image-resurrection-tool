/**
 * Archive de fichiers sur Supabase Storage — équivalent du port `Archive` de `src/serveur/ports/archive.ts`.
 *
 * Trois buckets privés : `archive` (pièces de dossier, pièces de candidature), `coffre`, `supports`. Les chemins
 * relatifs gardent la forme de l'ancien serveur et commencent TOUJOURS par `<of_id>/` (voir
 * `@/domaine/archive/chemins`). Une archive est ouverte POUR UN ORGANISME : toute opération sur un chemin qui n'est pas
 * sous `<of_id>/` (autre organisme, `..`, chemin absolu) est refusée avant d'atteindre Storage.
 *
 * Les fichiers circulent en `Uint8Array` (pas de `Buffer` dans Cloudflare Workers). Le client passé doit être le client
 * « service » (écriture dans `archive/<of>/dossiers` réservée au serveur) ; pour les pièces de candidature, le client du
 * formateur suffit (politiques `s4m_archive_*_candidature`).
 */
import { cheminAppartientA } from "@/domaine/archive/chemins";
import type { BdService } from "./bd.server";
import { variable } from "./config.server";
import { invalide } from "./erreurs.server";

export type NomBucket = "archive" | "coffre" | "supports";

const BUCKET_PAR_DEFAUT: Record<NomBucket, string> = {
  archive: "archive",
  coffre: "coffre",
  supports: "supports",
};
const VARIABLE_BUCKET = {
  archive: "ARCHIVE_BUCKET",
  coffre: "COFFRE_BUCKET",
  supports: "SUPPORTS_BUCKET",
} as const;

export interface Archive {
  /** Écrit (ou remplace) un fichier et renvoie son chemin RELATIF — celui qu'on stocke en base. */
  ecrire(chemin: string, contenu: Uint8Array | string, typeMime?: string): Promise<string>;
  lire(chemin: string): Promise<Uint8Array>;
  existe(chemin: string): Promise<boolean>;
  supprimer(chemin: string): Promise<void>;
  /** Déplace un fichier (ex. d'un préfixe temporaire vers son emplacement définitif). */
  deplacer(de: string, vers: string): Promise<string>;
  /** Lien de téléchargement temporaire (60 s par défaut) ; `nomTelechargement` impose le nom du fichier téléchargé. */
  urlSignee(chemin: string, secondes?: number, nomTelechargement?: string): Promise<string>;
}

/** Ouvre l'archive d'un organisme dans un bucket. */
export function ouvrirArchive(
  bd: BdService,
  options: { ofId: string; bucket?: NomBucket },
): Archive {
  const { ofId } = options;
  const nomBucket =
    variable(VARIABLE_BUCKET[options.bucket ?? "archive"]) ??
    BUCKET_PAR_DEFAUT[options.bucket ?? "archive"];
  const stockage = () => bd.storage.from(nomBucket);
  const verifier = (chemin: string): string => {
    if (!cheminAppartientA(chemin, ofId)) throw invalide("Chemin de fichier invalide.");
    return chemin;
  };
  const panne = (contexte: string, e: { message?: string } | null): never => {
    console.error(`[archive] ${contexte}`, e);
    throw new Error(`Archive : ${contexte} impossible (${e?.message ?? "erreur inconnue"})`);
  };

  return {
    async ecrire(chemin, contenu, typeMime) {
      verifier(chemin);
      const corps = typeof contenu === "string" ? new TextEncoder().encode(contenu) : contenu;
      const { error } = await stockage().upload(chemin, corps, {
        upsert: true,
        contentType: typeMime ?? "application/octet-stream",
      });
      if (error) panne("écriture", error);
      return chemin;
    },
    async lire(chemin) {
      verifier(chemin);
      const { data, error } = await stockage().download(chemin);
      if (error || !data) return panne("lecture", error);
      return new Uint8Array(await data.arrayBuffer());
    },
    async existe(chemin) {
      verifier(chemin);
      const i = chemin.lastIndexOf("/");
      const { data, error } = await stockage().list(chemin.slice(0, i), {
        limit: 100,
        search: chemin.slice(i + 1),
      });
      if (error) return panne("recherche", error);
      return (data ?? []).some((f) => f.name === chemin.slice(i + 1));
    },
    async supprimer(chemin) {
      verifier(chemin);
      const { error } = await stockage().remove([chemin]);
      if (error) panne("suppression", error);
    },
    async deplacer(de, vers) {
      verifier(de);
      verifier(vers);
      const { error } = await stockage().move(de, vers);
      if (error) panne("déplacement", error);
      return vers;
    },
    async urlSignee(chemin, secondes = 60, nomTelechargement) {
      verifier(chemin);
      const { data, error } = await stockage().createSignedUrl(
        chemin,
        secondes,
        nomTelechargement ? { download: nomTelechargement } : undefined,
      );
      if (error || !data?.signedUrl) return panne("lien de téléchargement", error);
      return data.signedUrl;
    },
  };
}
