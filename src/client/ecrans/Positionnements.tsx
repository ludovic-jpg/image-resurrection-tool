/**
 * Positionnement avant dossier (« Modification 1 », 23/09/2026).
 *  - Côté formateur : inviter un apprenant sur un parcours (e-mail automatique), suivre, relancer, télécharger le PDF signé.
 *  - Côté apprenant : une page dédiée, ouverte par son lien personnel, sans compte à créer : A. recueil des besoins,
 *    B. test de positionnement, date, signature tracée ; « enregistrer et reprendre plus tard » à tout moment.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  ClipboardList,
  Download,
  Mail,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import type { Champ as ChampFormulaire } from "@/domaine/formulaires/definitions";
import {
  api,
  ErreurApi,
  instantFr,
  type Formation,
  type LignePositionnement,
  type PositionnementPublic,
  type Stagiaire,
} from "../api";
import {
  Alerte,
  Bouton,
  Carte,
  Champ,
  Chargement,
  cx,
  EtatVide,
  Etiquette,
  Modale,
  Onglets,
  PastilleStatut,
  Selecteur,
  TitrePage,
  ZoneTexte,
  useNotifier,
} from "../ui/base";
import { ZoneDeTrace } from "../ui/Signature";

// ——— Formateur ———

export function InviterPositionnement({
  formationId,
  stagiaireId,
  termine,
}: {
  formationId?: string;
  stagiaireId?: string;
  termine: () => void;
}) {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const stagiaires = useQuery({
    queryKey: ["stagiaires"],
    queryFn: () => api.get<Stagiaire[]>("/stagiaires"),
  });
  const formations = useQuery({
    queryKey: ["formations", "actives"],
    queryFn: () => api.get<Formation[]>("/formations"),
  });
  const [v, setV] = useState({
    stagiaire_id: stagiaireId ?? "",
    formation_id: formationId ?? "",
    message: "",
  });
  const inviter = useMutation({
    mutationFn: () => api.post<{ lien: string; test_cree: boolean }>("/positionnements", v),
    onSuccess: async (r) => {
      await requetes.invalidateQueries({ queryKey: ["positionnements"] });
      await requetes.invalidateQueries({ queryKey: ["coffre-parcours"] });
      await navigator.clipboard?.writeText(r.lien).catch(() => undefined);
      notifier(
        "succes",
        "Invitation envoyée par e-mail. Le lien personnel est aussi copié dans le presse-papiers.",
      );
      termine();
    },
  });
  if (stagiaires.isPending || formations.isPending) return <Chargement />;
  const choisi = stagiaires.data?.find((s) => s.id === v.stagiaire_id);
  // Le serveur refuse l'invitation tant que le parcours n'a pas de test de positionnement : on renvoie vers la fiche.
  const sansTest =
    inviter.error !== null &&
    /test de positionnement/i.test(inviter.error.message) &&
    v.formation_id !== "";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        inviter.mutate();
      }}
    >
      <Selecteur
        libelle="Apprenant"
        value={v.stagiaire_id}
        onChange={(e) => setV({ ...v, stagiaire_id: e.target.value })}
      >
        <option value="">— Choisir —</option>
        {stagiaires.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.stagiaire_prenom} {s.stagiaire_nom}
            {s.stagiaire_email ? ` — ${s.stagiaire_email}` : " (sans e-mail)"}
          </option>
        ))}
      </Selecteur>
      {choisi && !choisi.stagiaire_email && (
        <Alerte ton="attention">
          Cette fiche n'a pas d'adresse e-mail : complétez-la dans « Apprenants et entreprises ».
        </Alerte>
      )}
      <Selecteur
        libelle="Parcours de formation"
        value={v.formation_id}
        onChange={(e) => setV({ ...v, formation_id: e.target.value })}
      >
        <option value="">— Choisir —</option>
        {formations.data?.map((f) => (
          <option key={f.id} value={f.id}>
            {f.formation_titre}
          </option>
        ))}
      </Selecteur>
      <ZoneTexte
        libelle="Message personnel (facultatif)"
        rows={3}
        maxLength={1000}
        value={v.message}
        onChange={(e) => setV({ ...v, message: e.target.value })}
      />
      <p className="text-[13px] text-encre-2">
        L'apprenant reçoit un e-mail avec un lien personnel (30 jours) vers sa page : recueil des
        besoins, test de positionnement du parcours, date et signature. Le PDF signé sera
        téléchargeable par lui, par vous et par l'organisme.
      </p>
      {inviter.error && (
        <Alerte
          ton="danger"
          titre={sansTest ? "Pas encore de test de positionnement sur ce parcours" : undefined}
        >
          {inviter.error.message}
          {sansTest && (
            <p className="mt-2">
              <Link
                to="/formations/$id"
                params={{ id: v.formation_id }}
                className="font-semibold underline underline-offset-4"
              >
                Ouvrir la fiche formation
              </Link>{" "}
              — étape 3 du kit pédagogique : « Générer le test de positionnement ».
            </p>
          )}
        </Alerte>
      )}
      <Bouton
        type="submit"
        variante="primaire"
        icone={<Send className="size-4" aria-hidden />}
        disabled={!v.stagiaire_id || !v.formation_id}
        enCours={inviter.isPending}
      >
        Envoyer l'invitation
      </Bouton>
    </form>
  );
}

const STATUTS: Record<string, { libelle: string; ton: "neutre" | "attente" | "accent" }> = {
  envoye: { libelle: "Envoyé", ton: "neutre" },
  en_cours: { libelle: "En cours", ton: "attente" },
  complet: { libelle: "Complet et signé", ton: "accent" },
};

export function Positionnements() {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const [vue, setVue] = useState<"actifs" | "archives">("actifs");
  const [inviter, setInviter] = useState(false);
  const liste = useQuery({
    queryKey: ["positionnements", vue],
    queryFn: () =>
      api.get<LignePositionnement[]>(`/positionnements${vue === "archives" ? "?archives=1" : ""}`),
  });
  const relancer = useMutation({
    mutationFn: (id: string) => api.post<{ lien: string }>(`/positionnements/${id}/relancer`),
    onSuccess: async () => {
      await requetes.invalidateQueries({ queryKey: ["positionnements"] });
      notifier("succes", "Un nouveau lien a été envoyé (l'ancien ne fonctionne plus).");
    },
    onError: (e) => notifier("danger", e.message),
  });
  const archiver = useMutation({
    mutationFn: (x: { id: string; archiver: boolean }) =>
      api.post(`/positionnements/${x.id}/archiver`, { archiver: x.archiver }),
    onSuccess: () => requetes.invalidateQueries({ queryKey: ["positionnements"] }),
  });
  return (
    <>
      <TitrePage
        titre="Positionnements"
        soustitre="Invitez un apprenant à se positionner sur un parcours, avant même d'ouvrir un dossier : recueil des besoins, test de positionnement et signature, en ligne. À la création du dossier, ses réponses signées sont reprises."
        actions={
          <Bouton
            variante="primaire"
            icone={<UserPlus className="size-4" aria-hidden />}
            onClick={() => setInviter(true)}
          >
            Inviter à se positionner
          </Bouton>
        }
      />
      <Onglets
        actif={vue}
        choisir={setVue}
        onglets={[
          { cle: "actifs", libelle: "En cours et signés" },
          { cle: "archives", libelle: "Archivés" },
        ]}
      />
      {liste.isPending ? (
        <Chargement />
      ) : liste.data?.length ? (
        <Carte>
          <ul className="divide-y divide-trait">
            {liste.data.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {p.apprenant}{" "}
                    <span className="font-normal text-encre-3">— {p.formation_titre}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-encre-2">
                    <Etiquette ton={STATUTS[p.statut]!.ton}>{STATUTS[p.statut]!.libelle}</Etiquette>
                    {p.expire && <Etiquette ton="danger">Lien expiré</Etiquette>}
                    <span>
                      {p.signe_le
                        ? `Signé le ${instantFr(p.signe_le)}`
                        : `Envoyé le ${instantFr(p.envoye_le)}`}
                    </span>
                    {p.score !== null && <span className="chiffres">· score {p.score}/100</span>}
                    {p.entreprise && <span>· {p.entreprise}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.pdf && (
                    <a
                      href={`/api/positionnements/${p.id}/pdf`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-trait-fort bg-carte px-3 text-[13px] font-medium hover:bg-papier-2"
                    >
                      <Download className="size-3.5" aria-hidden /> PDF signé
                    </a>
                  )}
                  {p.statut !== "complet" && vue === "actifs" && (
                    <Bouton
                      taille="sm"
                      icone={<Mail className="size-3.5" aria-hidden />}
                      enCours={relancer.isPending && relancer.variables === p.id}
                      onClick={() => relancer.mutate(p.id)}
                    >
                      Relancer
                    </Bouton>
                  )}
                  {vue === "actifs" ? (
                    <Bouton
                      taille="sm"
                      variante="discret"
                      aria-label="Archiver"
                      icone={<Archive className="size-3.5" aria-hidden />}
                      onClick={() => archiver.mutate({ id: p.id, archiver: true })}
                    />
                  ) : (
                    <Bouton
                      taille="sm"
                      icone={<RotateCcw className="size-3.5" aria-hidden />}
                      onClick={() => archiver.mutate({ id: p.id, archiver: false })}
                    >
                      Restaurer
                    </Bouton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Carte>
      ) : (
        <EtatVide
          icone={<ClipboardList className="size-8" aria-hidden />}
          titre={
            vue === "archives"
              ? "Aucun positionnement archivé"
              : "Aucun positionnement pour l'instant"
          }
          action={
            vue === "actifs" ? (
              <Bouton
                variante="primaire"
                icone={<Plus className="size-4" aria-hidden />}
                onClick={() => setInviter(true)}
              >
                Inviter un apprenant
              </Bouton>
            ) : undefined
          }
        >
          Le positionnement à l'entrée en formation est exigé par Qualiopi (indicateur n° 8) ; le
          recueil des besoins aussi (n° 4).
        </EtatVide>
      )}
      <Modale ouverte={inviter} fermer={() => setInviter(false)} titre="Inviter à se positionner">
        {inviter && <InviterPositionnement termine={() => setInviter(false)} />}
      </Modale>
    </>
  );
}

// ——— Apprenant : page publique ———

export function PagePositionnement() {
  const { jeton } = useParams({ from: "/positionnement/$jeton" });
  const vue = useQuery({
    queryKey: ["positionnement-public", jeton],
    queryFn: () => api.get<PositionnementPublic>(`/public/positionnement/${jeton}`),
    retry: false,
  });
  return (
    <div className="min-h-dvh bg-papier px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        {vue.isPending ? (
          <Chargement />
        ) : vue.error ? (
          <Alerte ton="danger" titre="Lien indisponible">
            {vue.error.message}
          </Alerte>
        ) : (
          <Formulaire jeton={jeton} p={vue.data} />
        )}
      </div>
    </div>
  );
}

function Formulaire({ jeton, p }: { jeton: string; p: PositionnementPublic }) {
  const requetes = useQueryClient();
  const [recueil, setRecueil] = useState<Record<string, string>>(p.brouillon?.recueil ?? {});
  const [reponses, setReponses] = useState<Array<number | null>>(
    p.brouillon?.reponses?.length
      ? p.brouillon.reponses
      : (p.questionnaire?.questions.map(() => null) ?? []),
  );
  const [date, setDate] = useState(p.brouillon?.date || p.aujourdhui);
  const [trace, setTrace] = useState<string | null>(null);
  const [lieu, setLieu] = useState("");
  const [consentement, setConsentement] = useState(false);
  const [enregistreLe, setEnregistreLe] = useState<string | null>(null);
  const modifie = useRef(false);

  const brouillon = useMutation({
    mutationFn: () =>
      api.put<{ enregistre_le: string }>(`/public/positionnement/${jeton}/brouillon`, {
        recueil,
        reponses,
        date,
      }),
    onSuccess: (r) => {
      setEnregistreLe(r.enregistre_le);
      modifie.current = false;
    },
  });
  const signer = useMutation({
    mutationFn: () =>
      api.post(`/public/positionnement/${jeton}/signer`, {
        recueil,
        reponses,
        date,
        trace_png: trace,
        lieu,
        consentement,
      }),
    onSuccess: () => requetes.invalidateQueries({ queryKey: ["positionnement-public", jeton] }),
  });

  // Enregistrement automatique toutes les 30 secondes s'il y a du nouveau : rien n'est perdu.
  useEffect(() => {
    if (p.statut === "complet") return;
    const minuterie = setInterval(() => {
      if (modifie.current && !brouillon.isPending) brouillon.mutate();
    }, 30_000);
    return () => clearInterval(minuterie);
  }, [p.statut, brouillon]);
  const toucher = () => {
    modifie.current = true;
  };

  const entete = (
    <header className="mb-6">
      <p
        className="flex items-center gap-2 text-sm font-semibold tracking-wide"
        style={{ color: p.organisme.couleur }}
      >
        <ShieldCheck className="size-4" aria-hidden /> {p.organisme.nom}
      </p>
      <h1 className="mt-3 text-[26px] leading-tight font-semibold">Mon positionnement</h1>
      <p className="mt-1 text-encre-2">
        Formation : <strong>{p.formation_titre}</strong>
        {p.formateur ? ` — avec ${p.formateur}` : ""}
      </p>
    </header>
  );

  if (p.statut === "complet") {
    return (
      <>
        {entete}
        <Alerte ton="succes" titre="Votre positionnement est complet et signé">
          Merci. Votre formateur l'a reçu ; il s'en servira pour adapter la formation. Le PDF de vos
          réponses vous a aussi été envoyé par e-mail.
        </Alerte>
        <Carte className="mt-6 p-5">
          <p className="text-sm text-encre-2">
            {p.apprenant.prenom} {p.apprenant.nom} · {p.apprenant.email}
          </p>
          <p className="mt-1 text-sm text-encre-2">
            Signé {p.reponses_signees?.lieu ? `à ${p.reponses_signees.lieu}` : ""} le{" "}
            {instantFr(p.reponses_signees?.signe_le)}
          </p>
          {p.pdf && (
            <a
              href={`/api/public/positionnement/${jeton}/pdf`}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-sur-accent hover:bg-accent-fort"
            >
              <Download className="size-4" aria-hidden /> Télécharger mon positionnement (PDF)
            </a>
          )}
        </Carte>
      </>
    );
  }

  const champs = p.recueil.champs as unknown as ChampFormulaire[];
  const erreursServeur = signer.error instanceof ErreurApi ? signer.error.details : null;
  const erreursChamps = (erreursServeur?.champs ?? {}) as Record<string, string>;
  const erreursListe = Array.isArray(erreursServeur?.erreurs)
    ? (erreursServeur.erreurs as string[])
    : [];
  const recueilComplet = champs.every((c) => !c.requis || (recueil[c.id] ?? "").trim() !== "");
  const testComplet = reponses.every((r) => r !== null);
  const pret =
    recueilComplet &&
    testComplet &&
    trace !== null &&
    lieu.trim() !== "" &&
    consentement &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <>
      {entete}
      {p.message && (
        <div className="mb-5">
          <Alerte titre={`Message de ${p.formateur || "votre formateur"}`}>{p.message}</Alerte>
        </div>
      )}
      <Carte className="mb-6 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ
            libelle="Nom et prénom"
            value={`${p.apprenant.prenom} ${p.apprenant.nom}`}
            disabled
          />
          <Champ libelle="Adresse e-mail" value={p.apprenant.email} disabled />
        </div>
        <p className="mt-3 text-[13px] text-encre-3">
          Une erreur dans votre nom ou votre adresse ? Signalez-la à votre formateur.
        </p>
      </Carte>

      <section aria-labelledby="partie-a" className="mb-6">
        <h2 id="partie-a" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <span
            className={cx(
              "grid size-7 place-items-center rounded-full text-sm text-sur-accent",
              recueilComplet ? "bg-valide" : "bg-accent",
            )}
          >
            {recueilComplet ? <CheckCircle2 className="size-4" aria-hidden /> : "A"}
          </span>
          Recueil de vos besoins
        </h2>
        <Carte className="space-y-5 p-5">
          <p className="text-sm text-encre-2">{p.recueil.introduction}</p>
          {champs.map((c) => (
            <fieldset key={c.id} className="min-w-0">
              <legend className="mb-2 text-sm font-medium">
                {c.libelle}
                {c.requis && <span className="text-danger"> *</span>}
              </legend>
              {c.type === "choix" ? (
                <div className="flex flex-wrap gap-2">
                  {c.options?.map((o) => (
                    <label
                      key={o}
                      className={cx(
                        "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                        recueil[c.id] === o
                          ? "border-accent bg-accent-doux font-medium text-accent-fort"
                          : "border-trait-fort bg-carte text-encre-2 hover:border-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name={c.id}
                        value={o}
                        className="sr-only"
                        checked={recueil[c.id] === o}
                        onChange={() => {
                          setRecueil({ ...recueil, [c.id]: o });
                          toucher();
                        }}
                      />
                      {o}
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  rows={c.type === "texte_long" ? 3 : 1}
                  aria-label={c.libelle}
                  value={recueil[c.id] ?? ""}
                  onChange={(e) => {
                    setRecueil({ ...recueil, [c.id]: e.target.value });
                    toucher();
                  }}
                  className="w-full rounded-sm border border-trait-fort bg-carte px-3 py-2.5 text-sm leading-relaxed focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
                />
              )}
              {erreursChamps[c.id] && (
                <p className="mt-1.5 text-[13px] text-danger">{erreursChamps[c.id]}</p>
              )}
            </fieldset>
          ))}
        </Carte>
      </section>

      {p.questionnaire && (
        <section aria-labelledby="partie-b" className="mb-6">
          <h2 id="partie-b" className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <span
              className={cx(
                "grid size-7 place-items-center rounded-full text-sm text-sur-accent",
                testComplet ? "bg-valide" : "bg-accent",
              )}
            >
              {testComplet ? <CheckCircle2 className="size-4" aria-hidden /> : "B"}
            </span>
            Test de positionnement
          </h2>
          <Carte className="space-y-6 p-5">
            <p className="text-sm text-encre-2">
              {p.questionnaire.titre} — répondez spontanément : il ne s'agit pas d'un examen, mais
              de situer votre point de départ.
            </p>
            {p.questionnaire.questions.map((q, i) => (
              <fieldset key={i} className="min-w-0">
                <legend className="mb-2.5 text-sm font-medium">
                  <span className="chiffres mr-2 text-accent">{i + 1}.</span>
                  {q.enonce}
                </legend>
                <div className="space-y-1.5">
                  {q.propositions.map((prop, j) => (
                    <label
                      key={j}
                      className={cx(
                        "flex cursor-pointer items-start gap-3 rounded-sm border px-3.5 py-2.5 text-sm transition-colors",
                        reponses[i] === j
                          ? "border-accent bg-accent-doux"
                          : "border-trait bg-carte hover:border-trait-fort",
                      )}
                    >
                      <input
                        type="radio"
                        name={`q${i}`}
                        checked={reponses[i] === j}
                        onChange={() => {
                          setReponses(reponses.map((r, k) => (k === i ? j : r)));
                          toucher();
                        }}
                        className="mt-0.5 size-4 shrink-0 accent-(--color-accent)"
                      />
                      {prop}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </Carte>
        </section>
      )}

      <section aria-labelledby="partie-signature" className="mb-6">
        <h2 id="partie-signature" className="mb-3 text-lg font-semibold">
          Date et signature
        </h2>
        <Carte className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              libelle="Date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                toucher();
              }}
              required
            />
            <Champ
              libelle="Fait à"
              placeholder="Ville"
              value={lieu}
              maxLength={120}
              onChange={(e) => setLieu(e.target.value)}
              required
            />
          </div>
          <ZoneDeTrace surChangement={setTrace} />
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-trait bg-papier-2 p-3 text-[13.5px] leading-relaxed text-encre-2">
            <input
              type="checkbox"
              checked={consentement}
              onChange={(e) => setConsentement(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-(--color-accent)"
            />
            <span>
              Je certifie l'exactitude de mes réponses et je signe électroniquement mon
              positionnement. La date et l'heure de ma signature sont enregistrées avec une
              empreinte de mes réponses.
            </span>
          </label>
        </Carte>
      </section>

      {(erreursListe.length > 0 || (signer.error && !erreursServeur)) && (
        <div className="mb-4">
          <Alerte ton="danger" titre={signer.error!.message}>
            {erreursListe.length > 0 && (
              <ul className="list-disc pl-4">
                {erreursListe.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </Alerte>
        </div>
      )}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-trait bg-papier/95 px-4 py-3 backdrop-blur">
        <Bouton
          icone={<Save className="size-4" aria-hidden />}
          enCours={brouillon.isPending}
          onClick={() => brouillon.mutate()}
        >
          Enregistrer et reprendre plus tard
        </Bouton>
        <Bouton
          variante="primaire"
          icone={<Send className="size-4" aria-hidden />}
          disabled={!pret}
          enCours={signer.isPending}
          onClick={() => signer.mutate()}
          title={
            pret
              ? undefined
              : "Complétez A, B, la date, le lieu, la signature et la case de certification"
          }
        >
          Signer et envoyer
        </Bouton>
        {enregistreLe && (
          <span className="text-[13px] text-encre-3">
            Enregistré le {instantFr(enregistreLe)} — vous pouvez fermer la page et revenir par le
            même lien.
          </span>
        )}
        {brouillon.error && (
          <span className="text-[13px] text-danger">{brouillon.error.message}</span>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-encre-3">
        <PastilleStatut statut={null} libelle="Lien personnel — ne le transférez pas" />
      </p>
    </>
  );
}
