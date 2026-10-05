/**
 * Document d'invitation d'un formulaire apprenant (HTML imprimable avec QR code) — joint à l'e-mail d'envoi.
 *
 * Partie PURE de `documentInvitation` de l'ancien `formulaires-apprenant.ts` : le QR code (SVG) est produit par
 * l'appelant et injecté, pour que le noyau reste sans dépendance. Le texte est celui de l'ancien service.
 */
import { echapperHtml as e } from "../gabarits/moteur";

export interface OptionsInvitation {
  of_nom: string;
  couleur: string;
  apprenant: string;
  formation: string;
  libelle: string;
  lien: string;
  expire: string;
  formateur: string;
}

/** Options du QR code attendues par l'appelant : même rendu que l'ancien service. */
export const OPTIONS_QR = {
  type: "svg",
  margin: 1,
  width: 220,
  color: { dark: "#1f2a24", light: "#ffffff" },
} as const;

export function documentInvitationHtml(o: OptionsInvitation, qr: string): string {
  const couleur = /^#[0-9a-f]{6}$/i.test(o.couleur) ? o.couleur : "#1d6a45";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(o.libelle)} — ${e(o.apprenant)}</title><style>
@page{size:A4;margin:18mm 16mm}body{font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f2a24;margin:0}
.of{font-weight:700;color:${couleur};letter-spacing:.02em;font-size:12pt}h1{font-size:22pt;margin:14pt 0 4pt;color:${couleur}}h2{font-size:13pt;margin:18pt 0 6pt}
table{border-collapse:collapse;width:100%;margin-top:8pt}td,th{border:.6pt solid #c9cfc9;padding:6pt 8pt;vertical-align:top;text-align:left}th{background:#f4f6f3;width:34%;font-weight:600}
.qr{display:flex;gap:18pt;align-items:center;margin:14pt 0;padding:12pt;border:1.2pt solid ${couleur};border-radius:6pt}.qr svg{width:150pt;height:150pt;flex:0 0 auto}
.btn{display:inline-block;background:${couleur};color:#fff;text-decoration:none;padding:9pt 16pt;border-radius:5pt;font-weight:600}.lien{word-break:break-all;font-size:9pt;color:#5b6472}
ol{padding-left:16pt}.pied{margin-top:20pt;font-size:8.5pt;color:#5b6472}
</style></head><body>
<div class="of">${e(o.of_nom)}</div>
<h1>${e(o.libelle)}</h1>
<p>Bonjour ${e(o.apprenant)},</p>
<p>Votre formateur${o.formateur ? `, ${e(o.formateur)},` : ""} vous invite à renseigner et signer en ligne le formulaire « <strong>${e(o.libelle)}</strong> » de la formation <strong>${e(o.formation)}</strong>.</p>
<table><tr><th>Apprenant</th><td>${e(o.apprenant)}</td></tr><tr><th>Formation</th><td>${e(o.formation)}</td></tr><tr><th>Formulaire</th><td>${e(o.libelle)}</td></tr><tr><th>Lien valable jusqu'au</th><td>${e(o.expire)}</td></tr></table>
<div class="qr">${qr}<div><p><strong>Scannez ce code avec votre téléphone</strong>, ou cliquez sur le bouton :</p><p><a class="btn" href="${e(o.lien)}">Ouvrir mon formulaire</a></p><p class="lien">${e(o.lien)}</p></div></div>
<h2>Comment ça se passe</h2>
<ol><li>La page s'ouvre à votre nom, sans compte à créer : vos informations sont déjà renseignées.</li><li>Vous répondez aux questions (vous pouvez enregistrer et reprendre plus tard, sur n'importe quel appareil).</li><li>Vous indiquez la date et le lieu, puis vous signez avec le doigt ou la souris.</li><li>C'est validé : le document signé vous est envoyé par e-mail et rejoint automatiquement votre dossier de formation.</li></ol>
<p class="pied">Ce lien est personnel : ne le transmettez pas. Signature électronique simple (tracé, horodatage serveur, empreinte SHA-256). Document généré par la plateforme de ${e(o.of_nom)}.</p>
</body></html>`;
}
