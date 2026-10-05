/**
 * Formulaires de l'apprenant : recueil des besoins, test de positionnement, évaluation des acquis, satisfaction.
 *
 *  - Côté APPRENANT connecté (`Questionnaires`) : il répond depuis son espace.
 *  - Côté FORMATEUR et ORGANISME (`FormulairesApprenant`, version 7) : ils ne saisissent plus rien à la place de
 *    l'apprenant. Chaque formulaire part par e-mail (lien personnel + document d'invitation PDF), automatiquement au
 *    bon moment du dossier, ou d'un clic « Envoyer / Renvoyer » ; l'apprenant répond et signe en ligne, et la pièce
 *    validée apparaît ici.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Clock3, Eye, FileText, Mail, MailX, Send } from "lucide-react";
import type { ErreurApi } from "../api";
import { api, dateFr, instantFr, type Dossier, type EtatFormulaire, type QuestionnaireVue, type ResultatEnvoiFormulaire } from "../api";
import { useActeur } from "../session";
import { Alerte, Bouton, Carte, Chargement, cx, Etiquette, Modale, PastilleStatut, ZoneTexte, useNotifier } from "../ui/base";
import { Apercu, useRafraichirDossier } from "./DossierPieces";
import type { Champ as ChampFormulaire } from "@/domaine/formulaires/definitions";

export type TypeQuestionnaire = "recueil" | "positionnement" | "acquis" | "satisfaction_chaud" | "satisfaction_froid";

const DEFINITIONS: Record<TypeQuestionnaire, { libelle: string; code: string; aide: string }> = {
  recueil: { libelle: "Recueil des besoins", code: "00-AVT", aide: "Vos attentes et votre niveau de départ." },
  positionnement: { libelle: "Test de positionnement", code: "01-AVT", aide: "Quelques questions pour ajuster la formation à votre niveau." },
  acquis: { libelle: "Évaluation des acquis", code: "07-FIN", aide: "À renseigner en fin de formation, puis à signer." },
  satisfaction_chaud: { libelle: "Satisfaction à chaud", code: "08-FIN", aide: "Votre avis en fin de formation." },
  satisfaction_froid: { libelle: "Satisfaction à froid", code: "12-APR", aide: "Trois mois après : ce que la formation a changé." },
};

// ——— Apprenant connecté : il répond depuis son espace ———

function Formulaire({ vue, enCours, erreurs, envoyer }: { vue: QuestionnaireVue; enCours: boolean; erreurs: Record<string, string>; envoyer: (reponses: unknown) => void }) {
  const [texte, setTexte] = useState<Record<string, string>>((vue.reponses && !Array.isArray(vue.reponses) ? vue.reponses : {}) as Record<string, string>);
  const [choix, setChoix] = useState<Array<number | null>>(Array.isArray(vue.reponses) ? (vue.reponses as Array<number | null>) : (vue.questionnaire?.questions.map(() => null) ?? []));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        envoyer(vue.questionnaire ? choix : texte);
      }}
    >
      {vue.formulaire && <p className="text-sm text-encre-2">{vue.formulaire.introduction}</p>}

      {(vue.formulaire?.champs as ChampFormulaire[] | undefined)?.map((c) => (
        <fieldset key={c.id} className="min-w-0">
          <legend className="mb-2 text-sm font-medium text-encre">
            {c.libelle}
            {c.requis && <span className="text-danger"> *</span>}
          </legend>
          {c.type === "note" ? (
            <div className="flex gap-1.5" role="radiogroup" aria-label={c.libelle}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={cx("chiffres grid size-10 cursor-pointer place-items-center rounded-sm border text-sm font-semibold transition-colors duration-150", texte[c.id] === String(n) ? "border-accent bg-accent text-sur-accent" : "border-trait-fort bg-carte text-encre-2 hover:border-accent hover:text-accent")}>
                  <input type="radio" name={c.id} value={n} checked={texte[c.id] === String(n)} onChange={() => setTexte({ ...texte, [c.id]: String(n) })} className="sr-only" />
                  {n}
                </label>
              ))}
            </div>
          ) : c.type === "choix" ? (
            <div className="flex flex-wrap gap-2">
              {c.options?.map((o) => (
                <label key={o} className={cx("cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-150", texte[c.id] === o ? "border-accent bg-accent-doux font-medium text-accent-fort" : "border-trait-fort bg-carte text-encre-2 hover:border-accent")}>
                  <input type="radio" name={c.id} value={o} checked={texte[c.id] === o} onChange={() => setTexte({ ...texte, [c.id]: o })} className="sr-only" />
                  {o}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              rows={c.type === "texte_long" ? 3 : 1}
              value={texte[c.id] ?? ""}
              onChange={(e) => setTexte({ ...texte, [c.id]: e.target.value })}
              aria-label={c.libelle}
              className="w-full rounded-sm border border-trait-fort bg-carte px-3 py-2.5 text-sm leading-relaxed hover:border-encre-3 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            />
          )}
          {erreurs[c.id] && <p className="mt-1.5 text-[13px] text-danger">{erreurs[c.id]}</p>}
        </fieldset>
      ))}

      {vue.questionnaire?.questions.map((q, i) => (
        <fieldset key={i} className="min-w-0">
          <legend className="mb-2.5 text-sm font-medium text-encre">
            <span className="chiffres mr-2 text-accent">{i + 1}.</span>
            {q.enonce}
          </legend>
          <div className="space-y-1.5">
            {q.propositions.map((p, j) => (
              <label key={j} className={cx("flex cursor-pointer items-start gap-3 rounded-sm border px-3.5 py-2.5 text-sm transition-colors duration-150", choix[i] === j ? "border-accent bg-accent-doux" : "border-trait bg-carte hover:border-trait-fort")}>
                <input type="radio" name={`q${i}`} checked={choix[i] === j} onChange={() => setChoix(choix.map((c, k) => (k === i ? j : c)))} className="mt-0.5 size-4 shrink-0 accent-(--color-accent)" />
                {p}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <Bouton type="submit" variante="primaire" enCours={enCours} className="w-full sm:w-auto">
        Enregistrer mes réponses
      </Bouton>
    </form>
  );
}

function ModaleQuestionnaire({ d, type, fermer }: { d: Dossier; type: TypeQuestionnaire; fermer: () => void }) {
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const vue = useQuery({ queryKey: ["questionnaire", d.id, type], queryFn: () => api.get<QuestionnaireVue>(`/dossiers/${d.id}/questionnaires/${type}`), staleTime: 0 });
  const envoi = useMutation({
    mutationFn: (reponses: unknown) => api.post<{ score: number | null }>(`/dossiers/${d.id}/questionnaires/${type}`, { reponses }),
    onSuccess: async () => {
      await rafraichir();
      notifier("succes", "Réponses enregistrées.");
      fermer();
    },
  });
  const details = (envoi.error as ErreurApi | null)?.details?.erreurs;
  const erreursChamps = details && !Array.isArray(details) ? details : {};

  return (
    <Modale ouverte fermer={fermer} titre={DEFINITIONS[type].libelle}>
      {vue.isPending ? (
        <Chargement />
      ) : vue.error ? (
        <Alerte ton="danger">{vue.error.message}</Alerte>
      ) : !vue.data.formulaire && !vue.data.questionnaire ? (
        <Alerte ton="attention" titre="Aucun questionnaire rattaché">Votre formateur n'a pas encore de modèle pour cette évaluation ; il en est informé.</Alerte>
      ) : (
        <>
          {envoi.error && <div className="mb-5"><Alerte ton="danger">{envoi.error.message}</Alerte></div>}
          <Formulaire vue={vue.data} enCours={envoi.isPending} erreurs={erreursChamps} envoyer={(reponses) => envoi.mutate(reponses)} />
        </>
      )}
    </Modale>
  );
}

/** Les questionnaires de l'apprenant connecté, avec leur état : il répond depuis son espace. */
export function Questionnaires({ d, stagiaireId, types }: { d: Dossier; stagiaireId: string; types: TypeQuestionnaire[] }) {
  const [ouvert, setOuvert] = useState<TypeQuestionnaire | null>(null);
  const lignes = types
    .map((type) => ({ type, def: DEFINITIONS[type], etat: d.questionnaires_etat.find((q) => q.type === type && q.stagiaire_id === stagiaireId) }))
    .filter((l) => l.etat !== undefined);
  if (lignes.length === 0) return <Alerte>Aucun questionnaire n'est ouvert pour l'instant.</Alerte>;

  return (
    <Carte>
      <ul className="divide-y divide-trait">
        {lignes.map(({ type, def, etat }) => {
          const evaluation = d.evaluations.find((e) => e.type === type && e.stagiaire_id === stagiaireId);
          const fait = etat!.valide;
          const aSigner = !fait && evaluation !== undefined && type === "acquis";
          return (
            <li key={type} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-start gap-3">
                {fait ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-valide" aria-hidden /> : <ClipboardList className="mt-0.5 size-5 shrink-0 text-encre-3" aria-hidden />}
                <div className="min-w-0">
                  <p className="font-medium">{def.libelle}</p>
                  <p className="text-[13px] text-encre-2">
                    {evaluation ? `Renseigné le ${dateFr(evaluation.date)}${evaluation.score !== null ? ` — ${evaluation.score} / 100` : ""}` : def.aide}
                    {aSigner && " · reste à signer dans vos documents"}
                  </p>
                </div>
              </div>
              {fait ? (
                <PastilleStatut statut="valide" libelle="Validé" />
              ) : (
                etat!.ouvert && (
                  <Bouton variante="primaire" taille="sm" onClick={() => setOuvert(type)}>
                    {evaluation ? "Modifier" : "Répondre"}
                  </Bouton>
                )
              )}
            </li>
          );
        })}
      </ul>
      {ouvert && <ModaleQuestionnaire d={d} type={ouvert} fermer={() => setOuvert(null)} />}
    </Carte>
  );
}

// ——— Formateur et organisme : suivi des envois, jamais de saisie à la place de l'apprenant ———

const ORDRE: TypeQuestionnaire[] = ["recueil", "positionnement", "acquis", "satisfaction_chaud", "satisfaction_froid"];

function fois(n: number) {
  return n <= 1 ? "" : ` (${n} fois)`;
}

function ModaleEnvoi({ d, ligne, prenom, fermer }: { d: Dossier; ligne: EtatFormulaire; prenom: string; fermer: () => void }) {
  const requetes = useQueryClient();
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const [message, setMessage] = useState("");
  const renvoi = ligne.envois > 0;
  const envoyer = useMutation({
    mutationFn: () => api.post<ResultatEnvoiFormulaire>(`/dossiers/${d.id}/formulaires/envoyer`, { stagiaire_id: ligne.stagiaire_id, type: ligne.type, message: message.trim() || undefined }),
    onSuccess: async (r) => {
      await requetes.invalidateQueries({ queryKey: ["formulaires", d.id] });
      await rafraichir();
      await navigator.clipboard?.writeText(r.lien).catch(() => undefined);
      if (r.statut_envoi === "envoye") {
        notifier("succes", `« ${ligne.libelle} » ${renvoi ? "renvoyé" : "envoyé"} à ${prenom}. Le lien personnel est aussi copié dans le presse-papiers.`);
        fermer();
      }
    },
  });
  const r = envoyer.data;

  return (
    <Modale ouverte fermer={fermer} titre={`${renvoi ? "Renvoyer" : "Envoyer"} « ${ligne.libelle} » à ${prenom}`}>
      {r && r.statut_envoi !== "envoye" ? (
        <div className="space-y-4">
          {r.statut_envoi === "echec" ? (
            <Alerte ton="danger" titre="L'e-mail n'a pas pu être expédié">
              {r.erreur_envoi || "Le serveur d'envoi a refusé le message."}
              <p className="mt-2">Le lien personnel de {prenom} a tout de même été créé et copié dans le presse-papiers : vous pouvez le lui transmettre par un autre moyen, ou lui remettre le document d'invitation (PDF).</p>
            </Alerte>
          ) : (
            <Alerte ton="attention" titre="E-mail consigné, mais non expédié">
              L'envoi d'e-mails n'est pas configuré sur la plateforme (Organisme → E-mails) : le message est consigné dans la boîte d'envoi, sans partir.
              <p className="mt-2">Le lien personnel de {prenom} est copié dans le presse-papiers : transmettez-le lui, ou remettez-lui le document d'invitation (PDF).</p>
            </Alerte>
          )}
          <p className="rounded-sm border border-trait bg-papier-2 px-3 py-2 font-mono text-[12.5px] break-all text-encre-2">{r.lien}</p>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/dossiers/${d.id}/formulaires/${ligne.stagiaire_id}/${ligne.type}/invitation`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm border border-trait-fort bg-carte px-4 text-sm font-medium hover:bg-papier-2">
              <FileText className="size-4" aria-hidden /> Document d'invitation (PDF)
            </a>
            <Bouton variante="primaire" onClick={fermer}>Fermer</Bouton>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); envoyer.mutate(); }}>
          <p className="text-sm text-encre-2">
            {prenom} reçoit un e-mail avec un lien personnel (valable 45 jours) et un document d'invitation PDF avec QR code. La page s'ouvre à son nom, sans compte : réponses, date, lieu, signature. Une fois signé, le document rejoint le dossier tout seul.
            {renvoi && " Le lien précédent cessera de fonctionner."}
          </p>
          <ZoneTexte libelle="Message personnel (facultatif)" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} aide="Ajouté au début de l'e-mail." />
          {envoyer.error && <Alerte ton="danger">{envoyer.error.message}</Alerte>}
          <Bouton type="submit" variante="primaire" icone={<Send className="size-4" aria-hidden />} enCours={envoyer.isPending}>
            {renvoi ? "Renvoyer" : "Envoyer"}
          </Bouton>
        </form>
      )}
    </Modale>
  );
}

function LigneFormulaire({ d, ligne, prenom, sansEmail }: { d: Dossier; ligne: EtatFormulaire; prenom: string; sansEmail: boolean }) {
  const [modale, setModale] = useState<"envoi" | "piece" | null>(null);
  const envoyable = ligne.ouvert && ligne.statut !== "valide" && !d.archive;
  const pastille =
    ligne.statut === "valide" ? <PastilleStatut statut="valide" libelle="Validé" />
    : ligne.statut === "en_cours" ? <PastilleStatut statut="en_attente" libelle="En cours de réponse" />
    : ligne.statut === "envoye" ? <PastilleStatut statut="en_attente" libelle="Envoyé" />
    : ligne.statut === "expire" ? <Etiquette ton="danger">Lien expiré</Etiquette>
    : <PastilleStatut statut={null} libelle="Non envoyé" />;
  const detail =
    ligne.statut === "valide" ? (ligne.signe_le ? `Signé le ${instantFr(ligne.signe_le)}` : "Pièce validée")
    : ligne.statut === "non_envoye" ? (ligne.ouvert ? "Aucun envoi pour l'instant — envoyez-le d'un clic." : `S'envoie automatiquement ${ligne.moment}.`)
    : `Envoyé le ${instantFr(ligne.envoye_le)}${fois(ligne.envois)}${ligne.statut === "expire" ? " · le lien de 45 jours a expiré : renvoyez-le" : ligne.statut === "en_cours" ? " · brouillon en cours de rédaction" : ""}`;
  const Icone = ligne.statut === "valide" ? CheckCircle2 : ligne.statut === "non_envoye" ? (ligne.ouvert ? MailX : Clock3) : Mail;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <Icone className={cx("size-4.5 shrink-0", ligne.statut === "valide" ? "text-valide" : "text-encre-3")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {ligne.libelle}
          <span className="chiffres text-[11px] font-normal text-encre-3">{ligne.code}</span>
        </p>
        <p className="text-[12.5px] text-encre-2">{detail}</p>
      </div>
      {pastille}
      <div className="flex flex-wrap gap-1">
        {ligne.invitation && (
          <a href={`/api/dossiers/${d.id}/formulaires/${ligne.stagiaire_id}/${ligne.type}/invitation`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] text-encre-2 hover:bg-papier-3 hover:text-encre" title="Document d'invitation avec QR code, à imprimer ou à transmettre">
            <FileText className="size-3.5" aria-hidden /> Invitation (PDF)
          </a>
        )}
        {ligne.statut === "valide" && ligne.piece_id && (
          <Bouton variante="discret" taille="sm" icone={<Eye className="size-3.5" aria-hidden />} onClick={() => setModale("piece")}>Voir la pièce</Bouton>
        )}
        {envoyable && (
          <Bouton variante={ligne.envois > 0 ? "secondaire" : "primaire"} taille="sm" icone={<Send className="size-3.5" aria-hidden />} disabled={sansEmail} title={sansEmail ? "Ajoutez d'abord une adresse e-mail à la fiche de l'apprenant" : undefined} onClick={() => setModale("envoi")}>
            {ligne.envois > 0 ? "Renvoyer" : "Envoyer"}
          </Bouton>
        )}
      </div>
      {modale === "envoi" && <ModaleEnvoi d={d} ligne={ligne} prenom={prenom} fermer={() => setModale(null)} />}
      {modale === "piece" && ligne.piece_id && <Apercu piece={{ id: ligne.piece_id, libelle: `${ligne.libelle} — ${prenom}` }} fermer={() => setModale(null)} />}
    </li>
  );
}

/**
 * Les cinq formulaires d'un apprenant du dossier, vus par le formateur ou l'organisme : état, envois, invitation,
 * pièce validée. L'apprenant répond et signe lui-même ; ici, on envoie, on renvoie, on consulte.
 */
export function FormulairesApprenant({ d, stagiaireId }: { d: Dossier; stagiaireId: string }) {
  const acteur = useActeur();
  const etat = useQuery({ queryKey: ["formulaires", d.id], queryFn: () => api.get<EtatFormulaire[]>(`/dossiers/${d.id}/formulaires`), enabled: acteur.role !== "apprenant" });
  const st = d.stagiaires.find((s) => s.id === stagiaireId);
  const prenom = st ? `${st.prenom} ${st.nom}` : "l'apprenant"; // nom complet, affiché dans les libellés d'envoi
  if (etat.isPending) return <p className="px-4 py-3 text-[13px] text-encre-3">Chargement des formulaires…</p>;
  if (etat.error) return <Alerte ton="danger">{etat.error.message}</Alerte>;
  const lignes = ORDRE.map((type) => etat.data.find((l) => l.stagiaire_id === stagiaireId && l.type === type)).filter((l): l is EtatFormulaire => l !== undefined);
  if (lignes.length === 0) return null;
  const valides = lignes.filter((l) => l.statut === "valide").length;

  return (
    <section aria-label={`Formulaires de ${prenom}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 pb-1">
        <h3 className="text-[13px] font-semibold text-encre-2">Formulaires de l'apprenant</h3>
        <span className="chiffres text-[12px] text-encre-3">{valides}/{lignes.length} validé(s)</span>
      </div>
      {!st?.email && !d.archive && (
        <div className="px-4 pb-2"><Alerte ton="attention">Cette fiche n'a pas d'adresse e-mail : aucun formulaire ne peut lui être envoyé. Complétez-la dans « Apprenants et entreprises ».</Alerte></div>
      )}
      <ul className="divide-y divide-trait">
        {lignes.map((l) => (
          <LigneFormulaire key={l.type} d={d} ligne={l} prenom={prenom} sansEmail={!st?.email} />
        ))}
      </ul>
    </section>
  );
}
