/** Page BPF (F-BPF-01/02), boîte d'envoi des e-mails automatiques, compte et suppression de compte (F-RGPD-01). */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Mail, Paperclip, RefreshCw } from "lucide-react";
import {
  api,
  dateFr,
  euros,
  instantFr,
  type ApercuSuppression,
  type Courrier,
  type VueBpf,
} from "../api";
import { useActeur } from "../session";
import {
  Alerte,
  Bouton,
  Carte,
  Champ,
  Chargement,
  EtatVide,
  Etiquette,
  Modale,
  Onglets,
  TitrePage,
  useNotifier,
} from "../ui/base";

const nombre = (n: number) => String(n).replace(".", ",");

export function Bpf() {
  const acteur = useActeur();
  const [exercice, setExercice] = useState<number | undefined>();
  const vue = useQuery({
    queryKey: ["bpf", exercice],
    queryFn: () => api.get<VueBpf>(`/bpf${exercice ? `?exercice=${exercice}` : ""}`),
  });
  if (vue.isPending) return <Chargement />;
  if (vue.error) return <Alerte ton="danger">{vue.error.message}</Alerte>;
  const { bpf, exercices } = vue.data;
  const t = bpf.totaux;

  return (
    <>
      <TitrePage
        titre="Bilan pédagogique et financier"
        soustitre={
          acteur.role === "admin"
            ? "Le réalisé de l'organisme, par exercice — de quoi remplir le Cerfa n° 10443."
            : "Votre réalisé, par exercice."
        }
        actions={
          <>
            {exercices.length > 1 && (
              <select
                aria-label="Exercice"
                value={bpf.exercice}
                onChange={(e) => setExercice(Number(e.target.value))}
                className="chiffres h-10 rounded-sm border border-trait-fort bg-carte px-3 text-sm"
              >
                {exercices.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            )}
            <a href={`/api/bpf/export?exercice=${bpf.exercice}`}>
              <Bouton variante="primaire" icone={<Download className="size-4" aria-hidden />}>
                Exporter (CSV)
              </Bouton>
            </a>
          </>
        }
      />
      {t.nb_actions === 0 ? (
        <EtatVide
          icone={<FileSpreadsheet className="size-8" aria-hidden />}
          titre={`Aucune action réalisée en ${bpf.exercice}`}
        >
          Une action entre au bilan de l'exercice de sa date de fin, dès que la formation est
          déclarée terminée.
        </EtatVide>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-trait bg-trait lg:grid-cols-5">
            {[
              ["Actions réalisées", String(t.nb_actions)],
              ["Stagiaires", String(t.nb_stagiaires)],
              ["Heures-stagiaires", nombre(t.heures_stagiaires)],
              ["Chiffre d'affaires HT", euros(t.montant_ht)],
              ["Dont sous-traité", euros(t.montant_sous_traite)],
            ].map(([k, v]) => (
              <div key={k} className="bg-carte p-4">
                <dt className="text-[13px] text-encre-3">{k}</dt>
                <dd className="chiffres mt-1 font-display text-2xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <Tableau
            titre="Par origine du financement"
            entetes={["Origine", "Actions", "Stagiaires", "Heures-stagiaires", "Produits HT"]}
            lignes={bpf.par_financement.map((f) => [
              f.libelle,
              f.nb_actions,
              f.nb_stagiaires,
              nombre(f.heures_stagiaires),
              euros(f.montant_ht),
            ])}
          />
          {acteur.role === "admin" && (
            <Tableau
              titre="Par formateur"
              entetes={["Formateur", "Actions", "Heures dispensées", "CA HT", "Sous-traité"]}
              lignes={bpf.par_formateur.map((f) => [
                f.formateur_nom,
                f.nb_actions,
                nombre(f.heures_dispensees),
                euros(f.montant_ht),
                euros(f.montant_sous_traite),
              ])}
            />
          )}
          <Tableau
            titre="Détail des actions"
            entetes={["Dossier", "Formation", "Période", "Stagiaires", "CA HT"]}
            lignes={bpf.lignes.map((l) => [
              l.dossier_reference,
              l.formation_titre,
              `${dateFr(l.formation_date_debut)} → ${dateFr(l.formation_date_fin)}`,
              l.nb_stagiaires,
              euros(l.montant_ht),
            ])}
          />
        </div>
      )}
    </>
  );
}

function Tableau({
  titre,
  entetes,
  lignes,
}: {
  titre: string;
  entetes: string[];
  lignes: Array<Array<string | number>>;
}) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">{titre}</h2>
      <Carte className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-trait text-xs tracking-wide text-encre-3 uppercase">
              {entetes.map((e, i) => (
                <th
                  key={e}
                  className={`px-4 py-2.5 font-semibold ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {e}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-trait">
            {lignes.map((l, i) => (
              <tr key={i}>
                {l.map((c, j) => (
                  <td
                    key={j}
                    className={`px-4 py-2.5 ${j === 0 ? "font-medium" : "chiffres text-right text-encre-2"}`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Carte>
    </section>
  );
}

const TYPES_COURRIER: Record<string, string> = {
  invitation_apprenant: "Invitation",
  relance_apprenant: "Relance",
  candidature_soumise: "Candidature",
  candidature_decision: "Décision",
  demande_validation: "Demande de validation",
  renvoi_brouillon: "Renvoi",
  pieces_financement: "Pièces du financement",
  odm: "Ordre de mission",
  elements_pedagogiques: "Convocation",
  satisfaction_froid: "Satisfaction à froid",
  formulaire_recueil: "Formulaire : Recueil des besoins",
  formulaire_positionnement: "Formulaire : Test de positionnement",
  formulaire_acquis: "Formulaire : Évaluation des acquis",
  formulaire_satisfaction_chaud: "Formulaire : Satisfaction à chaud",
  formulaire_satisfaction_froid: "Formulaire : Satisfaction à froid",
  test_smtp: "E-mail de test",
};
/** Les types dérivés (`formulaire_<type>_confirmation`, `formulaire_<type>_recu`) sont reconnus par leur suffixe. */
const libelleType = (type: string) =>
  TYPES_COURRIER[type] ??
  (type.startsWith("formulaire_") && type.endsWith("_confirmation")
    ? "Confirmation formulaire"
    : type.startsWith("formulaire_") && type.endsWith("_recu")
      ? "Formulaire signé reçu"
      : type);

const STATUTS_COURRIER: Record<string, { libelle: string; ton: "neutre" | "accent" | "danger" }> = {
  journalise: { libelle: "Journalisé", ton: "neutre" },
  envoye: { libelle: "Envoyé", ton: "accent" },
  echec: { libelle: "Échec", ton: "danger" },
};

export function Courriers() {
  const acteur = useActeur();
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<"tous" | "echecs">("tous");
  const courriers = useQuery({
    queryKey: ["courriers"],
    queryFn: () => api.get<Courrier[]>("/courriers"),
  });
  const renvoyer = useMutation({
    mutationFn: (id: string) =>
      api.post<{ statut: Courrier["statut"]; erreur: string }>(`/courriers/${id}/renvoyer`),
    onSuccess: async (r) => {
      await requetes.invalidateQueries({ queryKey: ["courriers"] });
      if (r.statut === "envoye") notifier("succes", "E-mail renvoyé.");
      else if (r.statut === "journalise")
        notifier(
          "succes",
          "E-mail consigné dans la boîte d'envoi (l'envoi réel n'est pas activé).",
        );
      else notifier("danger", `Le renvoi a échoué : ${r.erreur || "raison inconnue"}`);
      setOuvert(null);
    },
    onError: (e) => notifier("danger", e.message),
  });
  if (courriers.isPending) return <Chargement />;
  if (courriers.error) return <Alerte ton="danger">{courriers.error.message}</Alerte>;
  const local = courriers.data.every((c) => c.statut === "journalise");
  const echecs = courriers.data.filter((c) => c.statut === "echec").length;
  const visibles =
    filtre === "echecs" ? courriers.data.filter((c) => c.statut === "echec") : courriers.data;
  const detail = courriers.data.find((c) => c.id === ouvert) ?? null;

  return (
    <>
      <TitrePage
        titre="Boîte d'envoi"
        soustitre="Tous les e-mails automatiques de la plateforme, tels qu'ils ont été rédigés — pour la traçabilité, et pour vérifier ce que reçoivent vos interlocuteurs."
      />
      {local && courriers.data.length > 0 && (
        <div className="mb-5">
          <Alerte titre="Mode « boîte locale »">
            Aucun e-mail n'est réellement expédié : ils sont seulement consignés ici. L'envoi réel
            se règle dans{" "}
            {acteur.role === "admin" ? (
              <Link
                to="/admin/organisme"
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                Organisme → E-mails
              </Link>
            ) : (
              "Organisme → E-mails"
            )}{" "}
            (administrateur).
          </Alerte>
        </div>
      )}
      {echecs > 0 && filtre === "tous" && (
        <div className="mb-5">
          <Alerte
            ton="attention"
            titre={`${echecs} e-mail${echecs > 1 ? "s" : ""} n'${echecs > 1 ? "ont" : "a"} pas pu partir`}
          >
            Ouvrez-le pour lire la cause, corrigez les réglages d'envoi si besoin, puis « Renvoyer
            ».
          </Alerte>
        </div>
      )}
      {courriers.data.length > 0 && (
        <Onglets
          actif={filtre}
          choisir={setFiltre}
          onglets={[
            { cle: "tous", libelle: "Tous", compteur: String(courriers.data.length) },
            { cle: "echecs", libelle: "Échecs", compteur: String(echecs) },
          ]}
        />
      )}
      {courriers.data.length === 0 ? (
        <EtatVide
          icone={<Mail className="size-8" aria-hidden />}
          titre="Aucun e-mail pour l'instant"
        />
      ) : visibles.length === 0 ? (
        <EtatVide icone={<Mail className="size-8" aria-hidden />} titre="Aucun échec d'envoi">
          Tous les e-mails sont partis ou ont été consignés.
        </EtatVide>
      ) : (
        <Carte>
          <ul className="divide-y divide-trait">
            {visibles.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOuvert(c.id)}
                  className="grid w-full gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-papier-2 sm:grid-cols-[minmax(150px,auto)_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Etiquette ton={STATUTS_COURRIER[c.statut]?.ton ?? "neutre"}>
                      {STATUTS_COURRIER[c.statut]?.libelle ?? c.statut}
                    </Etiquette>
                    <span className="text-[12px] text-encre-2">{libelleType(c.type)}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.sujet}</span>
                    <span className="block truncate text-[13px] text-encre-2">
                      À : {c.destinataire}
                    </span>
                  </span>
                  <span className="chiffres flex items-center gap-3 text-xs text-encre-3">
                    {(c.pieces_jointes as unknown[]).length > 0 && (
                      <span className="flex items-center gap-1">
                        <Paperclip className="size-3.5" aria-hidden />
                        {(c.pieces_jointes as unknown[]).length}
                      </span>
                    )}
                    {instantFr(c.cree_le)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Carte>
      )}
      <Modale
        ouverte={detail !== null}
        fermer={() => setOuvert(null)}
        titre={detail?.sujet ?? ""}
        large
      >
        {detail && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="flex flex-wrap items-center gap-2 text-sm text-encre-2">
                <Etiquette ton={STATUTS_COURRIER[detail.statut]?.ton ?? "neutre"}>
                  {STATUTS_COURRIER[detail.statut]?.libelle ?? detail.statut}
                </Etiquette>
                <span>
                  {libelleType(detail.type)} · À : {detail.destinataire} ·{" "}
                  {instantFr(detail.cree_le)}
                </span>
              </p>
              <Bouton
                taille="sm"
                variante={detail.statut === "echec" ? "primaire" : "secondaire"}
                icone={<RefreshCw className="size-3.5" aria-hidden />}
                enCours={renvoyer.isPending}
                onClick={() => renvoyer.mutate(detail.id)}
              >
                Renvoyer
              </Bouton>
            </div>
            {detail.statut === "echec" && (
              <div className="mb-3">
                <Alerte ton="danger" titre="Cet e-mail n'a pas pu être envoyé">
                  <p className="whitespace-pre-line">
                    {detail.erreur || "Le serveur d'envoi n'a pas donné de raison."}
                  </p>
                </Alerte>
              </div>
            )}
            <iframe
              title={detail.sujet}
              sandbox=""
              srcDoc={detail.corps_html}
              className="h-[55dvh] w-full rounded-md border border-trait bg-carte"
            />
            {(detail.pieces_jointes as Array<{ nom: string }>).length > 0 && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-encre-2">
                <Paperclip className="size-3.5" aria-hidden />
                {(detail.pieces_jointes as Array<{ nom: string }>).map((p) => p.nom).join(" · ")}
              </p>
            )}
          </>
        )}
      </Modale>
    </>
  );
}

export function Compte() {
  const acteur = useActeur();
  const [v, setV] = useState({ ancien: "", nouveau: "" });
  const [suppression, setSuppression] = useState(false);
  const changer = useMutation({
    mutationFn: () => api.post("/compte/mot-de-passe", v),
    onSuccess: () => location.assign("/connexion"),
  });

  return (
    <div className="mx-auto max-w-xl">
      <TitrePage titre="Mon compte" soustitre={`${acteur.nom} · ${acteur.email}`} />
      <Carte className="p-5">
        <h2 className="text-base font-semibold">Changer de mot de passe</h2>
        <p className="mt-0.5 text-[13px] text-encre-3">
          Toutes vos sessions ouvertes seront fermées ; vous devrez vous reconnecter.
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            changer.mutate();
          }}
        >
          <Champ
            libelle="Mot de passe actuel"
            type="password"
            autoComplete="current-password"
            required
            value={v.ancien}
            onChange={(e) => setV({ ...v, ancien: e.target.value })}
          />
          <Champ
            libelle="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            aide="Dix caractères au minimum."
            value={v.nouveau}
            onChange={(e) => setV({ ...v, nouveau: e.target.value })}
          />
          {changer.error && <Alerte ton="danger">{changer.error.message}</Alerte>}
          <Bouton type="submit" enCours={changer.isPending}>
            Changer mon mot de passe
          </Bouton>
        </form>
      </Carte>

      {acteur.role === "formateur" && (
        <Carte className="mt-6 border-danger/30 p-5">
          <h2 className="text-base font-semibold">Supprimer mon compte</h2>
          <p className="mt-1 text-sm text-encre-2">
            Vos données personnelles sont effacées. Les dossiers de formation que vous avez
            instruits sont conservés par l'organisme, comme la loi l'y oblige.
          </p>
          <Bouton variante="secondaire" className="mt-4" onClick={() => setSuppression(true)}>
            Voir ce qui sera supprimé…
          </Bouton>
        </Carte>
      )}
      <Modale
        ouverte={suppression}
        fermer={() => setSuppression(false)}
        titre="Supprimer mon compte"
      >
        {suppression && <Suppression />}
      </Modale>
    </div>
  );
}

function Suppression() {
  const apercu = useQuery({
    queryKey: ["suppression"],
    queryFn: () => api.get<ApercuSuppression>("/compte/suppression"),
    staleTime: 0,
  });
  const [v, setV] = useState({ phrase: "", mot_de_passe: "" });
  const supprimer = useMutation({
    mutationFn: () => api.post("/compte/suppression", v),
    onSuccess: () => location.assign("/connexion"),
  });
  if (apercu.isPending) return <Chargement />;
  if (apercu.error) return <Alerte ton="danger">{apercu.error.message}</Alerte>;
  const a = apercu.data;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        supprimer.mutate();
      }}
    >
      <Alerte ton="danger" titre="Cette action est définitive">
        {a.avertissement || "Votre compte ne pourra pas être rétabli."}
      </Alerte>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-danger">Sera supprimé</p>
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-encre-2">
            {a.supprime.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-valide">
            Sera conservé par l'organisme
          </p>
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-encre-2">
            {a.conserve.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <Champ
        libelle={`Pour confirmer, saisissez : ${a.phrase}`}
        required
        value={v.phrase}
        onChange={(e) => setV({ ...v, phrase: e.target.value })}
        autoComplete="off"
      />
      <Champ
        libelle="Votre mot de passe"
        type="password"
        required
        autoComplete="current-password"
        value={v.mot_de_passe}
        onChange={(e) => setV({ ...v, mot_de_passe: e.target.value })}
      />
      {supprimer.error && <Alerte ton="danger">{supprimer.error.message}</Alerte>}
      <Bouton
        type="submit"
        variante="danger"
        disabled={v.phrase.trim() !== a.phrase || !v.mot_de_passe}
        enCours={supprimer.isPending}
      >
        Supprimer définitivement mon compte
      </Bouton>
    </form>
  );
}
