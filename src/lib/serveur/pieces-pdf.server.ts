/**
 * Conversion HTML → PDF par un service externe de type Gotenberg — port « PDF » de l'ancien serveur, SANS Chromium
 * (impossible dans Cloudflare Workers).
 *
 *   • `PDF_SERVICE_URL` absent  → `null` : l'appelant archive alors le HTML imprimable (repli d'origine, assumé) ;
 *   • `PDF_SERVICE_URL` défini  → POST multipart `{PDF_SERVICE_URL}/forms/chromium/convert/html` (API Gotenberg 7/8,
 *                                 fichier `index.html`, `@page` du gabarit respecté) ; `PDF_API_KEY`, si défini, part en
 *                                 `Authorization: Bearer …`.
 *   • service en panne, lent (20 s), réponse qui n'est pas un PDF → `null` + trace : jamais d'échec de l'action métier.
 * Le HTML reste TOUJOURS la référence archivée et scellée ; le PDF n'est qu'un confort de lecture.
 */
const DELAI_MS = 20_000;

/** Variable d'environnement (secret Lovable Cloud / Cloudflare) ; `process` peut ne pas exister dans un Worker. */
const lire = (nom: "PDF_SERVICE_URL" | "PDF_API_KEY"): string | undefined => {
  const brut = typeof process !== "undefined" ? process.env?.[nom] : undefined;
  const v = brut?.trim();
  return v ? v : undefined;
};

export function pdfConfigure(): boolean {
  return lire("PDF_SERVICE_URL") !== undefined;
}

export async function convertirEnPdf(
  html: string,
  options: { fetch?: typeof fetch } = {},
): Promise<Uint8Array | null> {
  const base = lire("PDF_SERVICE_URL")?.replace(/\/+$/, "");
  if (!base) return null;
  const cle = lire("PDF_API_KEY");
  const appeler = options.fetch ?? fetch;
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), DELAI_MS);
  try {
    const formulaire = new FormData();
    formulaire.set("files", new Blob([html], { type: "text/html" }), "index.html");
    formulaire.set("preferCssPageSize", "true");
    formulaire.set("printBackground", "true");
    const reponse = await appeler(`${base}/forms/chromium/convert/html`, {
      method: "POST",
      headers: cle ? { Authorization: `Bearer ${cle}` } : {},
      body: formulaire,
      signal: controle.signal,
    });
    if (!reponse.ok) {
      console.warn(`[pdf] conversion refusée (${reponse.status}), repli sur le HTML`);
      return null;
    }
    const octets = new Uint8Array(await reponse.arrayBuffer());
    // Un PDF commence par « %PDF » : on n'archive jamais une page d'erreur sous une extension .pdf.
    if (octets.length < 5 || String.fromCharCode(...octets.subarray(0, 4)) !== "%PDF") {
      console.warn("[pdf] réponse du service non reconnue comme PDF, repli sur le HTML");
      return null;
    }
    return octets;
  } catch (e) {
    console.warn("[pdf] conversion impossible, repli sur le HTML :", (e as Error).message);
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}
