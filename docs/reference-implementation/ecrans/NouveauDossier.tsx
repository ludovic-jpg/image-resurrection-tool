/**
 * Générateur de conventions (espace formation) — F-DOS-02 impose l'ordre : l'apprenant, son entreprise, la formation,
 * la modalité, le financement. Cinq onglets courts plutôt qu'un formulaire de 900 lignes.
 * Cahier des charges oral du 23/09/2026 : les onglets sont pré-remplis quand la fiche existe, et on peut les
 * « reprendre » — revenir sur un onglet déjà rempli, ou corriger la fiche de l'apprenant ou de l'entreprise sur place.
 * Les fiches manquantes se créent sur place, sans quitter le parcours.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Plus } from "lucide-react";
import { api, euros, heuresFr, type Entreprise, type Formation, type Stagiaire } from "../api";
import { Alerte, Bouton, Carte, Chargement, cx, Modale, TitrePage } from "../ui/base";
import { FormulaireEntreprise, FormulaireStagiaire } from "./Repertoire";
import { FormulaireFormation } from "./Formations";

const ETAPES = ["Apprenant(s)", "Entreprise", "Formation", "Modalité", "Financement"];
const MODALITES = [
  { cle: "presentiel", titre: "Présentiel", detail: "Sur site, avec le formateur. Le lieu est pré-rempli avec l'adresse de l'entreprise." },
  { cle: "distanciel", titre: "Distanciel", detail: "En classe virtuelle. Un lien de connexion sera demandé." },
  { cle: "mixte", titre: "Mixte", detail: "Une partie sur site, une partie à distance." },
] as const;
const FINANCEMENTS = [
  { cle: "opco", titre: "OPCO", detail: "Prise en charge par l'opérateur de compétences, avec subrogation de paiement." },
  { cle: "faf", titre: "FAF", detail: "Fonds d'assurance formation des non-salariés." },
  { cle: "entreprise", titre: "Entreprise", detail: "Financement direct par l'entreprise, sans organisme tiers." },
  { cle: "fonds_propres", titre: "Fonds propres", detail: "Le stagiaire finance lui-même sa formation." },
] as const;

function Choix({ actif, titre, detail, onClick, multiple = false }: { actif: boolean; titre: string; detail?: string; onClick: () => void; multiple?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cx("flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors duration-150", actif ? "border-accent bg-accent-doux" : "border-trait bg-carte hover:border-trait-fort")}
    >
      <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center border", multiple ? "rounded-xs" : "rounded-full", actif ? "border-accent bg-accent text-sur-accent" : "border-trait-fort bg-carte")}>
        {actif && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{titre}</span>
        {detail && <span className="mt-0.5 block text-[13px] text-encre-2">{detail}</span>}
      </span>
    </button>
  );
}

export function NouveauDossier() {
  const navigate = useNavigate();
  const requetes = useQueryClient();
  const [etape, setEtape] = useState(0);
  const [creation, setCreation] = useState<"stagiaire" | "entreprise" | "formation" | null>(null);
  const [edition, setEdition] = useState<{ type: "stagiaire"; fiche: Stagiaire } | { type: "entreprise"; fiche: Entreprise } | null>(null);
  const [v, setV] = useState({ stagiaire_ids: [] as string[], entreprise_id: "", formation_id: "", formation_modalite: "presentiel", mode_financement: "opco" });

  const stagiaires = useQuery({ queryKey: ["stagiaires"], queryFn: () => api.get<Stagiaire[]>("/stagiaires") });
  const entreprises = useQuery({ queryKey: ["entreprises"], queryFn: () => api.get<Entreprise[]>("/entreprises") });
  const formations = useQuery({ queryKey: ["formations"], queryFn: () => api.get<Formation[]>("/formations") });
  const creer = useMutation({
    mutationFn: () => api.post<{ id: string }>("/dossiers", v),
    onSuccess: async (d) => {
      await requetes.invalidateQueries({ queryKey: ["dossiers"] });
      navigate({ to: "/dossiers/$id", params: { id: d.id } });
    },
  });

  if (stagiaires.isPending || entreprises.isPending || formations.isPending) return <Chargement />;
  const remplis = [v.stagiaire_ids.length > 0, v.entreprise_id !== "", v.formation_id !== "", true, true];
  const pret = remplis[etape];
  // Un onglet est accessible si tous ceux qui le précèdent sont remplis : on peut donc « reprendre » n'importe lequel.
  const accessible = (i: number) => remplis.slice(0, i).every(Boolean);
  const selection = {
    stagiaires: (stagiaires.data ?? []).filter((s) => v.stagiaire_ids.includes(s.id)),
    entreprise: entreprises.data?.find((e) => e.id === v.entreprise_id),
    formation: formations.data?.find((f) => f.id === v.formation_id),
  };

  const basculer = (id: string) => {
    const dedans = v.stagiaire_ids.includes(id);
    const stagiaire_ids = dedans ? v.stagiaire_ids.filter((x) => x !== id) : [...v.stagiaire_ids, id].slice(0, 8);
    // L'entreprise du premier apprenant choisi est proposée d'office à l'étape suivante.
    const premiere = stagiaires.data?.find((s) => s.id === stagiaire_ids[0])?.entreprise_id ?? "";
    setV({ ...v, stagiaire_ids, entreprise_id: v.entreprise_id || premiere });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <TitrePage titre="Générateur de conventions" soustitre="Cinq onglets, puis le dossier s'ouvre pré-rempli : vous n'aurez plus qu'à préciser les dates et le planning. La convention est générée à la validation par l'organisme." />

      <ol className="mb-6 grid grid-cols-5 gap-1.5" aria-label="Onglets du générateur">
        {ETAPES.map((e, i) => (
          <li key={e} aria-current={i === etape ? "step" : undefined}>
            <button type="button" disabled={!accessible(i)} onClick={() => setEtape(i)} className="block w-full text-left disabled:cursor-not-allowed">
              <span className={cx("block h-1.5 rounded-full", i === etape ? "bg-attente" : i < etape || (remplis[i] && accessible(i) && i < 3) ? "bg-valide" : "bg-papier-3")} />
              <span className={cx("mt-1.5 block truncate text-[11px] font-medium", i === etape ? "text-encre" : accessible(i) ? "text-encre-2 hover:text-encre" : "text-encre-3")}>{e}</span>
            </button>
          </li>
        ))}
      </ol>

      <Carte className="p-5 sm:p-6">
        {etape === 0 && (
          <Etape titre="Qui suit la formation ?" aide="De 1 à 8 apprenants. Une fiche se réutilise d'un dossier à l'autre." creer={() => setCreation("stagiaire")} libelleCreer="Nouvelle fiche apprenant">
            {stagiaires.data?.map((s) => <Choix key={s.id} multiple actif={v.stagiaire_ids.includes(s.id)} titre={`${s.stagiaire_prenom} ${s.stagiaire_nom}`} detail={[s.stagiaire_poste, s.stagiaire_email].filter(Boolean).join(" · ")} onClick={() => basculer(s.id)} />)}
            {selection.stagiaires.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[13px] text-encre-2">
                Reprendre une fiche :
                {selection.stagiaires.map((s) => (
                  <button key={s.id} type="button" aria-label={`Reprendre la fiche de ${s.stagiaire_prenom} ${s.stagiaire_nom}`} className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => setEdition({ type: "stagiaire", fiche: s })}>
                    {s.stagiaire_prenom} {s.stagiaire_nom}
                  </button>
                ))}
              </p>
            )}
          </Etape>
        )}
        {etape === 1 && (
          <Etape titre="Quelle entreprise commande la formation ?" aide="Elle signera la convention et recevra les pièces du financement." creer={() => setCreation("entreprise")} libelleCreer="Nouvelle entreprise">
            {entreprises.data?.map((e) => <Choix key={e.id} actif={v.entreprise_id === e.id} titre={e.entreprise_nom} detail={[e.entreprise_adresse, e.entreprise_siret && `SIRET ${e.entreprise_siret}`].filter(Boolean).join(" · ")} onClick={() => setV({ ...v, entreprise_id: e.id })} />)}
            {selection.entreprise && (
              <p className="pt-1 text-[13px] text-encre-2">
                <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => setEdition({ type: "entreprise", fiche: selection.entreprise! })}>
                  Reprendre la fiche de {selection.entreprise.entreprise_nom}
                </button>{" "}
                (SIRET, représentant, e-mail : ils figureront sur la convention).
              </p>
            )}
          </Etape>
        )}
        {etape === 2 && (
          <Etape titre="Quelle formation ?" aide="Objectifs, durée, prix et questionnaires sont repris de votre catalogue." creer={() => setCreation("formation")} libelleCreer="Nouvelle formation">
            {formations.data?.map((f) => <Choix key={f.id} actif={v.formation_id === f.id} titre={f.formation_titre} detail={[heuresFr(f.formation_duree_heures_total), f.formation_niveau, f.formation_prix_unitaire_ht !== null && `${euros(f.formation_prix_unitaire_ht)} HT / stagiaire`].filter(Boolean).join(" · ")} onClick={() => setV({ ...v, formation_id: f.id, formation_modalite: f.formation_modalite, mode_financement: f.mode_financement })} />)}
          </Etape>
        )}
        {etape === 3 && (
          <Etape titre="Comment se déroule-t-elle ?">
            {MODALITES.map((m) => <Choix key={m.cle} actif={v.formation_modalite === m.cle} titre={m.titre} detail={m.detail} onClick={() => setV({ ...v, formation_modalite: m.cle })} />)}
          </Etape>
        )}
        {etape === 4 && (
          <Etape titre="Qui la finance ?">
            {FINANCEMENTS.map((m) => <Choix key={m.cle} actif={v.mode_financement === m.cle} titre={m.titre} detail={m.detail} onClick={() => setV({ ...v, mode_financement: m.cle })} />)}
            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border border-trait bg-papier-2 p-4 text-sm">
              <dt className="text-encre-3">Apprenant(s)</dt>
              <dd className="truncate">{selection.stagiaires.map((s) => `${s.stagiaire_prenom} ${s.stagiaire_nom}`).join(", ")}</dd>
              <dt className="text-encre-3">Entreprise</dt>
              <dd className="truncate">{selection.entreprise?.entreprise_nom}</dd>
              <dt className="text-encre-3">Formation</dt>
              <dd className="truncate">{selection.formation?.formation_titre}</dd>
              <dt className="text-encre-3">Modalité</dt>
              <dd>{MODALITES.find((m) => m.cle === v.formation_modalite)?.titre}</dd>
            </dl>
          </Etape>
        )}

        {creer.error && <div className="mt-4"><Alerte ton="danger">{creer.error.message}</Alerte></div>}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-trait pt-5">
          <Bouton variante="discret" disabled={etape === 0} icone={<ArrowLeft className="size-4" aria-hidden />} onClick={() => setEtape(etape - 1)}>
            Précédent
          </Bouton>
          {etape < 4 ? (
            <Bouton variante="primaire" disabled={!pret} onClick={() => setEtape(etape + 1)}>
              Continuer <ArrowRight className="size-4" aria-hidden />
            </Bouton>
          ) : (
            <Bouton variante="primaire" enCours={creer.isPending} onClick={() => creer.mutate()}>
              Créer le dossier
            </Bouton>
          )}
        </div>
      </Carte>

      <Modale ouverte={edition?.type === "stagiaire"} fermer={() => setEdition(null)} titre="Reprendre la fiche apprenant">
        {edition?.type === "stagiaire" && <FormulaireStagiaire initiale={edition.fiche} entreprises={entreprises.data ?? []} termine={() => setEdition(null)} />}
      </Modale>
      <Modale ouverte={edition?.type === "entreprise"} fermer={() => setEdition(null)} titre="Reprendre la fiche entreprise">
        {edition?.type === "entreprise" && <FormulaireEntreprise initiale={edition.fiche} termine={() => setEdition(null)} />}
      </Modale>
      <Modale ouverte={creation === "stagiaire"} fermer={() => setCreation(null)} titre="Nouvelle fiche apprenant">
        <FormulaireStagiaire entreprises={entreprises.data ?? []} termine={(s) => { setCreation(null); if (s) basculer(s.id); }} />
      </Modale>
      <Modale ouverte={creation === "entreprise"} fermer={() => setCreation(null)} titre="Nouvelle entreprise">
        <FormulaireEntreprise termine={(e) => { setCreation(null); if (e) setV((x) => ({ ...x, entreprise_id: e.id })); }} />
      </Modale>
      <Modale ouverte={creation === "formation"} fermer={() => setCreation(null)} titre="Nouvelle formation" large>
        <FormulaireFormation termine={(f) => { setCreation(null); if (f) setV((x) => ({ ...x, formation_id: f.id, formation_modalite: f.formation_modalite, mode_financement: f.mode_financement })); }} />
      </Modale>
    </div>
  );
}

function Etape({ titre, aide, children, creer, libelleCreer }: { titre: string; aide?: string; children: React.ReactNode; creer?: () => void; libelleCreer?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{titre}</h2>
      {aide && <p className="mt-1 text-sm text-encre-2">{aide}</p>}
      <div className="mt-4 space-y-2">{children}</div>
      {creer && (
        <Bouton variante="discret" className="mt-3" icone={<Plus className="size-4" aria-hidden />} onClick={creer}>
          {libelleCreer}
        </Bouton>
      )}
    </div>
  );
}
