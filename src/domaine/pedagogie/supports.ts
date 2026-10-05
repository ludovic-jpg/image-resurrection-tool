/**
 * Règles pures des supports de cours : nom du fichier PPTX et repère du module dans le coffre-fort.
 * Reprise de `nomSupport` de `src/serveur/services/supports.ts` (même nom de fichier).
 */

export const nomSupport = (rang: number, titre: string): string =>
  `Support — Module ${rang} — ${titre
    .replace(/[\\/:*?"<>|]/g, " ")
    .slice(0, 80)
    .trim()}.pptx`;

/**
 * Repère stocké dans `coffre_fichier.description` d'un support généré : il permet de retrouver (et de mettre à la
 * corbeille) le support précédent du MÊME module quand on le reproduit.
 */
export const repereModule = (rang: number): string => `module:${rang}`;

export const TYPE_MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
