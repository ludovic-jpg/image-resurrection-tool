/**
 * Page publique d'un formulaire apprenant (version 7) : recueil des besoins, test de positionnement, évaluation des
 * acquis, satisfaction à chaud ou à froid. L'apprenant l'ouvre par son lien personnel (e-mail ou QR code), souvent sur
 * un téléphone, sans compte : il répond, enregistre s'il veut reprendre plus tard, date, signe — et c'est validé.
 * Le brouillon vit sur le serveur (aucun stockage local) : on peut changer d'appareil en cours de route.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Download,
  FileText,
  GraduationCap,
  Link2Off,
  LockKeyhole,
  Mail,
  PenLine,
  Save,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { Champ as ChampFormulaire } from "@/domaine/formulaires/definitions";
import { api, dateFr, ErreurApi, instantFr, type FormulairePublic } from "../api";
import { Alerte, Bouton, Carte, Champ, Chargement, cx } from "../ui/base";
import { ZoneDeTrace } from "../ui/Signature";

const NOTES = [1, 2, 3, 4, 5] as const;
const LEGENDE_NOTES: Record<number, string> = { 1: "Insuffisant", 5: "Excellent" };
const heureFr = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

type ReponsesTexte = Record<string, string>;
type ReponsesQcm = Array<number | null>;

export function PageFormulaire() {
  const { jeton } = useParams({ from: "/formulaire/$jeton" });
  const vue = useQuery({
    queryKey: ["formulaire-public", jeton],
    queryFn: () => api.get<FormulairePublic>(`/public/formulaire/${jeton}`),
    retry: false,
  });

  return (
    <div className="min-h-dvh bg-papier">
      <div className="mx-auto max-w-2xl px-4 pb-10 sm:px-6">
        {vue.isPending ? (
          <div className="pt-16">
            <Chargement libelle="Ouverture de votre formulaire…" />
          </div>
        ) : vue.error ? (
          <LienIndisponible erreur={vue.error} />
        ) : (
          <Formulaire jeton={jeton} p={vue.data} />
        )}
      </div>
    </div>
  );
}

// ——— États hors formulaire ———

function LienIndisponible({ erreur }: { erreur: Error }) {
  const perime = erreur instanceof ErreurApi && (erreur.statut === 404 || erreur.statut === 410);
  return (
    <div className="pt-16 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-papier-3 text-encre-2">
        <Link2Off className="size-7" aria-hidden />
      </div>
      <h1 className="text-[22px] leading-tight font-semibold">
        {perime ? "Ce lien a expiré ou n'est pas valide" : "Impossible d'ouvrir ce formulaire"}
      </h1>
      <p className="mx-auto mt-2 max-w-[44ch] text-encre-2">
        {perime
          ? "Un formulaire renvoyé remplace le lien précédent : si vous avez reçu plusieurs e-mails, ouvrez le plus récent. Sinon, demandez à votre formateur de vous le renvoyer : vous recevrez un nouveau lien."
          : erreur.message}
      </p>
    </div>
  );
}

function Entete({ p }: { p: FormulairePublic }) {
  const couleur = /^#[0-9a-f]{6}$/i.test(p.organisme.couleur)
    ? p.organisme.couleur
    : "var(--color-accent)";
  return (
    <header className="-mx-4 mb-6 sm:-mx-6">
      <div className="h-1.5" style={{ background: couleur }} aria-hidden />
      <div className="border-b border-trait bg-carte px-4 py-4 sm:px-6">
        <p
          className="flex items-center gap-2 text-sm font-semibold tracking-wide"
          style={{ color: couleur }}
        >
          <ShieldCheck className="size-4 shrink-0" aria-hidden /> {p.organisme.nom}
        </p>
        <h1 className="mt-2 text-[24px] leading-tight font-semibold sm:text-[28px]">{p.libelle}</h1>
      </div>
    </header>
  );
}

function Recapitulatif({ p }: { p: FormulairePublic }) {
  const periode =
    p.dates.debut || p.dates.fin ? `${dateFr(p.dates.debut)} → ${dateFr(p.dates.fin)}` : null;
  const lignes: Array<{ icone: React.ReactNode; cle: string; valeur: string }> = [
    {
      icone: <GraduationCap className="size-4" aria-hidden />,
      cle: "Formation",
      valeur: p.formation_titre,
    },
    { icone: <FileText className="size-4" aria-hidden />, cle: "Formulaire", valeur: p.libelle },
    ...(periode
      ? [{ icone: <CalendarDays className="size-4" aria-hidden />, cle: "Dates", valeur: periode }]
      : []),
    ...(p.formateur
      ? [
          {
            icone: <UserRound className="size-4" aria-hidden />,
            cle: "Formateur",
            valeur: p.formateur,
          },
        ]
      : []),
    {
      icone: <Mail className="size-4" aria-hidden />,
      cle: "Adresse e-mail",
      valeur: p.apprenant.email || "—",
    },
  ];
  return (
    <Carte className="mb-6 p-4 sm:p-5">
      <p className="text-lg font-semibold">
        Bonjour {p.apprenant.prenom} {p.apprenant.nom},
      </p>
      <dl className="mt-3 divide-y divide-trait text-sm">
        {lignes.map((l) => (
          <div key={l.cle} className="flex gap-3 py-2">
            <dt className="flex w-32 shrink-0 items-center gap-1.5 text-encre-3">
              {l.icone}
              {l.cle}
            </dt>
            <dd className="min-w-0 font-medium break-words">{l.valeur}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[13px] text-encre-3">
        Une erreur dans votre nom ou votre adresse ? Signalez-la à votre formateur ; vous pouvez
        tout de même répondre.
      </p>
    </Carte>
  );
}

// ——— Le formulaire ———

function Formulaire({ jeton, p }: { jeton: string; p: FormulairePublic }) {
  const requetes = useQueryClient();
  const champs = useMemo(
    () => (p.formulaire ? (p.formulaire.champs as unknown as ChampFormulaire[]) : []),
    [p.formulaire],
  );
  const questions = p.questionnaire?.questions ?? [];
  const brouillon = p.brouillon;

  const [texte, setTexte] = useState<ReponsesTexte>(() =>
    brouillon?.reponses &&
    !Array.isArray(brouillon.reponses) &&
    typeof brouillon.reponses === "object"
      ? (brouillon.reponses as ReponsesTexte)
      : {},
  );
  const [qcm, setQcm] = useState<ReponsesQcm>(() => {
    const r = Array.isArray(brouillon?.reponses) ? (brouillon.reponses as ReponsesQcm) : [];
    return questions.map((_, i) => (typeof r[i] === "number" ? r[i] : null));
  });
  const [date, setDate] = useState(brouillon?.date || p.aujourdhui);
  const [lieu, setLieu] = useState(brouillon?.lieu ?? "");
  const [trace, setTrace] = useState<string | null>(null);
  const [consentement, setConsentement] = useState(false);
  const [enregistreLe, setEnregistreLe] = useState<string | null>(null);
  const modifie = useRef(false);
  // La liste « il manque… » n'apparaît qu'une fois la saisie commencée : à l'ouverture, elle serait décourageante.
  const [aCommence, setACommence] = useState(brouillon !== null);
  const toucher = () => {
    modifie.current = true;
    setACommence(true);
  };

  const reponses: ReponsesTexte | ReponsesQcm = p.questionnaire ? qcm : texte;
  const enregistrer = useMutation({
    mutationFn: () =>
      api.put<{ enregistre_le: string }>(`/public/formulaire/${jeton}/brouillon`, {
        reponses,
        date,
        lieu,
      }),
    onSuccess: (r) => {
      setEnregistreLe(r.enregistre_le);
      modifie.current = false;
    },
  });
  const signer = useMutation({
    mutationFn: () =>
      api.post<{ statut: "complet" }>(`/public/formulaire/${jeton}/signer`, {
        reponses,
        date,
        lieu,
        trace_png: trace,
        consentement,
      }),
    onSuccess: () => requetes.invalidateQueries({ queryKey: ["formulaire-public", jeton] }),
  });

  // Enregistrement automatique et silencieux toutes les 20 secondes s'il y a du nouveau : rien n'est perdu.
  useEffect(() => {
    if (p.statut === "complet" || !p.ouvert) return;
    const minuterie = setInterval(() => {
      if (modifie.current && !enregistrer.isPending) enregistrer.mutate();
    }, 20_000);
    return () => clearInterval(minuterie);
  }, [p.statut, p.ouvert, enregistrer]);

  // Refus du serveur : on amène l'alerte à l'écran (sur un téléphone, elle est souvent hors de vue).
  const refAlerte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (signer.error) refAlerte.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [signer.error]);

  if (p.statut === "complet") return <Confirmation jeton={jeton} p={p} />;

  if (!p.ouvert) {
    return (
      <>
        <Entete p={p} />
        <Recapitulatif p={p} />
        <Alerte ton="attention" titre="Ce formulaire n'est plus ouvert">
          Le dossier de formation a changé d'étape : il n'est plus possible d'y répondre en ligne.
          Si vous pensez qu'il s'agit d'une erreur, contactez votre formateur.
        </Alerte>
      </>
    );
  }

  if (!p.formulaire && !p.questionnaire) {
    return (
      <>
        <Entete p={p} />
        <Recapitulatif p={p} />
        <Alerte ton="attention" titre="Ce formulaire n'a pas encore de contenu">
          Votre formateur doit le préparer avant que vous puissiez y répondre. Revenez par le même
          lien un peu plus tard, ou contactez-le.
        </Alerte>
      </>
    );
  }

  // ——— Progression et ce qui manque ———
  const requis = champs.filter((c) => c.requis);
  const repondusTexte = requis.filter((c) => (texte[c.id] ?? "").trim() !== "").length;
  const repondusQcm = qcm.filter((r) => r !== null).length;
  const total = p.questionnaire ? questions.length : requis.length;
  const repondus = p.questionnaire ? repondusQcm : repondusTexte;
  const reponsesCompletes = repondus === total;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const lieuOk = lieu.trim() !== "";

  const manques: string[] = [];
  if (!reponsesCompletes)
    manques.push(
      p.questionnaire
        ? `${total - repondus} question${total - repondus > 1 ? "s" : ""} sans réponse`
        : `${total - repondus} réponse${total - repondus > 1 ? "s" : ""} obligatoire${total - repondus > 1 ? "s" : ""} manquante${total - repondus > 1 ? "s" : ""}`,
    );
  if (!dateOk) manques.push("la date");
  if (!lieuOk) manques.push("le lieu");
  if (trace === null) manques.push("votre signature");
  if (!consentement) manques.push("la case de consentement");
  const pret = manques.length === 0;

  const erreursServeur = signer.error instanceof ErreurApi ? signer.error.details : null;
  const erreursChamps: Record<string, string> = erreursServeur?.champs ?? {};
  const erreursListe = Array.isArray(erreursServeur?.erreurs) ? erreursServeur.erreurs : [];
  const erreurGenerale = signer.error && erreursListe.length === 0 ? signer.error.message : null;

  const idProgression = "progression-formulaire";

  return (
    <>
      <Entete p={p} />

      {/* Barre de progression collante : l'apprenant sait toujours où il en est. */}
      <div className="sticky top-0 z-10 -mx-4 mb-5 border-b border-trait bg-papier/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span id={idProgression} className="font-medium text-encre-2">
            {p.questionnaire ? "Questions" : "Réponses"} :{" "}
            <span className="chiffres">
              {repondus} / {total}
            </span>{" "}
            {p.questionnaire ? "répondues" : "renseignées"}
          </span>
          {reponsesCompletes ? (
            <span className="flex items-center gap-1 font-medium text-valide">
              <CheckCircle2 className="size-4" aria-hidden /> Tout est répondu
            </span>
          ) : (
            <span className="text-encre-3">
              {enregistreLe ? `Enregistré à ${heureFr(enregistreLe)}` : "Brouillon automatique"}
            </span>
          )}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-papier-3"
          role="progressbar"
          aria-labelledby={idProgression}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={repondus}
        >
          <div
            className={cx(
              "h-full rounded-full transition-[width] duration-300 ease-(--ease-out)",
              reponsesCompletes ? "bg-valide" : "bg-accent",
            )}
            style={{ width: `${total === 0 ? 0 : Math.round((repondus / total) * 100)}%` }}
          />
        </div>
      </div>

      <Recapitulatif p={p} />

      {p.formulaire && (
        <section aria-labelledby="partie-reponses" className="mb-6">
          <h2 id="partie-reponses" className="mb-1 text-lg font-semibold">
            {p.formulaire.titre}
          </h2>
          <p className="mb-3 text-sm text-encre-2">{p.formulaire.introduction}</p>
          <Carte className="divide-y divide-trait">
            {champs.map((c) => (
              <ChampReponse
                key={c.id}
                champ={c}
                valeur={texte[c.id] ?? ""}
                erreur={erreursChamps[c.id]}
                changer={(v) => {
                  setTexte((t) => ({ ...t, [c.id]: v }));
                  toucher();
                }}
              />
            ))}
          </Carte>
          <p className="mt-2 text-[13px] text-encre-3">
            <span className="text-danger">*</span> réponse obligatoire
          </p>
        </section>
      )}

      {p.questionnaire && (
        <section aria-labelledby="partie-questions" className="mb-6">
          <h2 id="partie-questions" className="mb-1 text-lg font-semibold">
            {p.questionnaire.titre}
          </h2>
          <p className="mb-3 text-sm text-encre-2">
            Une seule réponse par question. Répondez spontanément : il s'agit de situer vos
            connaissances, pas de vous piéger.
          </p>
          <div className="space-y-3">
            {questions.map((q, i) => (
              <Carte key={i} className="p-4 sm:p-5">
                <fieldset className="min-w-0">
                  <legend className="mb-3 flex gap-3 text-[15px] font-medium leading-snug">
                    <span
                      className={cx(
                        "chiffres grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                        qcm[i] !== null ? "bg-valide text-sur-accent" : "bg-papier-3 text-encre-2",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span>{q.enonce}</span>
                  </legend>
                  <div className="space-y-2">
                    {q.propositions.map((prop, j) => {
                      const choisi = qcm[i] === j;
                      return (
                        <label
                          key={j}
                          className={cx(
                            "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3.5 py-2.5 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
                            choisi
                              ? "border-accent bg-accent-doux font-medium text-accent-fort"
                              : "border-trait bg-carte hover:border-trait-fort active:bg-papier-2",
                          )}
                        >
                          <input
                            type="radio"
                            name={`question-${i}`}
                            className="sr-only"
                            checked={choisi}
                            onChange={() => {
                              setQcm((r) => r.map((x, k) => (k === i ? j : x)));
                              toucher();
                            }}
                          />
                          <span
                            className={cx(
                              "mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full border-2",
                              choisi ? "border-accent bg-accent" : "border-trait-fort bg-carte",
                            )}
                            aria-hidden
                          >
                            {choisi && <span className="size-1.5 rounded-full bg-sur-accent" />}
                          </span>
                          <span className="leading-snug">{prop}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </Carte>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="partie-signature" className="mb-6">
        <h2 id="partie-signature" className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <PenLine className="size-5 text-accent" aria-hidden /> Date, lieu et signature
        </h2>
        <p className="mb-3 text-sm text-encre-2">
          Dernière étape : datez, indiquez où vous vous trouvez et signez avec le doigt ou la
          souris.
        </p>
        <Carte className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              libelle="Date"
              type="date"
              value={date}
              required
              max={p.aujourdhui}
              erreur={dateOk ? undefined : "Indiquez la date."}
              onChange={(e) => {
                setDate(e.target.value);
                toucher();
              }}
            />
            <Champ
              libelle="Fait à"
              placeholder="Ville"
              value={lieu}
              maxLength={120}
              required
              autoComplete="address-level2"
              onChange={(e) => {
                setLieu(e.target.value);
                toucher();
              }}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-encre-2">
              Votre signature <span className="text-danger">*</span>
            </p>
            <ZoneDeTrace surChangement={setTrace} />
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-trait bg-papier-2 p-3 text-[13.5px] leading-relaxed text-encre-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus">
            <input
              type="checkbox"
              checked={consentement}
              onChange={(e) => setConsentement(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-(--color-accent)"
            />
            <span>
              Je certifie l'exactitude de mes réponses et je signe électroniquement ce document
              (signature électronique simple). La date et l'heure de ma signature sont enregistrées
              par le serveur, avec une empreinte du document qui permet de prouver qu'il n'a pas été
              modifié ensuite.
            </span>
          </label>
          <p className="flex items-center gap-1.5 text-[12px] text-encre-3">
            <LockKeyhole className="size-3.5" aria-hidden /> Lien personnel : ne le transmettez à
            personne.
          </p>
        </Carte>
      </section>

      {(erreursListe.length > 0 || erreurGenerale) && (
        <div ref={refAlerte} className="mb-4">
          <Alerte ton="danger" titre="Le formulaire n'a pas pu être signé">
            {erreursListe.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {erreursListe.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              erreurGenerale
            )}
          </Alerte>
        </div>
      )}

      {/* Actions collantes en bas : toujours à portée de pouce. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-trait bg-papier/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {!pret && aCommence && (
          <p className="mb-2 flex items-start gap-1.5 text-[13px] text-encre-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-attente-encre" aria-hidden />
            <span>Pour valider, il manque : {manques.join(", ")}.</span>
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Bouton
            variante="primaire"
            className="h-11 w-full sm:w-auto"
            icone={<Send className="size-4" aria-hidden />}
            disabled={!pret}
            enCours={signer.isPending}
            onClick={() => signer.mutate()}
            title={pret ? undefined : `Il manque : ${manques.join(", ")}`}
          >
            Valider et signer
          </Bouton>
          <Bouton
            className="h-11 w-full sm:w-auto"
            icone={<Save className="size-4" aria-hidden />}
            enCours={enregistrer.isPending}
            onClick={() => enregistrer.mutate()}
          >
            Enregistrer et reprendre plus tard
          </Bouton>
        </div>
        <p className="mt-2 min-h-4 text-[12px] text-encre-3" aria-live="polite">
          {enregistrer.error ? (
            <span className="text-danger">{enregistrer.error.message}</span>
          ) : enregistreLe ? (
            `Brouillon enregistré le ${instantFr(enregistreLe)} — vous pouvez fermer la page et revenir par le même lien, même depuis un autre appareil.`
          ) : (
            "Vos réponses sont enregistrées automatiquement pendant que vous répondez."
          )}
        </p>
      </div>
    </>
  );
}

/** Un champ du formulaire à questions fixes : note 1–5 (grands boutons), choix (puces), texte (zone). */
function ChampReponse({
  champ,
  valeur,
  erreur,
  changer,
}: {
  champ: ChampFormulaire;
  valeur: string;
  erreur?: string;
  changer: (v: string) => void;
}) {
  const idErreur = `${champ.id}-erreur`;
  return (
    <fieldset className="min-w-0 p-4 sm:p-5" aria-describedby={erreur ? idErreur : undefined}>
      <legend className="mb-2.5 text-[15px] font-medium leading-snug">
        {champ.libelle}
        {champ.requis && <span className="text-danger"> *</span>}
      </legend>
      {champ.type === "note" ? (
        <div>
          <div className="grid grid-cols-5 gap-1.5 sm:max-w-sm">
            {NOTES.map((n) => {
              const choisi = valeur === String(n);
              return (
                <label
                  key={n}
                  className={cx(
                    "chiffres grid h-12 cursor-pointer place-items-center rounded-md border text-base font-semibold transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
                    choisi
                      ? "border-accent bg-accent text-sur-accent"
                      : "border-trait-fort bg-carte text-encre-2 hover:border-accent active:bg-papier-2",
                  )}
                >
                  <input
                    type="radio"
                    name={champ.id}
                    value={n}
                    className="sr-only"
                    checked={choisi}
                    onChange={() => changer(String(n))}
                    aria-label={`${n} sur 5${LEGENDE_NOTES[n] ? ` — ${LEGENDE_NOTES[n]}` : ""}`}
                  />
                  {n}
                </label>
              );
            })}
          </div>
          <div
            className="mt-1 flex justify-between text-[12px] text-encre-3 sm:max-w-sm"
            aria-hidden
          >
            <span>{LEGENDE_NOTES[1]}</span>
            <span>{LEGENDE_NOTES[5]}</span>
          </div>
        </div>
      ) : champ.type === "choix" ? (
        <div className="flex flex-wrap gap-2">
          {champ.options?.map((o) => {
            const choisi = valeur === o;
            return (
              <label
                key={o}
                className={cx(
                  "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 py-2 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
                  choisi
                    ? "border-accent bg-accent-doux font-medium text-accent-fort"
                    : "border-trait-fort bg-carte text-encre-2 hover:border-accent active:bg-papier-2",
                )}
              >
                <input
                  type="radio"
                  name={champ.id}
                  value={o}
                  className="sr-only"
                  checked={choisi}
                  onChange={() => changer(o)}
                />
                {o}
              </label>
            );
          })}
        </div>
      ) : (
        <textarea
          rows={champ.type === "texte_long" ? 3 : 1}
          aria-label={champ.libelle}
          aria-invalid={erreur ? true : undefined}
          value={valeur}
          maxLength={4000}
          onChange={(e) => changer(e.target.value)}
          className={cx(
            "w-full rounded-sm border bg-carte px-3 py-2.5 text-base leading-relaxed placeholder:text-encre-3 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none sm:text-sm",
            erreur ? "border-danger" : "border-trait-fort",
          )}
          placeholder="Votre réponse…"
        />
      )}
      {erreur && (
        <p id={idErreur} className="mt-2 flex items-start gap-1.5 text-[13px] text-danger">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {erreur}
        </p>
      )}
    </fieldset>
  );
}

// ——— Après signature ———

function Confirmation({ jeton, p }: { jeton: string; p: FormulairePublic }) {
  return (
    <>
      <Entete p={p} />
      <Carte className="p-5 text-center sm:p-8">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-valide-doux text-valide">
          <CheckCircle2 className="size-9" strokeWidth={2.2} aria-hidden />
        </div>
        <h2 className="text-[22px] leading-tight font-semibold">Merci, {p.apprenant.prenom} !</h2>
        <p className="mt-2 text-encre-2">
          Votre formulaire « <strong>{p.libelle}</strong> » est signé
          {p.signe_le ? ` le ${instantFr(p.signe_le)}` : ""}.
        </p>
        <p className="mt-1 text-sm text-encre-2">
          Le document signé a rejoint votre dossier de formation « {p.formation_titre} »
          {p.formateur ? ` ; ${p.formateur} en a été prévenu` : ""}. Une copie vous a aussi été
          envoyée par e-mail{p.apprenant.email ? ` à ${p.apprenant.email}` : ""}.
        </p>
        {p.pdf ? (
          <a
            href={`/api/public/formulaire/${jeton}/pdf`}
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-accent px-5 text-sm font-medium text-sur-accent shadow-carte hover:bg-accent-fort"
          >
            <Download className="size-4" aria-hidden /> Télécharger mon document signé
          </a>
        ) : (
          <p className="mt-6 text-[13px] text-encre-3">
            Le document signé sera téléchargeable ici dans quelques instants.
          </p>
        )}
        <p className="mt-6 text-[12px] text-encre-3">
          Vous pouvez fermer cette page. Ce lien reste valable pour retrouver votre document.
        </p>
      </Carte>
    </>
  );
}
