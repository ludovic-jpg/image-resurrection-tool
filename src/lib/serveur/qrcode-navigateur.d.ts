/**
 * Le paquet `qrcode` expose, sous `qrcode/lib/browser`, la version SANS Node (`fs`, `pngjs`) : seule celle-ci est
 * sûre dans Cloudflare Workers. `@types/qrcode` ne décrit que l'entrée principale ; on déclare ici le strict nécessaire.
 */
declare module "qrcode/lib/browser" {
  export function toString(
    texte: string,
    options?: {
      type?: "svg";
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<string>;
}
