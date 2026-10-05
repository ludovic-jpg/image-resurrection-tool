/** Petits ports techniques : empreinte, horloge, identifiants. Injectés pour que les tests soient déterministes. */
import { createHash, randomBytes, randomUUID } from "node:crypto";

export const sha256 = (contenu: string | Buffer): string => createHash("sha256").update(contenu).digest("hex");

export interface Horloge {
  maintenant(): Date;
}

export const horlogeSysteme: Horloge = { maintenant: () => new Date() };

export class HorlogeFixe implements Horloge {
  constructor(private instant: Date) {}
  maintenant(): Date {
    return new Date(this.instant);
  }
  avancer(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}

export const nouvelId = (): string => randomUUID();
export const jetonAleatoire = (): string => randomBytes(32).toString("base64url");
export const dateIso = (d: Date): string => d.toISOString().slice(0, 10);
