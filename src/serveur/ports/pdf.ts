/**
 * Port « PDF » : HTML → PDF par un Chromium sans interface (playwright-core).
 * Un seul gabarit HTML sert ainsi à l'écran, à l'impression et au PDF archivé.
 *
 * Repli assumé : sans Chromium disponible, la pièce reste archivée en HTML imprimable — l'application
 * fonctionne, et le journal de démarrage le dit. (La base B avait un mécanisme de repli comparable.)
 */
import { existsSync } from "node:fs";
import type { Browser } from "playwright-core";

export interface ConvertisseurPdf {
  /** `null` = conversion indisponible : l'appelant archive alors le HTML. */
  convertir(html: string): Promise<Buffer | null>;
  fermer(): Promise<void>;
  readonly disponible: boolean;
}

const CANDIDATS = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function trouverChromium(chemins: Array<string | undefined> = CANDIDATS): string | null {
  return chemins.find((c): c is string => Boolean(c) && existsSync(c!)) ?? null;
}

export class ConvertisseurChromium implements ConvertisseurPdf {
  private navigateur: Promise<Browser> | null = null;

  constructor(private readonly executable: string | null = trouverChromium()) {}

  get disponible(): boolean {
    return this.executable !== null;
  }

  private async ouvrir(): Promise<Browser> {
    if (!this.navigateur) {
      const { chromium } = await import("playwright-core");
      this.navigateur = chromium.launch({ executablePath: this.executable!, args: ["--no-sandbox"] });
    }
    return this.navigateur;
  }

  async convertir(html: string): Promise<Buffer | null> {
    if (!this.executable) return null;
    try {
      const navigateur = await this.ouvrir();
      const contexte = await navigateur.newContext({ javaScriptEnabled: false, offline: true });
      try {
        const page = await contexte.newPage();
        await page.setContent(html, { waitUntil: "load" });
        return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      } finally {
        await contexte.close();
      }
    } catch (erreur) {
      console.warn("[pdf] conversion impossible, repli sur le HTML :", (erreur as Error).message);
      return null;
    }
  }

  async fermer(): Promise<void> {
    if (this.navigateur) await (await this.navigateur).close().catch(() => undefined);
    this.navigateur = null;
  }
}

/** Convertisseur inerte, pour les tests qui n'ont pas besoin d'un navigateur. */
export const sansPdf: ConvertisseurPdf = {
  disponible: false,
  convertir: async () => null,
  fermer: async () => undefined,
};
