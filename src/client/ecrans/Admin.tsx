/**
 * Espace de l'organisme : décision sur les candidatures (F-ONB-02/03) et configuration de l'organisme (multi-organismes).
 * Version 7 : l'assistant IA et l'envoi des e-mails se règlent ici, en onglets, sans toucher au fichier `.env`.
 */
import { useId, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, KeyRound, Mail, Send, Sparkles, Trash2, UserRoundCheck } from "lucide-react";
import {
  api,
  ErreurApi,
  instantFr,
  octets,
  type CandidatureAdmin,
  type LigneCandidature,
  type Organisme,
  type Reglages,
  type ResultatTestCourriel,
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
  ListeManques,
  Modale,
  Onglets,
  Selecteur,
  TitrePage,
  ZoneTexte,
  useNotifier,
} from "../ui/base";
import { ZoneDeTrace } from "../ui/Signature";

const STATUTS: Record<string, { libelle: string; ton: "neutre" | "attente" | "accent" | "danger" }> = {
  brouillon: { libelle: "En préparation", ton: "neutre" },
  soumise: { libelle: "À étudier", ton: "attente" },
  validee: { libelle: "Validée", ton: "accent" },
  refusee: { libelle: "Rejetée", ton: "danger" },
};

export function AdminCandidatures() {
  const [ouverte, setOuverte] = useState<string | null>(null);
  const liste = useQuery({
    queryKey: ["candidatures"],
    queryFn: () => api.get<LigneCandidature[]>("/admin/candidatures"),
  });
  if (liste.isPending) return <Chargement />;
  if (liste.error) return <Alerte ton="danger">{liste.error.message}</Alerte>;
  const visibles = liste.data.filter((f) => !f.anonymise_le);
  const aEtudier = visibles.filter((f) => f.statut_candidature === "soumise").length;

  return (
    <>
      <TitrePage
        titre="Candidatures de formateurs"
        soustitre={
          aEtudier > 0
            ? `${aEtudier} candidature(s) attendent votre décision.`
            : "Aucune candidature en attente."
        }
      />
      {visibles.length === 0 ? (
        <EtatVide icone={<UserRoundCheck className="size-8" aria-hidden />} titre="Aucune candidature">
          Les formateurs qui postulent depuis la page d'inscription apparaîtront ici.
        </EtatVide>
      ) : (
        <Carte>
          <ul className="divide-y divide-trait">
            {visibles.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setOuverte(f.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-papier-2 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {f.formateur_prenom} {f.formateur_nom}
                    </span>
                    <span className="block truncate text-[13px] text-encre-2">
                      {[f.formateur_entreprise_nom, f.formateur_email].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {f.soumise_le && (
                      <span className="chiffres text-xs text-encre-3">{instantFr(f.soumise_le)}</span>
                    )}
                    <Etiquette ton={STATUTS[f.statut_candidature]!.ton}>
                      {STATUTS[f.statut_candidature]!.libelle}
                    </Etiquette>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Carte>
      )}
      <Modale ouverte={ouverte !== null} fermer={() => setOuverte(null)} titre="Candidature" large>
        {ouverte && <Decision id={ouverte} fermer={() => setOuverte(null)} />}
      </Modale>
    </>
  );
}

function Decision({ id, fermer }: { id: string; fermer: () => void }) {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const [motif, setMotif] = useState("");
  const c = useQuery({
    queryKey: ["candidature-admin", id],
    queryFn: () => api.get<CandidatureAdmin>(`/admin/candidatures/${id}`),
  });
  const decider = useMutation({
    mutationFn: (validee: boolean) => api.post(`/admin/candidatures/${id}/decision`, { validee, motif }),
    onSuccess: async (_r, validee) => {
      await requetes.invalidateQueries({ queryKey: ["candidatures"] });
      notifier(
        "succes",
        validee
          ? "Candidature validée. Le formateur est prévenu par e-mail."
          : "Candidature rejetée. Le formateur est prévenu par e-mail.",
      );
      fermer();
    },
  });
  if (c.isPending) return <Chargement />;
  if (c.error) return <Alerte ton="danger">{c.error.message}</Alerte>;
  const f = c.data.formateur;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <div>
          <p className="font-display text-xl font-semibold">
            {f.formateur_prenom} {f.formateur_nom}
          </p>
          <p className="text-sm text-encre-2">
            {f.formateur_email} · {f.formateur_telephone || "téléphone non renseigné"}
          </p>
        </div>
        <dl className="space-y-1.5 text-sm">
          {[
            ["Entreprise", f.formateur_entreprise_nom],
            ["SIRET", f.formateur_entreprise_siret],
            ["Adresse", f.formateur_entreprise_adresse],
            ["Déclaration d'activité", f.formateur_nda_numero],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3">
              <dt className="text-encre-3">{k}</dt>
              <dd>{v || "—"}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="mb-1 text-[13px] font-medium text-encre-3">Parcours</p>
          <p className="rounded-md bg-papier-2 p-3 text-sm leading-relaxed whitespace-pre-line">
            {f.parcours || "Non renseigné."}
          </p>
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <div>
          <p className="mb-2 text-[13px] font-medium text-encre-3">Pièces justificatives</p>
          <ul className="space-y-1.5">
            {c.data.pieces.map((p) => (
              <li key={p.id}>
                <a
                  href={`/api/pieces-formateur/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-sm border border-trait px-3 py-2 text-sm hover:border-accent/60"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">
                      {c.data.types.find((t) => t.type === p.type)?.libelle ?? p.type}
                    </span>{" "}
                    — {p.nom_fichier}
                  </span>
                  <span className="chiffres flex shrink-0 items-center gap-2 text-xs text-encre-3">
                    {octets(p.taille)} <Download className="size-3.5" aria-hidden />
                  </span>
                </a>
              </li>
            ))}
            {c.data.pieces.length === 0 && <li className="text-sm text-encre-3">Aucune pièce déposée.</li>}
          </ul>
        </div>
        {f.statut_candidature === "soumise" ? (
          <div className="space-y-3 border-t border-trait pt-4">
            <ZoneTexte
              libelle="Motif (obligatoire en cas de rejet)"
              rows={2}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
            {decider.error && <Alerte ton="danger">{decider.error.message}</Alerte>}
            <div className="flex flex-wrap gap-2">
              <Bouton
                variante="primaire"
                enCours={decider.isPending && decider.variables === true}
                onClick={() => decider.mutate(true)}
              >
                Valider la candidature
              </Bouton>
              <Bouton
                enCours={decider.isPending && decider.variables === false}
                onClick={() => decider.mutate(false)}
              >
                Rejeter
              </Bouton>
            </div>
          </div>
        ) : (
          <Alerte>
            Décision : {STATUTS[f.statut_candidature]!.libelle.toLowerCase()}
            {f.decidee_le ? `, le ${instantFr(f.decidee_le)}` : ""}.
            {f.motif_decision ? ` Motif : ${f.motif_decision}` : ""}
          </Alerte>
        )}
      </div>
    </div>
  );
}

const GROUPES: Array<{
  titre: string;
  aide?: string;
  champs: Array<[keyof Organisme & string, string, string?]>;
}> = [
  {
    titre: "Identité",
    aide: "Figure sur toutes les pièces émises. Rien n'est écrit en dur dans les gabarits.",
    champs: [
      ["of_nom", "Raison sociale"],
      ["of_forme_juridique", "Forme juridique et capital"],
      ["of_adresse", "Adresse"],
      ["of_siret", "SIRET"],
      ["of_tva_intracom", "TVA intracommunautaire"],
      ["of_telephone", "Téléphone"],
    ],
  },
  {
    titre: "Déclaration d'activité et certifications",
    champs: [
      ["of_nda_numero", "N° de déclaration d'activité"],
      ["of_dreets_region", "Région de la DREETS"],
      ["of_qualiopi_numero", "N° de certification Qualiopi"],
      ["of_certification_complementaire_numero", "Certification complémentaire"],
    ],
  },
  {
    titre: "Représentant légal",
    champs: [
      ["of_representant_civilite", "Civilité"],
      ["of_representant_prenom", "Prénom"],
      ["of_representant_nom", "Nom"],
    ],
  },
  {
    titre: "Contacts et juridiction",
    champs: [
      ["of_email_pedagogie", "E-mail pédagogie"],
      ["of_email_comptabilite", "E-mail comptabilité"],
      [
        "of_tribunal_competent",
        "Tribunal compétent",
        "Tel qu'il doit apparaître dans « le … sera seul compétent ».",
      ],
    ],
  },
  {
    titre: "Coordonnées bancaires",
    champs: [
      ["of_banque_nom", "Banque"],
      ["of_iban", "IBAN"],
      ["of_bic", "BIC"],
    ],
  },
];

type OngletOrganisme = "identite" | "ia" | "emails";

export function AdminOrganisme() {
  const [onglet, setOnglet] = useState<OngletOrganisme>("identite");
  return (
    <div className="mx-auto max-w-3xl">
      <TitrePage
        titre="Organisme de formation"
        soustitre="L'identité de l'organisme, son assistant IA et l'envoi de ses e-mails : chaque organisme porté par la plateforme a sa configuration."
      />
      <Onglets
        actif={onglet}
        choisir={setOnglet}
        onglets={[
          { cle: "identite", libelle: "Identité" },
          { cle: "ia", libelle: "Assistant IA" },
          { cle: "emails", libelle: "E-mails" },
        ]}
      />
      {onglet === "identite" && <OngletIdentite />}
      {onglet === "ia" && <OngletAssistantIa />}
      {onglet === "emails" && <OngletEmails />}
    </div>
  );
}

// ——— Identité (inchangé sur le fond : le formulaire d'origine, dans son onglet) ———

function OngletIdentite() {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const config = useQuery({
    queryKey: ["organisme"],
    queryFn: () => api.get<{ organisme: Organisme; manques: string[] }>("/admin/organisme"),
  });
  const [v, setV] = useState<Partial<Organisme>>({});
  const [trace, setTrace] = useState<string | null>(null);
  const enregistrer = useMutation({
    mutationFn: () =>
      api.patch<{ organisme: Organisme; manques: string[] }>("/admin/organisme", {
        ...v,
        ...(trace ? { signature_representant_png: trace } : {}),
      }),
    onSuccess: async (r) => {
      requetes.setQueryData(["organisme"], r);
      await requetes.invalidateQueries({ queryKey: ["moi"] });
      setV({});
      setTrace(null);
      notifier("succes", "Configuration enregistrée.");
    },
  });
  if (config.isPending) return <Chargement />;
  if (config.error) return <Alerte ton="danger">{config.error.message}</Alerte>;
  const of = { ...config.data.organisme, ...v };
  const err = enregistrer.error instanceof ErreurApi ? (enregistrer.error.details?.champs ?? {}) : {};
  const nombre = (
    cle:
      "portage_commission_pourcentage" | "tva_pourcentage" | "delai_paiement_jours" | "conservation_annees",
  ) => ({
    value: String(of[cle] ?? ""),
    erreur: err[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setV({ ...v, [cle]: e.target.value === "" ? 0 : Number(e.target.value.replace(",", ".")) }),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enregistrer.mutate();
      }}
    >
      {config.data.manques.length > 0 && (
        <div className="mb-6">
          <ListeManques
            titre="Tant que ces champs sont vides, aucun dossier ne peut être validé :"
            manques={config.data.manques}
          />
        </div>
      )}
      {enregistrer.error && (
        <div className="mb-6">
          <Alerte ton="danger">{enregistrer.error.message}</Alerte>
        </div>
      )}

      <div className="space-y-6">
        {GROUPES.map((g) => (
          <Carte key={g.titre} className="p-5">
            <h2 className="text-base font-semibold">{g.titre}</h2>
            {g.aide && <p className="mt-0.5 text-[13px] text-encre-3">{g.aide}</p>}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {g.champs.map(([cle, libelle, aide]) => (
                <Champ
                  key={cle}
                  libelle={libelle}
                  aide={aide}
                  erreur={err[cle]}
                  value={String(of[cle] ?? "")}
                  onChange={(e) => setV({ ...v, [cle]: e.target.value })}
                />
              ))}
            </div>
          </Carte>
        ))}

        <Carte className="p-5">
          <h2 className="text-base font-semibold">Règles de gestion</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Champ
              libelle="Commission de portage (%)"
              inputMode="decimal"
              aide="Prix de vente − commission = net reversé au formateur."
              {...nombre("portage_commission_pourcentage")}
            />
            <Champ
              libelle="TVA sur les factures (%)"
              inputMode="decimal"
              aide="0 = exonération (article 261.4.4° du CGI)."
              {...nombre("tva_pourcentage")}
            />
            <Champ
              libelle="Délai de paiement (jours)"
              inputMode="numeric"
              {...nombre("delai_paiement_jours")}
            />
            <Champ
              libelle="Conservation des dossiers (années)"
              inputMode="numeric"
              {...nombre("conservation_annees")}
            />
          </div>
          <div className="mt-4">
            <ZoneTexte
              libelle="Clause de subrogation"
              aide="Insérée dans la convention lorsque le financement passe par un OPCO ou un FAF."
              value={of.formation_clause_subrogation ?? ""}
              onChange={(e) => setV({ ...v, formation_clause_subrogation: e.target.value })}
            />
          </div>
        </Carte>

        <Carte className="p-5">
          <h2 className="text-base font-semibold">Signature du représentant légal</h2>
          <p className="mt-0.5 text-[13px] text-encre-3">
            Apposée automatiquement sur les pièces émises par l'organisme : convention, ordre de mission,
            convocation, attestation.
          </p>
          {config.data.organisme.signature_representant_png && !trace && (
            <img
              src={config.data.organisme.signature_representant_png}
              alt="Signature enregistrée"
              className="mt-3 h-20 rounded-md border border-trait bg-papier p-2"
            />
          )}
          <div className="mt-3 max-w-md">
            <ZoneDeTrace surChangement={setTrace} hauteur={130} />
          </div>
        </Carte>

        <Carte className="p-5">
          <Champ
            libelle="Couleur de l'organisme"
            type="color"
            className="!h-10 !w-24 !p-1"
            aide="Reprise sur les pièces générées et la page des formulaires apprenant."
            value={of.couleur ?? "#1d6a45"}
            onChange={(e) => setV({ ...v, couleur: e.target.value })}
          />
        </Carte>
      </div>
      <BarreEnregistrer enCours={enregistrer.isPending} />
    </form>
  );
}

// ——— Réglages (IA, e-mails) : mécanique commune ———

/** Clés modifiables par l'interface (les secrets s'envoient en clair, vides = inchangés, « - » = effacer). */
type ClesReglages =
  | "ia_cle"
  | "ia_modele"
  | "ia_workspace"
  | "ia_recherche_web"
  | "ia_active"
  | "smtp_hote"
  | "smtp_port"
  | "smtp_securise"
  | "smtp_utilisateur"
  | "smtp_mot_de_passe"
  | "courrier_expediteur"
  | "courrier_actif";
type Modifs = Partial<Record<ClesReglages, string>>;
const EFFACER = "-";

function useReglages() {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const reglages = useQuery({ queryKey: ["reglages"], queryFn: () => api.get<Reglages>("/admin/reglages") });
  const [v, setV] = useState<Modifs>({});
  const enregistrer = useMutation({
    mutationFn: () => api.patch<Reglages>("/admin/reglages", v),
    onSuccess: (r) => {
      requetes.setQueryData(["reglages"], r);
      setV({});
      notifier("succes", "Réglages enregistrés.");
    },
    onError: (e) => notifier("danger", e.message),
  });
  const err: Record<string, string> =
    enregistrer.error instanceof ErreurApi ? (enregistrer.error.details?.champs ?? {}) : {};
  const poser = (m: Modifs) => setV((x) => ({ ...x, ...m }));
  return { reglages, v, poser, enregistrer, err, modifie: Object.keys(v).length > 0 };
}

function BarreEnregistrer({
  enCours,
  modifie = true,
  aide,
}: {
  enCours: boolean;
  modifie?: boolean;
  aide?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-trait bg-papier/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <Bouton type="submit" variante="primaire" enCours={enCours} disabled={!modifie}>
        Enregistrer
      </Bouton>
      <span className="text-[13px] text-encre-3">
        {aide ??
          (modifie
            ? "Des modifications ne sont pas encore enregistrées."
            : "Aucune modification en attente.")}
      </span>
    </div>
  );
}

/** Interrupteur oui / non : un vrai bouton `switch`, au clavier comme au doigt. */
function Interrupteur({
  libelle,
  aide,
  actif,
  changer,
}: {
  libelle: string;
  aide?: ReactNode;
  actif: boolean;
  changer: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-[15px] font-medium">
          {libelle}
        </label>
        {aide && <p className="mt-0.5 text-[13px] text-encre-3">{aide}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={actif}
        onClick={() => changer(!actif)}
        className={cx(
          "relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors duration-150",
          actif ? "bg-accent" : "bg-trait-fort",
        )}
      >
        <span className="sr-only">{actif ? "Activé" : "Désactivé"}</span>
        <span
          className={cx(
            "absolute top-1 size-5 rounded-full bg-carte shadow-carte transition-[left] duration-150 ease-(--ease-out)",
            actif ? "left-6" : "left-1",
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}

/** Champ secret : jamais réaffiché ; vide = inchangé ; bouton pour l'effacer. */
function ChampSecret({
  libelle,
  defini,
  valeur,
  changer,
  aide,
  erreur,
  autoComplete = "off",
  libelleEffacer,
}: {
  libelle: string;
  defini: boolean;
  valeur: string;
  changer: (v: string) => void;
  aide?: string;
  erreur?: string;
  autoComplete?: string;
  libelleEffacer: string;
}) {
  const effacement = valeur === EFFACER;
  const etat = effacement ? (
    <Etiquette ton="danger">Sera effacé à l'enregistrement</Etiquette>
  ) : defini ? (
    <Etiquette ton="accent">En place ✓</Etiquette>
  ) : (
    <Etiquette ton="attente">À renseigner</Etiquette>
  );
  if (effacement) {
    return (
      <div className="min-w-0">
        <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] font-medium text-encre-2">
          {libelle} {etat}
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-danger/30 bg-danger-doux px-3 py-2 text-[13px] text-encre-2">
          <span>La valeur enregistrée sera supprimée quand vous enregistrerez.</span>
          <Bouton taille="sm" variante="discret" onClick={() => changer("")}>
            Annuler
          </Bouton>
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Champ
            libelle={libelle}
            type="password"
            autoComplete={autoComplete}
            spellCheck={false}
            placeholder={defini ? "•••••••• (laisser vide pour ne pas changer)" : ""}
            value={valeur}
            onChange={(e) => changer(e.target.value)}
            erreur={erreur}
          />
        </div>
        {defini && (
          <Bouton
            variante="discret"
            icone={<Trash2 className="size-4" aria-hidden />}
            onClick={() => changer(EFFACER)}
            className={erreur ? "self-start mt-6.5" : ""}
          >
            {libelleEffacer}
          </Bouton>
        )}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-encre-3">
        {etat}
        {aide && <span>{aide}</span>}
      </p>
    </div>
  );
}

// ——— Onglet « Assistant IA » ———

function OngletAssistantIa() {
  const { reglages, v, poser, enregistrer, err, modifie } = useReglages();
  if (reglages.isPending) return <Chargement />;
  if (reglages.error) return <Alerte ton="danger">{reglages.error.message}</Alerte>;
  const r = reglages.data;
  const val = (cle: ClesReglages) =>
    v[cle] ?? (cle === "ia_cle" || cle === "smtp_mot_de_passe" ? "" : r[cle]);
  const active = val("ia_active") === "oui";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enregistrer.mutate();
      }}
    >
      <div className="space-y-6">
        <Carte className="p-5">
          <Interrupteur
            libelle="Activer l'assistant IA"
            aide="Rédige les dossiers d'enjeux, les parcours, les tests de connaissances et les supports de cours des formateurs. Désactivé, ces boutons sont grisés et une note leur indique où l'activer."
            actif={active}
            changer={(x) => poser({ ia_active: x ? "oui" : "non" })}
          />
        </Carte>

        <Carte className={cx("space-y-5 p-5 transition-opacity", !active && "opacity-60")}>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound className="size-4.5 text-accent" aria-hidden /> Clé d'API Anthropic
            </h2>
            <p className="mt-0.5 text-[13px] text-encre-3">
              Créez-la sur{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-accent underline-offset-2 hover:underline"
              >
                console.anthropic.com <ExternalLink className="size-3" aria-hidden />
              </a>
              . Conseil : créez une clé rattachée à un <em>workspace</em> ; sinon, renseignez l'identifiant du
              workspace ci-dessous.
            </p>
          </div>
          {r.ia_defaut_serveur && !r.ia_cle_definie && (
            <Alerte>
              Une clé du serveur sert par défaut : l'assistant fonctionne déjà. Renseignez votre propre clé
              pour que les coûts soient portés par votre organisme.
            </Alerte>
          )}
          <ChampSecret
            libelle="Clé d'API"
            defini={r.ia_cle_definie}
            valeur={v.ia_cle ?? ""}
            changer={(x) => poser({ ia_cle: x })}
            erreur={err.ia_cle}
            aide="Chiffrée dès l'enregistrement, jamais réaffichée."
            libelleEffacer="Effacer la clé"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              libelle="Identifiant de workspace (facultatif)"
              value={val("ia_workspace")}
              spellCheck={false}
              onChange={(e) => poser({ ia_workspace: e.target.value })}
              erreur={err.ia_workspace}
              aide="Utile si votre clé n'est pas déjà rattachée à un workspace."
            />
            <Selecteur
              libelle="Modèle"
              value={val("ia_modele")}
              onChange={(e) => poser({ ia_modele: e.target.value })}
              erreur={err.ia_modele}
            >
              <option value="">— Modèle recommandé par défaut —</option>
              {r.modeles.map((m) => (
                <option key={m.valeur} value={m.valeur}>
                  {m.libelle}
                </option>
              ))}
            </Selecteur>
          </div>
          <Interrupteur
            libelle="Autoriser la recherche web"
            aide="Nécessaire pour les dossiers d'enjeux (actualité du secteur, réglementation). Coût ≈ 1 centime par recherche, en plus des jetons."
            actif={val("ia_recherche_web") === "oui"}
            changer={(x) => poser({ ia_recherche_web: x ? "oui" : "non" })}
          />
        </Carte>

        <Carte className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="size-4.5 text-accent" aria-hidden /> Ordre de grandeur des coûts
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-encre-2">
            <li>
              Un parcours complet proposé par l'assistant :{" "}
              <strong className="chiffres">≈ 0,20 – 0,50 €</strong>
            </li>
            <li>
              Un support de module : <strong className="chiffres">≈ 0,10 – 0,20 €</strong> (avec Sonnet 5)
            </li>
            <li>
              Une recherche web : <strong className="chiffres">≈ 0,01 €</strong>
            </li>
          </ul>
          <p className="mt-2 text-[13px] text-encre-3">
            Facturé par Anthropic sur votre compte, selon le modèle choisi. Opus coûte environ deux fois plus
            ; Haiku nettement moins.
          </p>
        </Carte>
      </div>
      <BarreEnregistrer enCours={enregistrer.isPending} modifie={modifie} />
    </form>
  );
}

// ——— Onglet « E-mails » ———

const PREREGLAGES: Array<{ cle: keyof Reglages["prereglages"]; libelle: string }> = [
  { cle: "gmail", libelle: "Gmail / Google Workspace" },
  { cle: "brevo", libelle: "Brevo" },
  { cle: "ovh", libelle: "OVH" },
  { cle: "ionos", libelle: "IONOS" },
];

function OngletEmails() {
  const { reglages, v, poser, enregistrer, err, modifie } = useReglages();
  const test = useMutation({
    mutationFn: () => api.post<ResultatTestCourriel>("/admin/reglages/test-courriel"),
  });
  if (reglages.isPending) return <Chargement />;
  if (reglages.error) return <Alerte ton="danger">{reglages.error.message}</Alerte>;
  const r = reglages.data;
  const val = (cle: ClesReglages) =>
    v[cle] ?? (cle === "ia_cle" || cle === "smtp_mot_de_passe" ? "" : r[cle]);
  const actif = val("courrier_actif") === "oui";
  const gmail = /gmail\.com$/i.test(val("smtp_hote"));
  const prereglageActif = PREREGLAGES.find((p) => {
    const x = r.prereglages[p.cle];
    return (
      x.smtp_hote === val("smtp_hote") &&
      x.smtp_port === val("smtp_port") &&
      x.smtp_securise === val("smtp_securise")
    );
  })?.cle;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enregistrer.mutate();
      }}
    >
      <div className="space-y-6">
        <Carte className="p-5">
          <Interrupteur
            libelle="Envoyer réellement les e-mails"
            aide="Désactivé, les e-mails sont seulement consignés dans la boîte d'envoi : pratique pour tester. Activé, ils partent par le serveur ci-dessous."
            actif={actif}
            changer={(x) => poser({ courrier_actif: x ? "oui" : "non" })}
          />
        </Carte>

        <Carte className="space-y-5 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Mail className="size-4.5 text-accent" aria-hidden /> Serveur d'envoi
            </h2>
            <p className="mt-0.5 text-[13px] text-encre-3">
              Choisissez votre fournisseur pour préremplir les réglages, ou saisissez-les vous-même.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Préréglages">
            {PREREGLAGES.map((p) => (
              <Bouton
                key={p.cle}
                taille="sm"
                aria-pressed={prereglageActif === p.cle}
                className={cx(prereglageActif === p.cle && "border-accent bg-accent-doux text-accent-fort")}
                onClick={() => poser({ ...r.prereglages[p.cle] })}
              >
                {p.libelle}
              </Bouton>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Champ
              libelle="Serveur (hôte)"
              placeholder="smtp.exemple.fr"
              spellCheck={false}
              autoComplete="off"
              value={val("smtp_hote")}
              onChange={(e) => poser({ smtp_hote: e.target.value })}
              erreur={err.smtp_hote}
            />
            <Champ
              libelle="Port"
              inputMode="numeric"
              placeholder="465"
              className="chiffres"
              value={val("smtp_port")}
              onChange={(e) => poser({ smtp_port: e.target.value.replace(/\D/g, "").slice(0, 5) })}
              erreur={err.smtp_port}
            />
          </div>
          <Interrupteur
            libelle="Connexion sécurisée (TLS direct)"
            aide="Oui pour le port 465 (TLS direct) ; non pour le port 587 (STARTTLS, la sécurité est négociée ensuite)."
            actif={val("smtp_securise") === "oui"}
            changer={(x) => poser({ smtp_securise: x ? "oui" : "non" })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              libelle="Identifiant (adresse e-mail)"
              type="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="contact@exemple.fr"
              value={val("smtp_utilisateur")}
              onChange={(e) => poser({ smtp_utilisateur: e.target.value })}
              erreur={err.smtp_utilisateur}
            />
            <Champ
              libelle="Adresse d'expédition"
              type="email"
              autoComplete="off"
              spellCheck={false}
              placeholder={val("smtp_utilisateur") || "Par défaut : l'identifiant"}
              value={val("courrier_expediteur")}
              onChange={(e) => poser({ courrier_expediteur: e.target.value })}
              erreur={err.courrier_expediteur}
              aide="Ce que voient vos destinataires. Laissez vide pour utiliser l'identifiant."
            />
          </div>
          <ChampSecret
            libelle="Mot de passe"
            defini={r.smtp_mot_de_passe_defini}
            valeur={v.smtp_mot_de_passe ?? ""}
            changer={(x) => poser({ smtp_mot_de_passe: x })}
            erreur={err.smtp_mot_de_passe}
            autoComplete="new-password"
            aide="Chiffré dès l'enregistrement, jamais réaffiché."
            libelleEffacer="Effacer le mot de passe"
          />
          {gmail && (
            <Alerte titre="Gmail / Google Workspace : utilisez un « mot de passe d'application »">
              Votre mot de passe habituel ne fonctionnera pas. Pas à pas :
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>
                  Ouvrez votre compte Google → <strong>Sécurité</strong>.
                </li>
                <li>
                  Activez la <strong>Validation en deux étapes</strong> si ce n'est pas déjà fait.
                </li>
                <li>
                  Cherchez <strong>Mots de passe des applications</strong>, créez-en un (nom libre, par
                  exemple « Plateforme formation »).
                </li>
                <li>Collez ici les 16 caractères obtenus, sans les espaces.</li>
              </ol>
            </Alerte>
          )}
        </Carte>

        <Carte className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Send className="size-4.5 text-accent" aria-hidden /> Vérifier que ça marche
          </h2>
          <p className="mt-0.5 text-[13px] text-encre-3">
            Un e-mail de test part à votre adresse avec les réglages <strong>enregistrés</strong>
            {modifie ? " — enregistrez d'abord vos modifications" : ""}.
          </p>
          <div className="mt-3">
            <Bouton
              icone={<Send className="size-4" aria-hidden />}
              enCours={test.isPending}
              disabled={modifie}
              onClick={() => test.mutate()}
            >
              M'envoyer un e-mail de test
            </Bouton>
          </div>
          {test.error && (
            <div className="mt-3">
              <Alerte ton="danger">{test.error.message}</Alerte>
            </div>
          )}
          {test.data && (
            <div className="mt-3">
              <ResultatTest r={test.data} />
            </div>
          )}
        </Carte>
      </div>
      <BarreEnregistrer enCours={enregistrer.isPending} modifie={modifie} />
    </form>
  );
}

function ResultatTest({ r }: { r: ResultatTestCourriel }) {
  if (r.statut === "envoye")
    return (
      <Alerte ton="succes" titre="E-mail envoyé">
        Regardez la boîte de réception de {r.destinataire} (et les indésirables, la première fois).
      </Alerte>
    );
  if (r.statut === "journalise") {
    return (
      <Alerte ton="attention" titre="E-mail consigné, mais pas expédié">
        {r.actif
          ? "L'envoi réel est activé mais le serveur d'envoi n'est pas renseigné : indiquez au moins l'hôte, puis enregistrez."
          : "L'envoi réel n'est pas activé : l'e-mail est seulement visible dans la boîte d'envoi. Activez « Envoyer réellement les e-mails », enregistrez, puis relancez le test."}
      </Alerte>
    );
  }
  return (
    <Alerte ton="danger" titre="L'envoi a échoué">
      <p className="whitespace-pre-line">
        {r.erreur || "Le serveur d'envoi a refusé le message sans donner de raison."}
      </p>
    </Alerte>
  );
}
