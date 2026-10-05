/**
 * Détail d'un dossier (F-CRM-03 à 05). Trois lectures du même dossier selon le rôle :
 * formateur et admin voient tout ; l'apprenant ne voit que son espace, ses questionnaires, son émargement, ses supports.
 * Les boutons d'action viennent de `d.actions` : c'est le noyau qui dit qui peut faire quoi, et pourquoi c'est bloqué.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BellRing,
  Check,
  Download,
  FileX2,
  Lock,
  MailPlus,
  PenLine,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  api,
  dateFr,
  dateLongue,
  euros,
  heuresFr,
  instantFr,
  octets,
  type CoffreApprenant,
  type Dossier,
  type SeanceEmargement,
} from "../api";
import { useActeur } from "../session";
import {
  Alerte,
  Bouton,
  Carte,
  Champ,
  Chargement,
  cx,
  DepotFichier,
  Etiquette,
  ListeManques,
  Modale,
  Onglets,
  Selecteur,
  ZoneTexte,
  useNotifier,
} from "../ui/base";
import { ListeOuAutre } from "../ui/champs";
import {
  FINANCEURS,
  MODALITES as LISTE_MODALITES,
  MODES_FINANCEMENT,
  NIVEAUX,
} from "@/domaine/pedagogie/listes";
import { ZoneDeTrace } from "../ui/Signature";
import { AutresPieces, EspaceCommunication, ListePieces, useRafraichirDossier } from "./DossierPieces";
import { FormulairesApprenant, Questionnaires } from "./DossierQuestionnaires";

const ETAPES = ["A", "B", "C", "D", "E", "F", "G"] as const;
const TITRES_ETAPES = ["Création", "Financement", "Début", "Fin", "Paiement", "Encaissé", "Archivé"];
const FINANCEMENTS: Record<string, string> = {
  opco: "OPCO",
  faf: "FAF",
  entreprise: "Entreprise",
  fonds_propres: "Fonds propres",
};
const MODALITES: Record<string, string> = {
  presentiel: "Présentiel",
  distanciel: "Distanciel",
  mixte: "Mixte",
};

export function EcranDossier() {
  const { id } = useParams({ from: "/_authenticated/dossiers/$id" });
  const acteur = useActeur();
  const dossier = useQuery({ queryKey: ["dossier", id], queryFn: () => api.get<Dossier>(`/dossiers/${id}`) });
  if (dossier.isPending) return <Chargement />;
  if (dossier.error) return <Alerte ton="danger">{dossier.error.message}</Alerte>;
  return acteur.role === "apprenant" ? <VueApprenant d={dossier.data} /> : <VueInterne d={dossier.data} />;
}

function Frise({ d }: { d: Dossier }) {
  const rang = ETAPES.indexOf(d.etape as (typeof ETAPES)[number]);
  const refuse = d.sous_statut === "refus_financement";
  return (
    <ol className="mt-5 grid grid-cols-7 gap-1 sm:gap-1.5" aria-label="Avancement du dossier">
      {ETAPES.map((e, i) => (
        <li key={e} aria-current={i === rang ? "step" : undefined}>
          <span
            className={cx(
              "block h-1.5 rounded-full",
              i < rang ? "bg-valide" : i === rang ? (refuse ? "bg-danger" : "bg-attente") : "bg-papier-3",
            )}
          />
          <span
            className={cx(
              "mt-1.5 block truncate text-[11px] font-medium",
              i === rang ? "text-encre" : "text-encre-3",
            )}
          >
            {TITRES_ETAPES[i]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EnTete({ d, children }: { d: Dossier; children?: React.ReactNode }) {
  const acteur = useActeur();
  return (
    <header className="mb-6">
      <Link
        to={acteur.role === "formateur" ? "/dossiers" : "/"}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-encre-3 hover:text-encre"
      >
        <ArrowLeft className="size-4" aria-hidden /> Retour
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="chiffres flex flex-wrap items-center gap-2 text-[13px] font-semibold tracking-wide text-encre-3">
            {d.dossier_reference}
            <Etiquette
              ton={d.sous_statut === "refus_financement" ? "danger" : d.archive ? "neutre" : "accent"}
            >
              {d.libelle_statut}
            </Etiquette>
            {d.archive && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-encre-3">
                <Lock className="size-3" aria-hidden /> Lecture seule
              </span>
            )}
          </p>
          <h1 className="mt-1.5 text-[24px] leading-tight font-semibold sm:text-[28px]">
            {d.formation.formation_titre}
          </h1>
          <p className="chiffres mt-1 text-encre-2">
            {d.entreprise.entreprise_nom} ·{" "}
            {d.formation.formation_date_debut
              ? `du ${dateFr(d.formation.formation_date_debut)} au ${dateFr(d.formation.formation_date_fin)}`
              : "dates à définir"}
          </p>
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      <Frise d={d} />
    </header>
  );
}

// ——— Actions du pipeline ———
function Actions({ d }: { d: Dossier }) {
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const [avecMotif, setAvecMotif] = useState<Dossier["actions"][number] | null>(null);
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [manques, setManques] = useState<string[]>([]);

  const executer = useMutation({
    mutationFn: (v: { action: string; motif?: string }) =>
      api.post(`/dossiers/${d.id}/actions/${v.action}`, { motif: v.motif }),
    onSuccess: async () => {
      await rafraichir();
      setAvecMotif(null);
      setRefus(false);
      setMotif("");
      setManques([]);
    },
    onError: (e: Error & { details?: { manques?: string[] } | null }) => {
      setManques(e.details?.manques ?? []);
      notifier("danger", e.message);
    },
  });
  const deposerRefus = useMutation({
    mutationFn: (f: File) => api.fichier(`/dossiers/${d.id}/pieces-externes/REF`, f),
    onSuccess: rafraichir,
    onError: (e) => notifier("danger", e.message),
  });

  const visibles = d.actions.filter((a) => a.action !== "enregistrer_refus");
  const refusPossible = d.actions.find((a) => a.action === "enregistrer_refus");
  const justificatifDepose = d.pieces.some((p) => p.code === "REF" && p.statut === "valide");
  if (visibles.length === 0 && !refusPossible) return null;

  return (
    <>
      {visibles.map((a, i) => (
        <Bouton
          key={a.action}
          variante={
            a.action === "renvoyer_en_brouillon"
              ? "secondaire"
              : i === visibles.length - 1 || visibles.length === 1
                ? "primaire"
                : "secondaire"
          }
          disabled={a.bloqueePar !== null}
          title={a.bloqueePar ?? undefined}
          enCours={executer.isPending && executer.variables?.action === a.action}
          onClick={() => (a.motifRequis ? setAvecMotif(a) : executer.mutate({ action: a.action }))}
        >
          {a.libelle}
        </Bouton>
      ))}
      {refusPossible && (
        <Bouton
          variante="discret"
          icone={<FileX2 className="size-4" aria-hidden />}
          onClick={() => setRefus(true)}
        >
          Refus de financement
        </Bouton>
      )}
      {manques.length > 0 && (
        <div className="basis-full">
          <ListeManques titre="Il manque encore :" manques={manques} />
        </div>
      )}

      <Modale ouverte={avecMotif !== null} fermer={() => setAvecMotif(null)} titre={avecMotif?.libelle ?? ""}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            executer.mutate({ action: avecMotif!.action, motif });
          }}
        >
          <ZoneTexte
            libelle="Motif"
            required
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            aide="Le formateur le recevra par e-mail et le verra sur le dossier."
          />
          <Bouton type="submit" variante="primaire" enCours={executer.isPending}>
            Confirmer
          </Bouton>
        </form>
      </Modale>

      <Modale ouverte={refus} fermer={() => setRefus(false)} titre="Enregistrer un refus de financement">
        <div className="space-y-4">
          <Alerte ton="attention" titre="Le dossier sera archivé">
            Il restera consultable dans le pipeline, avec ses pièces, mais ne pourra plus être repris. Vous
            pourrez créer un nouveau dossier à partir de celui-ci.
          </Alerte>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-trait p-3">
            <p className="text-sm">
              {justificatifDepose
                ? "Justificatif du refus déposé."
                : "1. Déposez le justificatif du refus (courrier du financeur)."}
            </p>
            {justificatifDepose ? (
              <Check className="size-5 text-valide" aria-hidden />
            ) : (
              <DepotFichier
                compact
                libelle="Déposer"
                enCours={deposerRefus.isPending}
                deposer={(f) => deposerRefus.mutate(f)}
              />
            )}
          </div>
          <ZoneTexte
            libelle="2. Motif du refus (facultatif)"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <Bouton
            variante="danger"
            disabled={!justificatifDepose}
            enCours={executer.isPending}
            onClick={() => executer.mutate({ action: "enregistrer_refus", motif })}
          >
            Enregistrer le refus et archiver
          </Bouton>
        </div>
      </Modale>
    </>
  );
}

// ——— Vue du formateur et de l'admin ———
type OngletInterne = "synthese" | "apprenant" | "of" | "emargement" | "journal";

function VueInterne({ d }: { d: Dossier }) {
  const acteur = useActeur();
  const navigate = useNavigate();
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const [onglet, setOnglet] = useState<OngletInterne>("synthese");
  const compte = (espace: "apprenant" | "of") => {
    const suivies = d.pieces.filter((p) => p.espace === espace && p.suivi);
    return suivies.length
      ? `${suivies.filter((p) => p.statut === "valide").length}/${suivies.length}`
      : undefined;
  };
  const supprimer = useMutation({
    mutationFn: () => api.suppr(`/dossiers/${d.id}`),
    onSuccess: async () => {
      await requetes.invalidateQueries({ queryKey: ["dossiers"] });
      navigate({ to: acteur.role === "formateur" ? "/dossiers" : "/" });
    },
  });
  const recreer = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/dossiers/${d.id}/recreer`),
    onSuccess: (n) => navigate({ to: "/dossiers/$id", params: { id: n.id } }),
    onError: (e) => notifier("danger", e.message),
  });

  return (
    <>
      <EnTete d={d}>
        <Actions d={d} />
        {d.sous_statut === "refus_financement" && acteur.role === "formateur" && (
          <Bouton variante="primaire" enCours={recreer.isPending} onClick={() => recreer.mutate()}>
            Créer un nouveau dossier à partir de celui-ci
          </Bouton>
        )}
      </EnTete>

      {d.motif_renvoi && d.sous_statut === "brouillon" && (
        <div className="mb-5">
          <Alerte ton="attention" titre="Dossier renvoyé par l'organisme pour correction">
            {d.motif_renvoi}
          </Alerte>
        </div>
      )}
      {d.motif_refus && (
        <div className="mb-5">
          <Alerte ton="danger" titre="Financement refusé">
            {d.motif_refus}
          </Alerte>
        </div>
      )}

      <Onglets
        actif={onglet}
        choisir={setOnglet}
        onglets={[
          { cle: "synthese", libelle: "Synthèse" },
          { cle: "apprenant", libelle: "Communication Apprenant", compteur: compte("apprenant") },
          { cle: "of", libelle: "Communication avec l'OF", compteur: compte("of") },
          { cle: "emargement", libelle: "Planning et émargement" },
          { cle: "journal", libelle: "Journal" },
        ]}
      />

      {onglet === "synthese" && <Synthese d={d} />}
      {onglet === "apprenant" && (
        <div className="space-y-6">
          <EspaceCommunication d={d} espace="apprenant" />
          {d.pieces.some((p) => p.espace === null) && (
            <section>
              <h2 className="mb-1 text-base font-semibold">Hors espace de communication</h2>
              <p className="mb-3 text-sm text-encre-2">
                Recueil, positionnement, évaluation des acquis et enquêtes de satisfaction : renseignés et
                signés en ligne par l'apprenant, archivés avec le dossier. Les envois se suivent depuis
                l'onglet « Synthèse », sous chaque apprenant.
              </p>
              <AutresPieces d={d} />
            </section>
          )}
        </div>
      )}
      {onglet === "of" && (
        <div className="space-y-4">
          <EspaceCommunication d={d} espace="of" />
          {d.pieces.some((p) => p.code === "10-FIN") && acteur.role === "formateur" && (
            <p className="text-sm text-encre-2">
              Besoin d'un modèle ?{" "}
              <a
                href={`/api/dossiers/${d.id}/trame-facture`}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent underline-offset-4 hover:underline"
              >
                Ouvrir la trame de facture pré-remplie
              </a>{" "}
              — imprimez-la en PDF, ou déposez votre propre facture.
            </p>
          )}
        </div>
      )}
      {onglet === "emargement" && <Emargement d={d} />}
      {onglet === "journal" && <Journal d={d} />}

      {d.sous_statut === "brouillon" && acteur.role === "formateur" && (
        <div className="mt-10 border-t border-trait pt-5">
          <Bouton
            variante="discret"
            icone={<Trash2 className="size-4" aria-hidden />}
            enCours={supprimer.isPending}
            onClick={() => confirm("Supprimer définitivement ce brouillon ?") && supprimer.mutate()}
          >
            Supprimer ce brouillon
          </Bouton>
        </div>
      )}
    </>
  );
}

function Definition({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-trait py-2.5 last:border-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13px] text-encre-3">{libelle}</dt>
      <dd className="min-w-0 text-sm whitespace-pre-line">{children || "—"}</dd>
    </div>
  );
}

function Synthese({ d }: { d: Dossier }) {
  const acteur = useActeur();
  const modifiable =
    !d.archive &&
    ((acteur.role === "formateur" && d.sous_statut === "brouillon") ||
      (acteur.role === "admin" && ["brouillon", "en_cours_validation"].includes(d.sous_statut)));
  const f = d.formation;
  const fin = d.finances;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-6">
        {d.manques_soumission.length > 0 && (
          <ListeManques
            titre="À compléter avant de demander la validation :"
            manques={d.manques_soumission}
          />
        )}
        {modifiable ? (
          <EditionDossier d={d} />
        ) : (
          <Carte className="px-5 py-2">
            <dl>
              <Definition libelle="Objectifs">{f.formation_objectifs}</Definition>
              <Definition libelle="Programme (annexe)">
                {f.formation_programme || "— à renseigner"}
              </Definition>
              <Definition libelle="Niveau · prérequis">
                {[f.formation_niveau, f.formation_prerequis].filter(Boolean).join(" · ")}
              </Definition>
              <Definition libelle="Durée">{`${heuresFr(f.formation_duree_heures_total)} sur ${f.formation_duree_jours ?? "—"} jour(s)`}</Definition>
              <Definition libelle="Modalité">{MODALITES[f.formation_modalite]}</Definition>
              <Definition libelle="Lieu">
                {[f.formation_lieu_nom, f.formation_lieu_adresse, f.formation_lien_visio]
                  .filter(Boolean)
                  .join("\n")}
              </Definition>
              <Definition libelle="Financement">{`${FINANCEMENTS[d.mode_financement]}${f.formation_opco ? ` — ${f.formation_opco}` : ""}`}</Definition>
              <Definition libelle="Signature de la convention">{f.signature_lieu}</Definition>
            </dl>
          </Carte>
        )}
        <Stagiaires d={d} />
        {!d.archive &&
          ["formation_debutee", "fin_dossier_incomplet", "fin_dossier_complet"].includes(d.sous_statut) && (
            <ObjectifsAtteints d={d} />
          )}
      </div>

      <div className="min-w-0 space-y-6">
        <Carte className="p-5">
          <h2 className="text-base font-semibold">Parties</h2>
          <dl className="mt-2">
            <Definition libelle="Entreprise">{`${d.entreprise.entreprise_nom}\n${d.entreprise.entreprise_adresse}\nSIRET ${d.entreprise.entreprise_siret || "—"}`}</Definition>
            <Definition libelle="Représentant">{`${d.entreprise.entreprise_representant_prenom} ${d.entreprise.entreprise_representant_nom}\n${d.entreprise.entreprise_representant_email}`}</Definition>
            <Definition libelle="Formateur">{`${d.formateur.prenom} ${d.formateur.nom}\n${d.formateur.email}`}</Definition>
          </dl>
        </Carte>
        {fin && (
          <Carte className="p-5">
            <h2 className="text-base font-semibold">Finances</h2>
            <p className="mt-0.5 text-[13px] text-encre-3">
              Calculées, jamais saisies : prix de vente − commission de portage = net formateur.
            </p>
            <dl className="chiffres mt-3 space-y-2 text-sm">
              {[
                [
                  `Prix unitaire HT × ${fin.formation_nb_stagiaires} stagiaire(s)`,
                  euros(f.formation_prix_unitaire_ht),
                ],
                ["Prix de vente HT", euros(fin.formation_prix_total_ht)],
                [
                  `Commission de portage (${fin.portage_commission_pourcentage ?? "—"} %)`,
                  `− ${euros(fin.portage_commission_montant)}`,
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-encre-2">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-trait pt-2.5 font-semibold">
                <dt>Net reversé au formateur</dt>
                <dd>{euros(fin.formateur_montant_total)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-[13px] text-encre-3">
                <dt>Soit, par heure de formation (calculé)</dt>
                <dd>{euros(fin.formateur_cout_horaire)}</dd>
              </div>
            </dl>
          </Carte>
        )}
        {d.manques_completude.length > 0 && ["fin_dossier_incomplet"].includes(d.sous_statut) && (
          <ListeManques
            titre="Pièces encore attendues pour un dossier complet :"
            manques={d.manques_completude.map(
              (m) =>
                `${m.libelle}${m.stagiaire_id ? ` — ${d.stagiaires.find((s) => s.id === m.stagiaire_id)?.prenom ?? ""}` : ""}`,
            )}
          />
        )}
      </div>
    </div>
  );
}

function EditionDossier({ d }: { d: Dossier }) {
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const f = d.formation;
  const [v, setV] = useState({
    formation_date_debut: f.formation_date_debut,
    formation_date_fin: f.formation_date_fin,
    formation_duree_heures_total: f.formation_duree_heures_total ?? "",
    formation_duree_jours: f.formation_duree_jours ?? "",
    formation_lieu_nom: f.formation_lieu_nom,
    formation_lieu_adresse: f.formation_lieu_adresse,
    formation_lien_visio: f.formation_lien_visio,
    formation_opco: f.formation_opco,
    prix: f.formation_prix_unitaire_ht === null ? "" : String(f.formation_prix_unitaire_ht / 100),
    signature_lieu: f.signature_lieu,
    formation_objectifs: f.formation_objectifs,
    formation_programme: f.formation_programme,
    // « Modification 1 » : tous les champs de la convention, dont la partie financière, modifiables jusqu'à la validation.
    formation_titre: f.formation_titre,
    formation_niveau: f.formation_niveau,
    formation_prerequis: f.formation_prerequis,
    formation_public_vise: f.formation_public_vise,
    formation_modalite: f.formation_modalite,
    formation_lieu_siret: f.formation_lieu_siret,
    heures_presentiel: f.formation_duree_heures_presentiel ?? "",
    heures_distanciel: f.formation_duree_heures_distanciel ?? "",
    mode_financement: d.mode_financement,
  });
  const [seances, setSeances] = useState(
    d.seances.map((s) => ({ date: s.date, heure_debut: s.heure_debut, heure_fin: s.heure_fin })),
  );
  const champ = (cle: keyof typeof v) => ({
    value: v[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV({ ...v, [cle]: e.target.value }),
  });
  const nombre = (x: string | number) => (x === "" ? null : Number(String(x).replace(",", ".")));

  const enregistrer = useMutation({
    mutationFn: async () => {
      const { prix, heures_presentiel, heures_distanciel, ...reste } = v;
      await api.patch(`/dossiers/${d.id}`, {
        ...reste,
        formation_duree_heures_total: nombre(v.formation_duree_heures_total),
        formation_duree_jours: nombre(v.formation_duree_jours),
        formation_prix_unitaire_ht: prix === "" ? null : Math.round(nombre(prix)! * 100),
        formation_duree_heures_presentiel:
          v.formation_modalite === "presentiel"
            ? nombre(v.formation_duree_heures_total)
            : v.formation_modalite === "distanciel"
              ? null
              : nombre(heures_presentiel),
        formation_duree_heures_distanciel:
          v.formation_modalite === "distanciel"
            ? nombre(v.formation_duree_heures_total)
            : v.formation_modalite === "presentiel"
              ? null
              : nombre(heures_distanciel),
      });
      await api.put(`/dossiers/${d.id}/seances`, { seances: seances.filter((s) => s.date) });
    },
    onSuccess: async () => {
      await rafraichir();
      notifier("succes", "Dossier enregistré.");
    },
    onError: (e) => notifier("danger", e.message),
  });

  return (
    <Carte className="p-5">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          enregistrer.mutate();
        }}
      >
        <div>
          <h2 className="text-base font-semibold">Le dossier</h2>
          <p className="mt-0.5 text-[13px] text-encre-3">
            Pré-rempli depuis votre catalogue et la fiche de l'entreprise. Ce que vous modifiez ici ne change
            que ce dossier.
          </p>
        </div>
        <Champ libelle="Intitulé (figure sur la convention)" {...champ("formation_titre")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <ListeOuAutre
            libelle="Niveau"
            options={NIVEAUX}
            value={v.formation_niveau}
            onChange={(x) => setV({ ...v, formation_niveau: x })}
          />
          <Selecteur
            libelle="Modalité"
            value={v.formation_modalite}
            onChange={(e) =>
              setV({ ...v, formation_modalite: e.target.value as typeof v.formation_modalite })
            }
          >
            {LISTE_MODALITES.map((m) => (
              <option key={m.valeur} value={m.valeur}>
                {m.libelle}
              </option>
            ))}
          </Selecteur>
        </div>
        <ZoneTexte libelle="Objectifs de la formation" rows={3} {...champ("formation_objectifs")} />
        <ZoneTexte
          libelle="Programme détaillé"
          rows={4}
          aide="Repris de la formation ; il devient l'annexe « Programme de formation » de la convention."
          {...champ("formation_programme")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ libelle="Date de début" type="date" {...champ("formation_date_debut")} />
          <Champ
            libelle="Date de fin"
            type="date"
            min={v.formation_date_debut}
            {...champ("formation_date_fin")}
          />
          <Champ
            libelle="Durée totale (heures)"
            inputMode="decimal"
            {...champ("formation_duree_heures_total")}
          />
          <Champ libelle="Nombre de jours" inputMode="decimal" {...champ("formation_duree_jours")} />
        </div>
        {v.formation_modalite === "mixte" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ libelle="Dont heures en présentiel" inputMode="decimal" {...champ("heures_presentiel")} />
            <Champ libelle="Dont heures à distance" inputMode="decimal" {...champ("heures_distanciel")} />
          </div>
        )}
        {v.formation_modalite !== "distanciel" && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
            <Champ libelle="Lieu de formation" {...champ("formation_lieu_nom")} />
            <Champ libelle="Adresse du lieu" {...champ("formation_lieu_adresse")} />
            <Champ libelle="SIRET du lieu" inputMode="numeric" {...champ("formation_lieu_siret")} />
          </div>
        )}
        {v.formation_modalite !== "presentiel" && (
          <Champ
            libelle="Lien de connexion à distance"
            type="url"
            placeholder="https://…"
            {...champ("formation_lien_visio")}
          />
        )}
        <ZoneTexte libelle="Public visé" rows={2} {...champ("formation_public_vise")} />
        <ZoneTexte libelle="Prérequis" rows={2} {...champ("formation_prerequis")} />
        <fieldset className="space-y-4 rounded-md border border-trait p-4">
          <legend className="px-1 text-[13px] font-semibold text-encre-2">
            Partie financière de la convention
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Selecteur
              libelle="Mode de financement"
              value={v.mode_financement}
              onChange={(e) => setV({ ...v, mode_financement: e.target.value as typeof v.mode_financement })}
            >
              {MODES_FINANCEMENT.map((m) => (
                <option key={m.valeur} value={m.valeur}>
                  {m.libelle}
                </option>
              ))}
            </Selecteur>
            <ListeOuAutre
              libelle="Financeur (OPCO, FAF…)"
              options={FINANCEURS}
              value={v.formation_opco}
              onChange={(x) => setV({ ...v, formation_opco: x })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ
              libelle="Prix unitaire HT (€)"
              inputMode="decimal"
              aide="Par stagiaire."
              {...champ("prix")}
            />
            <Champ libelle="Convention signée à" placeholder="Ville" {...champ("signature_lieu")} />
          </div>
          <p className="text-[12.5px] text-encre-3">
            La rémunération du formateur n'est pas saisie : elle se calcule dans l'encadré « Finances », par
            la commission de portage de l'organisme.
          </p>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-encre-2">Planning des séances</legend>
          <div className="space-y-2">
            {seances.map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
              >
                <input
                  type="date"
                  aria-label={`Date de la séance ${i + 1}`}
                  value={s.date}
                  min={v.formation_date_debut}
                  onChange={(e) =>
                    setSeances(seances.map((x, k) => (k === i ? { ...x, date: e.target.value } : x)))
                  }
                  className="h-10 min-w-0 rounded-sm border border-trait-fort bg-carte px-2 text-sm"
                />
                <input
                  type="time"
                  aria-label="Heure de début"
                  value={s.heure_debut}
                  onChange={(e) =>
                    setSeances(seances.map((x, k) => (k === i ? { ...x, heure_debut: e.target.value } : x)))
                  }
                  className="h-10 min-w-0 rounded-sm border border-trait-fort bg-carte px-2 text-sm"
                />
                <input
                  type="time"
                  aria-label="Heure de fin"
                  value={s.heure_fin}
                  onChange={(e) =>
                    setSeances(seances.map((x, k) => (k === i ? { ...x, heure_fin: e.target.value } : x)))
                  }
                  className="h-10 min-w-0 rounded-sm border border-trait-fort bg-carte px-2 text-sm"
                />
                <Bouton
                  variante="discret"
                  taille="sm"
                  aria-label="Retirer la séance"
                  icone={<Trash2 className="size-4" aria-hidden />}
                  onClick={() => setSeances(seances.filter((_, k) => k !== i))}
                />
              </div>
            ))}
          </div>
          <Bouton
            variante="discret"
            taille="sm"
            className="mt-2"
            disabled={seances.length >= 20}
            icone={<Plus className="size-4" aria-hidden />}
            onClick={() =>
              setSeances([
                ...seances,
                {
                  date: seances.at(-1)?.date ?? v.formation_date_debut,
                  heure_debut: seances.at(-1)?.heure_debut === "09:00" ? "13:30" : "09:00",
                  heure_fin: seances.at(-1)?.heure_debut === "09:00" ? "17:00" : "12:30",
                },
              ])
            }
          >
            Ajouter une séance
          </Bouton>
        </fieldset>

        <Bouton type="submit" variante="primaire" enCours={enregistrer.isPending}>
          Enregistrer
        </Bouton>
      </form>
    </Carte>
  );
}

function Stagiaires({ d }: { d: Dossier }) {
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const inviter = useMutation({
    mutationFn: (stagiaire_id: string) =>
      api.post<{ lien: string }>(`/dossiers/${d.id}/inviter`, { stagiaire_id }),
    onSuccess: async (r) => {
      await rafraichir();
      await navigator.clipboard?.writeText(r.lien).catch(() => undefined);
      notifier("succes", "Invitation envoyée. Le lien est aussi copié dans le presse-papiers.");
    },
    onError: (e) => notifier("danger", e.message),
  });
  const relancer = useMutation({
    mutationFn: (stagiaire_id: string) =>
      api.post<{ pieces: string[] }>(`/dossiers/${d.id}/relancer`, { stagiaire_id }),
    onSuccess: async (r) => {
      await rafraichir();
      notifier("succes", `Relance envoyée : ${r.pieces.join(", ")}.`);
    },
    onError: (e) => notifier("danger", e.message),
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Apprenants</h2>
      <div className="space-y-4">
        {d.stagiaires.map((st) => (
          <Carte key={st.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <p className="font-medium">
                  {st.prenom} {st.nom}
                </p>
                <p className="truncate text-[13px] text-encre-2">
                  {[st.poste, st.email].filter(Boolean).join(" · ")}
                </p>
                {/* Où en est cet apprenant dans son parcours : la même lecture que dans son propre espace. */}
                <ol className="mt-2 flex flex-wrap gap-1" aria-label={`Parcours de ${st.prenom}`}>
                  {(d.parcours.find((p) => p.stagiaire_id === st.id)?.sections ?? []).map((sec) => (
                    <li
                      key={sec.cle}
                      title={sec.message}
                      className={cx(
                        "rounded-xs px-1.5 py-0.5 text-[10px] font-semibold",
                        STYLE_SECTION[sec.etat].pastille,
                      )}
                    >
                      {sec.titre.split(" — ")[0]}
                    </li>
                  ))}
                </ol>
              </div>
              {!d.archive && (
                <div className="flex flex-wrap gap-1.5">
                  <Bouton
                    variante="secondaire"
                    taille="sm"
                    icone={<MailPlus className="size-3.5" aria-hidden />}
                    enCours={inviter.isPending && inviter.variables === st.id}
                    onClick={() => inviter.mutate(st.id)}
                  >
                    {st.a_un_compte ? "Renvoyer l'invitation" : "Inviter"}
                  </Bouton>
                  <Bouton
                    variante="discret"
                    taille="sm"
                    icone={<BellRing className="size-3.5" aria-hidden />}
                    enCours={relancer.isPending && relancer.variables === st.id}
                    onClick={() => relancer.mutate(st.id)}
                  >
                    Relancer
                  </Bouton>
                </div>
              )}
            </div>
            <div className="border-t border-trait bg-papier-2/60">
              <FormulairesApprenant d={d} stagiaireId={st.id} />
            </div>
          </Carte>
        ))}
      </div>
    </section>
  );
}

function ObjectifsAtteints({ d }: { d: Dossier }) {
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const [texte, setTexte] = useState(d.formation.formation_objectifs_atteints);
  const enregistrer = useMutation({
    mutationFn: () => api.patch(`/dossiers/${d.id}/objectifs-atteints`, { texte }),
    onSuccess: async () => {
      await rafraichir();
      notifier("succes", "Enregistré. Pensez à régénérer l'attestation si elle n'est pas encore signée.");
    },
  });
  return (
    <Carte className="p-5">
      <ZoneTexte
        libelle="Objectifs atteints"
        aide="Figure sur l'attestation de réalisation (09-FIN)."
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
      />
      <Bouton
        className="mt-3"
        taille="sm"
        enCours={enregistrer.isPending}
        onClick={() => enregistrer.mutate()}
      >
        Enregistrer
      </Bouton>
    </Carte>
  );
}

// ——— Planning et émargement ———
function Emargement({ d }: { d: Dossier }) {
  const acteur = useActeur();
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const etat = useQuery({
    queryKey: ["emargement", d.id],
    queryFn: () => api.get<SeanceEmargement[]>(`/dossiers/${d.id}/emargement`),
  });
  const [seance, setSeance] = useState<SeanceEmargement | null>(null);
  const [trace, setTrace] = useState<string | null>(null);
  const ouvert = ["formation_debutee", "fin_dossier_incomplet", "fin_dossier_complet"].includes(
    d.sous_statut,
  );
  const emarger = useMutation({
    mutationFn: () => api.post(`/seances/${seance!.id}/emarger`, { trace_png: trace }),
    onSuccess: async () => {
      await Promise.all([
        requetes.invalidateQueries({ queryKey: ["emargement", d.id] }),
        requetes.invalidateQueries({ queryKey: ["dossier", d.id] }),
      ]);
      setSeance(null);
      setTrace(null);
      notifier("succes", "Émargement enregistré.");
    },
  });
  if (etat.isPending) return <Chargement />;
  if (!etat.data || etat.data.length === 0) return <Alerte>Aucune séance n'est encore planifiée.</Alerte>;
  const moi = acteur.role === "apprenant" ? acteur.stagiaire_id : null;

  return (
    <>
      {!ouvert && !d.archive && (
        <div className="mb-4">
          <Alerte>L'émargement s'ouvrira au démarrage de la formation.</Alerte>
        </div>
      )}
      <Carte className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-trait text-left text-xs tracking-wide text-encre-3 uppercase">
              <th className="px-4 py-3 font-semibold">Séance</th>
              <th className="px-4 py-3 font-semibold">Horaires</th>
              {d.stagiaires.map((st) => (
                <th key={st.id} className="px-4 py-3 font-semibold">
                  {st.prenom}
                </th>
              ))}
              <th className="px-4 py-3 font-semibold">Formateur</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-trait">
            {etat.data.map((se) => {
              const signe = (stagiaire_id: string, qui: "stagiaire" | "formateur") =>
                se.signatures.some((x) => x.stagiaire_id === stagiaire_id && x.signataire === qui);
              const resteAMoi = moi
                ? !signe(moi, "stagiaire")
                : acteur.role === "formateur" && d.stagiaires.some((st) => !signe(st.id, "formateur"));
              return (
                <tr key={se.id}>
                  <td className="chiffres px-4 py-3 font-medium whitespace-nowrap">{dateLongue(se.date)}</td>
                  <td className="chiffres px-4 py-3 whitespace-nowrap text-encre-2">
                    {se.heure_debut} – {se.heure_fin} · {heuresFr(se.duree_heures)}
                  </td>
                  {d.stagiaires.map((st) => (
                    <td key={st.id} className="px-4 py-3">
                      {signe(st.id, "stagiaire") ? (
                        <Check className="size-4 text-valide" aria-label="Signé" />
                      ) : (
                        <span className="text-encre-3">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {d.stagiaires.every((st) => signe(st.id, "formateur")) ? (
                      <Check className="size-4 text-valide" aria-label="Contresigné" />
                    ) : (
                      <span className="text-encre-3">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {ouvert && resteAMoi && (
                      <Bouton
                        variante="secondaire"
                        taille="sm"
                        icone={<PenLine className="size-3.5" aria-hidden />}
                        onClick={() => setSeance(se)}
                      >
                        {moi ? "Émarger" : "Contresigner"}
                      </Bouton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Carte>
      {acteur.role !== "apprenant" && (
        <p className="chiffres mt-3 text-sm text-encre-2">
          Heures réalisées :{" "}
          {d.stagiaires.map((st) => `${st.prenom} ${heuresFr(st.heures_realisees)}`).join(" · ")}
        </p>
      )}

      <Modale
        ouverte={seance !== null}
        fermer={() => setSeance(null)}
        titre={
          seance ? `Émargement — ${dateLongue(seance.date)}, ${seance.heure_debut} – ${seance.heure_fin}` : ""
        }
      >
        <p className="mb-4 text-sm text-encre-2">
          {moi
            ? "Signez pour attester de votre présence à cette séance."
            : "Votre signature contresigne la présence de tous les stagiaires de cette séance."}
        </p>
        <ZoneDeTrace surChangement={setTrace} hauteur={150} />
        {emarger.error && <p className="mt-2 text-sm text-danger">{emarger.error.message}</p>}
        <Bouton
          variante="primaire"
          className="mt-3 w-full"
          disabled={!trace}
          enCours={emarger.isPending}
          onClick={() => emarger.mutate()}
        >
          Valider ma signature
        </Bouton>
      </Modale>
    </>
  );
}

function Journal({ d }: { d: Dossier }) {
  if (d.journal.length === 0) return <Alerte>Aucun événement pour l'instant.</Alerte>;
  const ROLES: Record<string, string> = {
    admin: "Organisme",
    formateur: "Formateur",
    apprenant: "Apprenant",
    systeme: "Automatique",
  };
  return (
    <Carte className="px-5 py-2">
      <ol>
        {d.journal.map((e) => (
          <li
            key={e.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 border-b border-trait py-3 last:border-0 sm:grid-cols-[120px_90px_minmax(0,1fr)]"
          >
            <span className="chiffres text-[13px] text-encre-3">{instantFr(e.cree_le)}</span>
            <span className="max-sm:hidden">
              <Etiquette ton={e.acteur_role === "systeme" ? "neutre" : "accent"}>
                {ROLES[e.acteur_role] ?? e.acteur_role}
              </Etiquette>
            </span>
            <span className="text-sm max-sm:col-span-2">{e.libelle}</span>
          </li>
        ))}
      </ol>
    </Carte>
  );
}

// ——— Vue de l'apprenant : son parcours, section par section (cahier des charges oral du 23/09/2026) ———
type SectionParcours = Dossier["parcours"][number]["sections"][number];

const STYLE_SECTION: Record<SectionParcours["etat"], { cadre: string; pastille: string; libelle: string }> = {
  a_faire: {
    cadre: "border-attente/70 bg-attente-doux/40",
    pastille: "bg-attente text-attente-encre",
    libelle: "À faire",
  },
  en_attente: {
    cadre: "border-trait bg-papier-2",
    pastille: "bg-papier-3 text-encre-2",
    libelle: "En cours",
  },
  termine: {
    cadre: "border-valide/40 bg-valide-doux/60",
    pastille: "bg-valide text-sur-accent",
    libelle: "Terminé",
  },
  refuse: {
    cadre: "border-danger/40 bg-danger-doux",
    pastille: "bg-danger text-sur-accent",
    libelle: "Refusé",
  },
  a_venir: {
    cadre: "border-dashed border-trait-fort bg-carte opacity-70",
    pastille: "bg-papier-3 text-encre-3",
    libelle: "À venir",
  },
};

function DeclarationDepot({ d }: { d: Dossier }) {
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const [coche, setCoche] = useState(false);
  const action = d.actions.find((a) => a.action === "declarer_depot");
  const declarer = useMutation({
    mutationFn: () => api.post(`/dossiers/${d.id}/actions/declarer_depot`, {}),
    onSuccess: async () => {
      await rafraichir();
      notifier("succes", "Merci : votre formateur et l'organisme sont informés du dépôt de votre demande.");
    },
    onError: (e) => {
      setCoche(false);
      notifier("danger", e.message);
    },
  });
  if (!action) return null;
  const bloquee = action.bloqueePar !== null;
  return (
    <div className="mt-3 rounded-md border border-trait bg-carte p-4">
      <label
        className={cx(
          "flex items-start gap-3 text-sm",
          bloquee ? "cursor-not-allowed text-encre-3" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-(--color-accent)"
          checked={coche}
          disabled={bloquee || declarer.isPending}
          onChange={(e) => setCoche(e.target.checked)}
        />
        <span>
          <strong className="font-semibold">J'affirme avoir déposé la demande de financement</strong> auprès
          de mon organisme de financement (OPCO, FAF…), avec les documents ci-dessus.
          {bloquee && <span className="mt-1 block text-xs">{action.bloqueePar}</span>}
        </span>
      </label>
      <Bouton
        className="mt-3"
        variante="primaire"
        taille="sm"
        disabled={!coche || bloquee}
        enCours={declarer.isPending}
        onClick={() => declarer.mutate()}
      >
        Confirmer le dépôt de ma demande
      </Bouton>
    </div>
  );
}

function SectionApprenant({
  d,
  section,
  rang,
  children,
}: {
  d: Dossier;
  section: SectionParcours;
  rang: number;
  children?: React.ReactNode;
}) {
  const style = STYLE_SECTION[section.etat];
  const ouverte = section.etat !== "a_venir";
  return (
    <section
      aria-label={section.titre}
      data-etat={section.etat}
      className={cx("rounded-lg border p-4 transition-colors duration-300 sm:p-5", style.cadre)}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="chiffres grid size-7 shrink-0 place-items-center rounded-full bg-carte text-sm font-semibold text-encre-2 shadow-carte">
          {rang}
        </span>
        <h2 className="min-w-0 flex-1 text-base font-semibold sm:text-lg">{section.titre}</h2>
        <span
          className={cx("rounded-xs px-2 py-0.5 text-[11px] font-semibold tracking-wide", style.pastille)}
        >
          {style.libelle}
        </span>
      </header>
      <p className="mt-2 text-sm text-encre-2">{section.message}</p>
      {ouverte && section.pieces.length > 0 && (
        <div className="mt-3">
          <ListePieces d={d} codes={section.pieces} />
        </div>
      )}
      {ouverte && children}
    </section>
  );
}

function VueApprenant({ d }: { d: Dossier }) {
  const acteur = useActeur();
  const coffres = useQuery({ queryKey: ["coffres"], queryFn: () => api.get<CoffreApprenant[]>("/coffres") });
  const coffre = coffres.data?.find((c) => c.dossier_id === d.id);
  const sections = d.parcours.find((p) => p.stagiaire_id === acteur.stagiaire_id)?.sections ?? [];
  // La section « Accord » n'existe pour l'apprenant qu'une fois sa demande déclarée déposée.
  const visibles = sections.filter((s) => s.cle !== "accord" || s.etat !== "a_venir");
  const aFaire = visibles.filter((s) => s.etat === "a_faire");

  return (
    <div className="mx-auto max-w-4xl">
      <EnTete d={d} />
      {!d.archive && (
        <div className="mb-6">
          {aFaire.length > 0 ? (
            <Alerte ton="attention" titre={`Prochaine étape : ${aFaire[0]!.titre}`}>
              {aFaire[0]!.message}
            </Alerte>
          ) : (
            <Alerte ton="succes" titre="Vous êtes à jour">
              Rien n'attend votre action pour le moment.
            </Alerte>
          )}
        </div>
      )}

      <ol className="mb-6 flex flex-wrap gap-1.5" aria-label="Mon parcours">
        {visibles.map((s, i) => (
          <li
            key={s.cle}
            className={cx("rounded-xs px-2 py-1 text-[11px] font-semibold", STYLE_SECTION[s.etat].pastille)}
          >
            {i + 1}. {s.titre.split(" — ")[0]}
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        {visibles.map((section, i) => (
          <SectionApprenant key={section.cle} d={d} section={section} rang={i + 1}>
            {section.cle === "preliminaire" && (
              <div className="mt-3">
                <Questionnaires
                  d={d}
                  stagiaireId={acteur.stagiaire_id!}
                  types={["recueil", "positionnement"]}
                />
              </div>
            )}
            {section.cle === "financement" && <DeclarationDepot d={d} />}
            {section.cle === "realisation" && (
              <div className="mt-3 space-y-4">
                <Questionnaires
                  d={d}
                  stagiaireId={acteur.stagiaire_id!}
                  types={["acquis", "satisfaction_chaud", "satisfaction_froid"]}
                />
                {d.seances.length > 0 && <Emargement d={d} />}
              </div>
            )}
          </SectionApprenant>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          Supports de formation
          {coffre ? (
            <Unlock className="size-4 text-valide" aria-hidden />
          ) : (
            <Lock className="size-4 text-encre-3" aria-hidden />
          )}
        </h2>
        {coffre && coffre.fichiers.length > 0 ? (
          <Carte>
            <ul className="divide-y divide-trait">
              {coffre.fichiers.map((fichier) => (
                <li key={fichier.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 truncate text-sm font-medium">{fichier.nom_fichier}</span>
                  <a
                    href={`/api/coffre/${fichier.id}/telecharger`}
                    className="inline-flex shrink-0 items-center gap-2 rounded-sm px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-doux"
                  >
                    <Download className="size-3.5" aria-hidden />
                    <span className="chiffres">{octets(fichier.taille)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Carte>
        ) : (
          <Alerte>
            {coffre
              ? "Votre formateur n'a pas encore partagé de support."
              : "Les supports seront accessibles dès que le financement de votre formation sera accordé."}
          </Alerte>
        )}
      </section>
    </div>
  );
}
