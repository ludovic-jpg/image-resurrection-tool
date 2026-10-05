/** Fabrique un VRAI fichier PNG (tracé ondulé) pour les signatures du jeu de démonstration. Aucune dépendance : zlib + CRC32. */
import { deflateSync } from "node:zlib";

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(donnees: Buffer): number {
  let c = 0xffffffff;
  for (const octet of donnees) c = TABLE_CRC[(c ^ octet) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type: string, donnees: Buffer): Buffer {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, "ascii"), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, crc]);
}

/** PNG RGBA transparent de 260 × 80 portant un trait d'encre ; `graine` fait varier la forme d'une personne à l'autre. */
export function tracePngDemo(graine = 1): string {
  const largeur = 260;
  const hauteur = 80;
  const pixels = Buffer.alloc((largeur * 4 + 1) * hauteur); // un octet de filtre (0) en tête de chaque ligne
  const encre = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px < 0 || px >= largeur || py < 0 || py >= hauteur) continue;
        const i = py * (largeur * 4 + 1) + 1 + px * 4;
        pixels[i] = 0x1b;
        pixels[i + 1] = 0x3a;
        pixels[i + 2] = 0x5c;
        pixels[i + 3] = 0xff;
      }
    }
  };
  for (let t = 0; t <= 1; t += 0.0015) {
    const x = 14 + t * 232;
    const y = 40 + Math.sin(t * (9 + graine * 2.3)) * (18 - t * 8) + Math.sin(t * 31 + graine) * 5 - t * 6;
    encre(x, y);
  }
  for (let t = 0; t <= 1; t += 0.004) encre(40 + t * 170, 66 - t * 4); // paraphe souligné

  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete.set([8, 6, 0, 0, 0], 8); // 8 bits par canal, RGBA
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc("IHDR", entete), bloc("IDAT", deflateSync(pixels)), bloc("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
