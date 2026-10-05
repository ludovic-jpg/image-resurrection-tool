/**
 * Port « archive » — F-ARCH-02 à F-ARCH-05.
 * Arborescence : `<racine>/<organisme>/<dossier_reference>/Pièces de départ|Retour/<fichier>`,
 * plus des espaces hors dossier (coffre-fort d'une formation, pièces d'une candidature).
 * Adaptateur livré : disque local. Un adaptateur Drive ou S3 implémentera la même interface.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

export type SousDossier = "Pièces de départ" | "Retour";

export interface Archive {
  /** Écrit un fichier et retourne son chemin RELATIF à la racine (c'est lui qu'on stocke en base). */
  ecrire(cheminRelatif: string, contenu: Buffer | string): Promise<string>;
  lire(cheminRelatif: string): Promise<Buffer>;
  existe(cheminRelatif: string): Promise<boolean>;
  supprimer(cheminRelatif: string): Promise<void>;
}

/** Nettoie un nom pour en faire un segment de chemin sûr, en conservant les accents lisibles. */
export function nomSur(nom: string): string {
  const propre = nom
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex -- les caractères de contrôle sont précisément ce qu'on veut retirer
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "_");
  return (propre || "fichier").slice(0, 150);
}

export function cheminPiece(ofId: string, dossierReference: string, sousDossier: SousDossier, fichier: string): string {
  return [nomSur(ofId), "dossiers", nomSur(dossierReference), sousDossier, nomSur(fichier)].join("/");
}

export function cheminCoffre(ofId: string, formationId: string, fichier: string): string {
  return [nomSur(ofId), "coffres", nomSur(formationId), nomSur(fichier)].join("/");
}

export function cheminCandidature(ofId: string, formateurId: string, fichier: string): string {
  return [nomSur(ofId), "candidatures", nomSur(formateurId), nomSur(fichier)].join("/");
}

export class ArchiveLocale implements Archive {
  private readonly racine: string;

  constructor(racine: string) {
    this.racine = resolve(racine);
  }

  /** Refuse tout chemin qui sortirait de la racine (`../`, chemin absolu). */
  private absolu(cheminRelatif: string): string {
    const cible = resolve(this.racine, normalize(cheminRelatif));
    if (cible !== this.racine && !cible.startsWith(this.racine + sep)) throw new Error("Chemin d'archive invalide.");
    return cible;
  }

  async ecrire(cheminRelatif: string, contenu: Buffer | string): Promise<string> {
    const cible = this.absolu(cheminRelatif);
    await mkdir(dirname(cible), { recursive: true });
    await writeFile(cible, contenu);
    return cheminRelatif;
  }

  lire(cheminRelatif: string): Promise<Buffer> {
    return readFile(this.absolu(cheminRelatif));
  }

  async existe(cheminRelatif: string): Promise<boolean> {
    try {
      return (await stat(this.absolu(cheminRelatif))).isFile();
    } catch {
      return false;
    }
  }

  async supprimer(cheminRelatif: string): Promise<void> {
    await rm(this.absolu(cheminRelatif), { force: true });
  }
}

/** Archive en mémoire, pour les tests. */
export class ArchiveMemoire implements Archive {
  readonly fichiers = new Map<string, Buffer>();

  async ecrire(cheminRelatif: string, contenu: Buffer | string): Promise<string> {
    this.fichiers.set(cheminRelatif, Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu, "utf8"));
    return cheminRelatif;
  }
  async lire(cheminRelatif: string): Promise<Buffer> {
    const f = this.fichiers.get(cheminRelatif);
    if (!f) throw new Error(`Fichier absent de l'archive : ${cheminRelatif}`);
    return f;
  }
  async existe(cheminRelatif: string): Promise<boolean> {
    return this.fichiers.has(cheminRelatif);
  }
  async supprimer(cheminRelatif: string): Promise<void> {
    this.fichiers.delete(cheminRelatif);
  }
  /** Chemins archivés pour un dossier et un sous-dossier donnés. */
  lister(prefixe: string): string[] {
    return [...this.fichiers.keys()].filter((c) => c.includes(prefixe)).sort();
  }
}

export { join as joindreChemin };
