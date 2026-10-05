/**
 * Les 16 modèles d'e-mail automatiques de la plateforme (repris à l'identique de `src/serveur/services/courriels.ts`).
 *
 * Partie PURE : aucune dépendance réseau ni Supabase. Chaque modèle renvoie `{ sujet, corps_html }` ; l'envoi et
 * l'enregistrement dans la table `courrier` sont faits par `src/lib/serveur/courrier.server.ts`.
 * L'identité de l'organisme (`of_nom`) vient toujours de sa configuration, jamais d'une constante.
 */
import { echapperHtml as e } from "@/domaine/gabarits/moteur";

export interface Courriel {
  sujet: string;
  corps_html: string;
}

function habiller(
  ofNom: string,
  titre: string,
  paragraphes: string[],
  bouton?: { libelle: string; url: string },
): string {
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2a24;max-width:560px;margin:0 auto;padding:24px">
<div style="font-weight:700;color:#1d6a45;letter-spacing:.02em;margin-bottom:18px">${e(ofNom)}</div>
<h1 style="font-size:20px;margin:0 0 14px">${e(titre)}</h1>
${paragraphes.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("\n")}
${bouton ? `<p style="margin:22px 0"><a href="${e(bouton.url)}" style="background:#1d6a45;color:#fff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:600">${e(bouton.libelle)}</a></p>` : ""}
<p style="margin-top:26px;font-size:12px;color:#5b6472">Message automatique envoyé par la plateforme de ${e(ofNom)}.</p>
</div>`;
}

export const courriels = {
  invitationApprenant: (a: {
    of_nom: string;
    prenom: string;
    formateur: string;
    formation: string;
    lien: string;
  }): Courriel => ({
    sujet: `Votre espace personnel — ${a.formation}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `${e(a.formateur)} vous invite à rejoindre votre espace personnel pour la formation <strong>${e(a.formation)}</strong>.`,
        "Vous y trouverez les documents qui vous concernent. Vous pourrez les signer en ligne, ou les télécharger pour les signer puis les redéposer.",
        "Ce lien est personnel et valable 14 jours. Il vous permet de choisir votre mot de passe.",
      ],
      { libelle: "Accéder à mon espace", url: a.lien },
    ),
  }),

  relanceApprenant: (a: {
    of_nom: string;
    prenom: string;
    formation: string;
    pieces: string[];
    lien: string;
  }): Courriel => ({
    sujet: `Rappel — documents en attente pour « ${a.formation} »`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `Des documents attendent votre retour pour la formation <strong>${e(a.formation)}</strong> :`,
        `<ul>${a.pieces.map((p) => `<li>${e(p)}</li>`).join("")}</ul>`,
        "Quelques minutes suffisent : tout se fait depuis votre espace personnel.",
      ],
      { libelle: "Ouvrir mon espace", url: a.lien },
    ),
  }),

  decisionCandidature: (a: {
    of_nom: string;
    prenom: string;
    validee: boolean;
    motif: string;
    lien: string;
  }): Courriel => ({
    sujet: a.validee ? "Votre candidature est validée" : "Suite donnée à votre candidature",
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      a.validee
        ? [
            "Votre candidature de formateur est <strong>validée</strong>. Vous pouvez dès maintenant créer vos formations et instruire vos dossiers.",
          ]
        : [
            "Après étude, votre candidature de formateur <strong>n'a pas été retenue</strong> en l'état.",
            a.motif ? `Motif indiqué : ${e(a.motif)}` : "",
            "Vous pouvez compléter votre dossier et le soumettre à nouveau.",
          ].filter(Boolean),
      { libelle: "Ouvrir mon espace", url: a.lien },
    ),
  }),

  candidatureSoumise: (a: { of_nom: string; candidat: string; lien: string }): Courriel => ({
    sujet: `Nouvelle candidature de formateur — ${a.candidat}`,
    corps_html: habiller(
      a.of_nom,
      "Une candidature attend votre décision",
      [`${e(a.candidat)} vient de soumettre sa candidature de formateur.`],
      { libelle: "Étudier la candidature", url: a.lien },
    ),
  }),

  demandeValidation: (a: {
    of_nom: string;
    formateur: string;
    reference: string;
    formation: string;
    lien: string;
  }): Courriel => ({
    sujet: `Dossier ${a.reference} à valider`,
    corps_html: habiller(
      a.of_nom,
      "Un dossier attend votre validation",
      [
        `${e(a.formateur)} demande la validation du dossier <strong>${e(a.reference)}</strong> — ${e(a.formation)}.`,
      ],
      { libelle: "Ouvrir le dossier", url: a.lien },
    ),
  }),

  renvoiEnBrouillon: (a: {
    of_nom: string;
    prenom: string;
    reference: string;
    motif: string;
    lien: string;
  }): Courriel => ({
    sujet: `Dossier ${a.reference} — corrections demandées`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `Le dossier <strong>${e(a.reference)}</strong> vous est renvoyé pour correction.`,
        `Motif : ${e(a.motif)}`,
      ],
      { libelle: "Corriger le dossier", url: a.lien },
    ),
  }),

  depotDeclare: (a: {
    of_nom: string;
    prenom: string;
    reference: string;
    formation: string;
    par: string;
    lien: string;
  }): Courriel => ({
    sujet: `Dossier ${a.reference} — demande de financement déposée`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `${e(a.par)} déclare avoir déposé la demande de prise en charge du dossier <strong>${e(a.reference)}</strong> — ${e(a.formation)} — auprès du financeur.`,
        "Dès réception de l'accord, déposez-le sur le dossier : l'ordre de mission partira automatiquement.",
      ],
      { libelle: "Ouvrir le dossier", url: a.lien },
    ),
  }),

  piecesFinancementEntreprise: (a: {
    of_nom: string;
    representant: string;
    formation: string;
    stagiaires: string;
    reference: string;
    pieces: string[];
  }): Courriel => ({
    sujet: `Votre demande de financement — ${a.formation}`,
    corps_html: habiller(a.of_nom, `Bonjour ${a.representant},`, [
      `Le dossier de formation <strong>${e(a.reference)}</strong> — ${e(a.formation)} — est validé par notre organisme pour ${e(a.stagiaires)}.`,
      "Vous trouverez en pièces jointes l'ensemble des documents nécessaires au dépôt de votre demande de financement :",
      `<ul>${a.pieces.map((p) => `<li>${e(p)}</li>`).join("")}</ul>`,
      "Dès réception de l'accord de prise en charge, il suffit de nous le transmettre ou de le déposer dans l'espace du stagiaire.",
    ]),
  }),

  odmFormateur: (a: {
    of_nom: string;
    prenom: string;
    reference: string;
    formation: string;
    lien: string;
  }): Courriel => ({
    sujet: `Ordre de mission à signer — dossier ${a.reference}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `L'accord de financement du dossier <strong>${e(a.reference)}</strong> — ${e(a.formation)} — est enregistré.`,
        "Votre ordre de mission est joint. Signez-le en ligne dans l'espace « Communication avec l'OF », ou retournez-le signé.",
      ],
      { libelle: "Signer l'ordre de mission", url: a.lien },
    ),
  }),

  elementsPedagogiques: (a: {
    of_nom: string;
    prenom: string;
    formation: string;
    date_debut: string;
    lien: string;
  }): Courriel => ({
    sujet: `Votre convocation — ${a.formation}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `Votre formation <strong>${e(a.formation)}</strong> débute le ${e(a.date_debut)}. Votre convocation est jointe.`,
        "Les supports pédagogiques mis à votre disposition par votre formateur sont accessibles dans votre espace personnel.",
      ],
      { libelle: "Ouvrir mon espace", url: a.lien },
    ),
  }),

  // ——— « Modification 1 » : positionnement avant dossier ———

  invitationPositionnement: (a: {
    of_nom: string;
    prenom: string;
    nom: string;
    email: string;
    formateur: string;
    formation: string;
    message: string;
    lien: string;
    expire: string;
  }): Courriel => ({
    sujet: `Votre positionnement — ${a.formation}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom} ${a.nom},`,
      [
        `${e(a.formateur)} vous invite à vous positionner sur la formation <strong>${e(a.formation)}</strong>.`,
        a.message ? `<em>« ${e(a.message)} »</em>` : "",
        "Sur votre page dédiée, deux étapes d'une quinzaine de minutes : <strong>A.</strong> le recueil de vos besoins, <strong>B.</strong> le test de positionnement. Vous pouvez enregistrer et reprendre plus tard, puis signer en ligne. Un PDF de vos réponses est alors produit, téléchargeable par vous et par votre formateur.",
        `Ce lien est personnel (adressé à ${e(a.email)}) et valable jusqu'au ${e(a.expire)}.`,
      ].filter(Boolean),
      { libelle: "Commencer mon positionnement", url: a.lien },
    ),
  }),

  positionnementComplet: (a: {
    of_nom: string;
    prenom: string;
    apprenant: string;
    formation: string;
    score: string;
    lien: string;
  }): Courriel => ({
    sujet: `Positionnement complété — ${a.apprenant}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `${e(a.apprenant)} a complété et signé son positionnement pour <strong>${e(a.formation)}</strong> (score : ${e(a.score)}).`,
        "Le PDF signé est joint ; il est aussi disponible dans l'application, dans le coffre-fort du parcours.",
      ],
      { libelle: "Voir les positionnements", url: a.lien },
    ),
  }),

  positionnementConfirmation: (a: {
    of_nom: string;
    prenom: string;
    formation: string;
    lien: string;
  }): Courriel => ({
    sujet: `Votre positionnement est enregistré — ${a.formation}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `Merci : votre positionnement pour <strong>${e(a.formation)}</strong> est complet et signé. Le PDF de vos réponses est joint à ce message.`,
        "Votre formateur s'en servira pour adapter la formation à vos besoins et à votre niveau.",
      ],
      { libelle: "Revoir ou télécharger mon positionnement", url: a.lien },
    ),
  }),

  // ——— Version 7 : formulaires de l'apprenant en page interactive ———

  formulaireApprenant: (a: {
    of_nom: string;
    prenom: string;
    formateur: string;
    formation: string;
    libelle: string;
    message: string;
    lien: string;
    expire: string;
    relance: boolean;
  }): Courriel => ({
    sujet: `${a.relance ? "Rappel — " : ""}${a.libelle} — ${a.formation}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        a.relance
          ? `Petit rappel : votre formulaire « <strong>${e(a.libelle)}</strong> » pour la formation <strong>${e(a.formation)}</strong> attend toujours vos réponses.`
          : `${e(a.formateur) || "Votre formateur"} vous invite à renseigner et signer en ligne le formulaire « <strong>${e(a.libelle)}</strong> » de la formation <strong>${e(a.formation)}</strong>.`,
        a.message ? `<em>« ${e(a.message)} »</em>` : "",
        "Sans compte à créer : la page s'ouvre à votre nom. Vous répondez, vous pouvez enregistrer et reprendre plus tard, puis vous signez avec le doigt ou la souris. Le document signé vous est renvoyé et rejoint automatiquement votre dossier.",
        "Le même lien figure, avec un QR code, dans le document joint à ce message.",
        `Ce lien est personnel et valable jusqu'au ${e(a.expire)}.`,
      ].filter(Boolean),
      { libelle: "Ouvrir mon formulaire", url: a.lien },
    ),
  }),

  formulaireConfirmation: (a: {
    of_nom: string;
    prenom: string;
    formation: string;
    libelle: string;
    lien: string;
  }): Courriel => ({
    sujet: `Votre formulaire « ${a.libelle} » est signé — ${a.formation}`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `Merci : votre formulaire « <strong>${e(a.libelle)}</strong> » pour <strong>${e(a.formation)}</strong> est complet et signé. Le document signé est joint à ce message.`,
        "Il a rejoint automatiquement votre dossier de formation.",
      ],
      { libelle: "Revoir ou télécharger mon document", url: a.lien },
    ),
  }),

  formulaireRecu: (a: {
    of_nom: string;
    prenom: string;
    apprenant: string;
    formation: string;
    libelle: string;
    reference: string;
    lien: string;
  }): Courriel => ({
    sujet: `${a.libelle} signé — ${a.apprenant} (${a.reference})`,
    corps_html: habiller(
      a.of_nom,
      `Bonjour ${a.prenom},`,
      [
        `${e(a.apprenant)} a renseigné et signé « <strong>${e(a.libelle)}</strong> » pour <strong>${e(a.formation)}</strong> (dossier ${e(a.reference)}).`,
        "La pièce est validée dans le dossier ; le document signé est joint.",
      ],
      { libelle: "Ouvrir le dossier", url: a.lien },
    ),
  }),
};

/**
 * E-mail de test d'envoi (« Organisme → E-mails → Envoyer un e-mail de test »). Il ne fait pas partie des 16 modèles
 * métier : c'était un texte en ligne dans `reglages.envoyerCourrielDeTest`. `instant` est passé par l'appelant pour
 * que le modèle reste pur (pas d'horloge ici).
 */
export function courrielDeTest(a: { nom: string; instant: Date }): Courriel {
  const quand = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(a.instant);
  return {
    sujet: "Test d'envoi — plateforme de formation",
    corps_html: `<p>Bonjour ${e(a.nom)},</p><p>Si vous lisez ce message, l'envoi des e-mails depuis votre plateforme fonctionne.</p><p>Envoyé le ${quand}.</p>`,
  };
}
