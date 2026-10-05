/**
 * Signature électronique « simple » : tracé manuscrit (souris ou doigt) + lieu + horodatage
 * + empreinte SHA-256 du document signé. Aucun prestataire tiers (décision du porteur de projet).
 *
 * Repris de la base B (`signature.ts`) : le principe de l'empreinte recalculée CÔTÉ SERVEUR et du
 * certificat de preuve. Ajouté : le tracé manuscrit, le lieu, et la vérification d'intégrité.
 *
 * Le calcul de l'empreinte lui-même est injecté (port `Hacheur`) : le noyau reste pur.
 */
import { echapperHtml } from "../gabarits/moteur";
import type { Role } from "../referentiel/pieces";

export interface PreuveSignature {
  signataire_nom: string;
  signataire_role: Role;
  signataire_email: string;
  /** Tracé manuscrit : image PNG encodée en data-URL. */
  trace_png: string;
  lieu: string;
  /** Horodatage ISO 8601 (UTC), posé par le serveur — jamais par le navigateur. */
  horodatage: string;
  /** Empreinte SHA-256 (hexadécimal) du document tel qu'il a été présenté au signataire. */
  empreinte_document: string;
  adresse_ip?: string;
}

export type Hacheur = (contenu: string) => Promise<string> | string;

const TAILLE_MAX_TRACE = 400_000; // ~300 Ko d'image : largement assez pour un tracé
const RE_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

/** Contrôle une demande de signature. Retourne les erreurs (vide = recevable). */
export function validerDemandeSignature(demande: {
  trace_png: string;
  lieu: string;
  consentement: boolean;
}): string[] {
  const erreurs: string[] = [];
  if (!demande.consentement)
    erreurs.push("Le consentement à la signature électronique est obligatoire.");
  if (demande.lieu.trim() === "") erreurs.push("Le lieu de signature est obligatoire.");
  if (demande.lieu.length > 120) erreurs.push("Le lieu de signature est trop long.");
  if (!RE_PNG.test(demande.trace_png))
    erreurs.push("Le tracé de signature est absent ou dans un format non reconnu.");
  else if (demande.trace_png.length > TAILLE_MAX_TRACE)
    erreurs.push("Le tracé de signature est trop volumineux.");
  else if (demande.trace_png.length < 600) erreurs.push("Le tracé de signature est vide.");
  return erreurs;
}

/** Le document archivé est-il bien celui qui a été signé ? */
export async function verifierIntegrite(
  contenuDocument: string,
  preuve: Pick<PreuveSignature, "empreinte_document">,
  hacher: Hacheur,
): Promise<boolean> {
  return (await hacher(contenuDocument)) === preuve.empreinte_document;
}

export function horodatageLisible(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(date);
}

/** Bloc HTML inséré dans la zone de signature d'une pièce. */
export function blocSignatureHtml(preuve: PreuveSignature | null | undefined): string {
  if (!preuve) return `<div class="attente">En attente de signature</div>`;
  return (
    `<img src="${echapperHtml(preuve.trace_png)}" alt="Signature de ${echapperHtml(preuve.signataire_nom)}">` +
    `<div class="preuve">Signé électroniquement par ${echapperHtml(preuve.signataire_nom)}<br>` +
    `à ${echapperHtml(preuve.lieu)}, le ${echapperHtml(horodatageLisible(preuve.horodatage))}<br>` +
    `Empreinte du document : ${echapperHtml(preuve.empreinte_document.slice(0, 16))}…</div>`
  );
}

/** Certificat de preuve, archivé à côté du document signé. */
export function certificatHtml(
  preuve: PreuveSignature,
  piece: { code: string; libelle: string; dossier_reference: string },
): string {
  const lignes: Array<[string, string]> = [
    ["Document", `${piece.code} — ${piece.libelle}`],
    ["Dossier de formation", piece.dossier_reference],
    ["Signataire", preuve.signataire_nom],
    ["Qualité", preuve.signataire_role],
    ["Adresse électronique", preuve.signataire_email],
    ["Lieu déclaré", preuve.lieu],
    ["Horodatage (Europe/Paris)", horodatageLisible(preuve.horodatage)],
    ["Horodatage (UTC, ISO 8601)", preuve.horodatage],
    ["Adresse IP", preuve.adresse_ip ?? "non relevée"],
    ["Empreinte SHA-256 du document", preuve.empreinte_document],
  ];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Certificat de signature — ${echapperHtml(piece.dossier_reference)}</title>
<style>body{font-family:Inter,Arial,sans-serif;font-size:10.5pt;color:#1f2a24;max-width:170mm;margin:12mm auto}h1{font-size:15pt}table{width:100%;border-collapse:collapse;margin:6mm 0}th,td{border:1px solid #d6ddd8;padding:2.5mm 3mm;text-align:left;vertical-align:top}th{width:38%;background:#f4f6f5;font-weight:600}td{word-break:break-all}img{max-height:30mm;border:1px solid #d6ddd8;padding:2mm}p{font-size:9pt;color:#5b6472}</style></head><body>
<h1>Certificat de signature électronique</h1>
<table>${lignes.map(([k, val]) => `<tr><th>${echapperHtml(k)}</th><td>${echapperHtml(val)}</td></tr>`).join("")}</table>
<img src="${echapperHtml(preuve.trace_png)}" alt="Tracé de la signature">
<p>Signature électronique simple au sens du règlement (UE) n° 910/2014 (eIDAS) : le signataire, authentifié sur la plateforme, a tracé sa signature et confirmé son consentement. L'empreinte ci-dessus permet de vérifier que le document archivé n'a pas été modifié depuis.</p>
</body></html>`;
}
