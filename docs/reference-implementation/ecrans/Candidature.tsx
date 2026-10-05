/**
 * Module 1, côté formateur — profil et candidature (F-ONB-01, F-ONB-03), complétés le 23/09/2026 (« Modification 1 » :
 * « il manque toute la partie profil et candidature ») :
 *  - un profil complet et toujours accessible, même après validation (statut, domaines, zones, langues, tarif, bio…) ;
 *  - les justificatifs, avec date de fin de validité (URSSAF, RC Pro) et alerte d'échéance — suivi des sous-traitants
 *    (Qualiopi, indicateur 27) ;
 *  - l'état de la candidature, sa décision et son motif.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, Trash2 } from "lucide-react";
import { DOMAINES, REGIONS_DREETS, STATUTS_JURIDIQUES } from "@/domaine/pedagogie/listes";
import { api, dateFr, ErreurApi, instantFr, octets, type Candidature } from "../api";
import { useActeur } from "../session";
import { Alerte, Bouton, Carte, Champ, Chargement, DepotFichier, Etiquette, ListeManques, Onglets, TitrePage, ZoneTexte, useNotifier } from "../ui/base";
import { centimesSaisis, ChoixMultiples, eurosEnSaisie, ListeOuAutre } from "../ui/champs";

const STATUTS: Record<string, { libelle: string; ton: "neutre" | "attente" | "accent" | "danger" }> = {
  brouillon: { libelle: "À compléter", ton: "neutre" },
  soumise: { libelle: "En cours d'étude", ton: "attente" },
  validee: { libelle: "Validée", ton: "accent" },
  refusee: { libelle: "Non retenue", ton: "danger" },
};

export function MaCandidature() {
  const acteur = useActeur();
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const [onglet, setOnglet] = useState<"profil" | "justificatifs" | "candidature">("profil");
  const candidature = useQuery({ queryKey: ["candidature"], queryFn: () => api.get<Candidature>("/candidature") });
  const maj = (c: Candidature) => requetes.setQueryData(["candidature"], c);
  const soumettre = useMutation({
    mutationFn: () => api.post<Candidature>("/candidature/soumettre"),
    onSuccess: async (c) => {
      maj(c);
      await requetes.invalidateQueries({ queryKey: ["moi"] });
      notifier("succes", "Candidature envoyée. Vous recevrez la décision par e-mail.");
    },
    onError: (e) => notifier("danger", e.message),
  });

  if (candidature.isPending) return <Chargement />;
  if (candidature.error) return <Alerte ton="danger">{candidature.error.message}</Alerte>;
  const c = candidature.data;
  const statut = STATUTS[c.formateur.statut_candidature]!;
  const valide = c.formateur.statut_candidature === "validee";
  const enEtude = c.formateur.statut_candidature === "soumise";
  const expirees = c.echeances.filter((x) => x.expiree);

  return (
    <div className="mx-auto max-w-3xl">
      <TitrePage
        titre={acteur.formateur_valide ? "Mon profil" : "Ma candidature"}
        soustitre={acteur.formateur_valide ? "Vos coordonnées, votre entreprise, vos domaines d'intervention et vos justificatifs. Tenez-les à jour : ils figurent sur vos contrats et servent au suivi qualité de l'organisme." : "Vos coordonnées, votre parcours et vos justificatifs. L'organisme étudie le dossier et vous répond par e-mail."}
        actions={<Etiquette ton={statut.ton}>{statut.libelle}</Etiquette>}
      />

      {valide && !acteur.formateur_valide && <div className="mb-6"><Alerte ton="succes" titre="Votre candidature est validée">Vous pouvez créer vos formations et instruire vos dossiers.</Alerte></div>}
      {enEtude && <div className="mb-6"><Alerte titre={`Candidature envoyée le ${instantFr(c.formateur.soumise_le)}`}>Elle est en cours d'étude : votre profil est figé jusqu'à la décision. Vous serez prévenu par e-mail.</Alerte></div>}
      {c.formateur.statut_candidature === "refusee" && <div className="mb-6"><Alerte ton="attention" titre="Votre candidature n'a pas été retenue en l'état">{c.formateur.motif_decision} — vous pouvez la compléter et la soumettre à nouveau.</Alerte></div>}
      {expirees.length > 0 && (
        <div className="mb-6">
          <Alerte ton="attention" titre="Justificatif(s) à renouveler">{expirees.map((x) => `${x.nom_fichier} (fin de validité : ${dateFr(x.expire_le)})`).join(" · ")}</Alerte>
        </div>
      )}

      <Onglets
        actif={onglet}
        choisir={setOnglet}
        onglets={[
          { cle: "profil", libelle: "Mon profil" },
          { cle: "justificatifs", libelle: "Justificatifs", compteur: String(c.pieces.length) },
          { cle: "candidature", libelle: "Candidature" },
        ]}
      />

      {onglet === "profil" && <Carte className="p-5"><Profil c={c} fige={enEtude} valide={valide} surMaj={maj} /></Carte>}

      {onglet === "justificatifs" && <Justificatifs c={c} fige={enEtude} surMaj={maj} />}

      {onglet === "candidature" && (
        <Carte className="space-y-4 p-5">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-encre-3">Statut</dt>
            <dd><Etiquette ton={statut.ton}>{statut.libelle}</Etiquette></dd>
            <dt className="text-encre-3">Compte créé le</dt>
            <dd>{instantFr(c.formateur.cree_le)}</dd>
            <dt className="text-encre-3">Envoyée le</dt>
            <dd>{instantFr(c.formateur.soumise_le)}</dd>
            <dt className="text-encre-3">Décision le</dt>
            <dd>{instantFr(c.formateur.decidee_le)}</dd>
            {c.formateur.motif_decision && (
              <>
                <dt className="text-encre-3">Motif</dt>
                <dd>{c.formateur.motif_decision}</dd>
              </>
            )}
          </dl>
          {!valide && !enEtude && (
            <div className="space-y-4 border-t border-trait pt-4">
              <ListeManques titre="Pour envoyer votre candidature, il manque :" manques={c.manques} />
              <Bouton variante="primaire" disabled={c.manques.length > 0} enCours={soumettre.isPending} onClick={() => soumettre.mutate()}>Envoyer ma candidature</Bouton>
            </div>
          )}
          {valide && <p className="text-[13px] text-encre-2">Votre candidature est validée. Pensez à renouveler vos attestations à leur échéance (onglet « Justificatifs »).</p>}
        </Carte>
      )}
    </div>
  );
}

function Justificatifs({ c, fige, surMaj }: { c: Candidature; fige: boolean; surMaj: (c: Candidature) => void }) {
  const notifier = useNotifier();
  const [expiration, setExpiration] = useState<Record<string, string>>({});
  const deposer = useMutation({ mutationFn: (v: { type: string; fichier: File }) => api.fichier<Candidature>("/candidature/pieces", v.fichier, { type: v.type, expire_le: expiration[v.type] ?? "" }), onSuccess: (r) => { surMaj(r); notifier("succes", "Justificatif ajouté."); }, onError: (e) => notifier("danger", e.message) });
  const retirer = useMutation({ mutationFn: (id: string) => api.suppr<Candidature>(`/candidature/pieces/${id}`), onSuccess: surMaj });
  const AVEC_ECHEANCE = new Set(["attestation", "kbis", "identite"]);
  return (
    <Carte className="p-5">
      <h2 className="text-base font-semibold">Pièces justificatives</h2>
      <p className="mt-0.5 text-[13px] text-encre-2">Pour les attestations (URSSAF, RC Pro), indiquez la date de fin de validité : l'application vous préviendra.</p>
      <ul className="mt-3 divide-y divide-trait">
        {c.types.map((t) => {
          const pieces = c.pieces.filter((p) => p.type === t.type);
          return (
            <li key={t.type} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {pieces.length > 0 && <Check className="size-4 text-valide" aria-hidden />}
                  {t.libelle}
                  {t.obligatoire && pieces.length === 0 && <Etiquette ton="attente">Obligatoire</Etiquette>}
                </p>
                {!fige && (
                  <span className="flex flex-wrap items-center gap-2">
                    {AVEC_ECHEANCE.has(t.type) && (
                      <label className="flex items-center gap-1.5 text-[12.5px] text-encre-3">
                        Valable jusqu'au
                        <input type="date" value={expiration[t.type] ?? ""} onChange={(e) => setExpiration({ ...expiration, [t.type]: e.target.value })} className="h-8 rounded-sm border border-trait-fort bg-carte px-2 text-[13px]" />
                      </label>
                    )}
                    <DepotFichier compact libelle="Ajouter" enCours={deposer.isPending && deposer.variables?.type === t.type} deposer={(fichier) => deposer.mutate({ type: t.type, fichier })} />
                  </span>
                )}
              </div>
              {pieces.map((p) => (
                <div key={p.id} className="mt-2 flex items-center justify-between gap-2 rounded-sm bg-papier-2 px-3 py-1.5 text-[13px]">
                  <span className="min-w-0 truncate">
                    {p.nom_fichier} <span className="chiffres text-encre-3">· {octets(p.taille)}</span>
                    {p.expire_le && (
                      <span className={p.expire_le < new Date().toISOString().slice(0, 10) ? "ml-1 font-medium text-danger" : "ml-1 text-encre-3"}>
                        {p.expire_le < new Date().toISOString().slice(0, 10) && <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />}· valable jusqu'au {dateFr(p.expire_le)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <a href={`/api/pieces-formateur/${p.id}`} aria-label={`Télécharger ${p.nom_fichier}`} className="rounded-xs p-1.5 text-encre-3 hover:bg-papier-3 hover:text-encre"><Download className="size-3.5" /></a>
                    {!fige && <button type="button" aria-label={`Retirer ${p.nom_fichier}`} onClick={() => confirm(`Retirer « ${p.nom_fichier} » ?`) && retirer.mutate(p.id)} className="rounded-xs p-1.5 text-encre-3 hover:bg-papier-3 hover:text-danger"><Trash2 className="size-3.5" /></button>}
                  </span>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </Carte>
  );
}

function Profil({ c, fige, valide, surMaj }: { c: Candidature; fige: boolean; valide: boolean; surMaj: (c: Candidature) => void }) {
  const notifier = useNotifier();
  const f = c.formateur;
  const [v, setV] = useState({
    formateur_prenom: f.formateur_prenom, formateur_nom: f.formateur_nom, formateur_telephone: f.formateur_telephone,
    formateur_statut_juridique: f.formateur_statut_juridique,
    formateur_entreprise_nom: f.formateur_entreprise_nom, formateur_entreprise_adresse: f.formateur_entreprise_adresse, formateur_entreprise_siret: f.formateur_entreprise_siret,
    formateur_nda_numero: f.formateur_nda_numero, formateur_dreets_region: f.formateur_dreets_region, formateur_iban: f.formateur_iban, formateur_bic: f.formateur_bic,
    formateur_assurance_rc: f.formateur_assurance_rc,
    formateur_domaines: (f.formateur_domaines ?? []) as string[], formateur_zones: f.formateur_zones, formateur_langues: f.formateur_langues,
    tarif: eurosEnSaisie(f.formateur_tarif_journalier), formateur_disponibilites: f.formateur_disponibilites,
    formateur_bio: f.formateur_bio, formateur_linkedin: f.formateur_linkedin, parcours: f.parcours,
  });
  const enregistrer = useMutation({
    mutationFn: () => {
      const { tarif, ...reste } = v;
      return api.patch<Candidature>("/candidature", { ...reste, formateur_tarif_journalier: centimesSaisis(tarif) });
    },
    onSuccess: (r) => { surMaj(r); notifier("succes", "Profil enregistré."); },
  });
  const err = enregistrer.error instanceof ErreurApi ? (enregistrer.error.details?.champs ?? {}) : {};
  const champ = (cle: Exclude<keyof typeof v, "formateur_domaines">) => ({ value: v[cle], erreur: err[cle], disabled: fige || (valide && (cle === "formateur_prenom" || cle === "formateur_nom")), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [cle]: e.target.value }) });

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); enregistrer.mutate(); }}>
      <h2 className="text-base font-semibold">Coordonnées</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Champ libelle="Prénom" required {...champ("formateur_prenom")} />
        <Champ libelle="Nom" required {...champ("formateur_nom")} />
        <Champ libelle="Téléphone" type="tel" {...champ("formateur_telephone")} />
      </div>
      {valide && <p className="-mt-2 text-[12.5px] text-encre-3">Nom et prénom figurent sur vos contrats signés : ils ne se modifient que par l'organisme.</p>}

      <h2 className="pt-2 text-base font-semibold">Votre entreprise</h2>
      <p className="-mt-2 text-[13px] text-encre-3">Ces informations figurent sur le contrat de sous-traitance et sur vos factures.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <ListeOuAutre libelle="Statut juridique" options={STATUTS_JURIDIQUES} value={v.formateur_statut_juridique} onChange={(x) => setV({ ...v, formateur_statut_juridique: x })} autre={false} disabled={fige} />
        <Champ libelle="Raison sociale" {...champ("formateur_entreprise_nom")} />
        <Champ libelle="SIRET" inputMode="numeric" {...champ("formateur_entreprise_siret")} />
        <Champ libelle="Adresse" {...champ("formateur_entreprise_adresse")} />
        <Champ libelle="N° de déclaration d'activité" aide="Si vous en avez un." {...champ("formateur_nda_numero")} />
        <ListeOuAutre libelle="Région de la DREETS" options={REGIONS_DREETS} value={v.formateur_dreets_region} onChange={(x) => setV({ ...v, formateur_dreets_region: x })} autre={false} disabled={fige} />
        <Champ libelle="IBAN" {...champ("formateur_iban")} />
        <Champ libelle="BIC" {...champ("formateur_bic")} />
      </div>
      <Champ libelle="Assurance responsabilité civile professionnelle" placeholder="Assureur, n° de contrat" {...champ("formateur_assurance_rc")} />

      <h2 className="pt-2 text-base font-semibold">Vos interventions</h2>
      <ChoixMultiples libelle="Domaines d'intervention" options={DOMAINES} valeurs={v.formateur_domaines} onChange={(x) => !fige && setV({ ...v, formateur_domaines: x })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ libelle="Zones d'intervention" placeholder="Ex. Haut-Rhin, Bâle, à distance" {...champ("formateur_zones")} />
        <Champ libelle="Langues d'animation" placeholder="Ex. français, allemand" {...champ("formateur_langues")} />
        <Champ libelle="Tarif journalier indicatif (€ HT)" inputMode="decimal" {...champ("tarif")} />
        <Champ libelle="Profil LinkedIn ou site" type="url" placeholder="https://…" {...champ("formateur_linkedin")} />
      </div>
      <ZoneTexte libelle="Disponibilités" rows={2} {...champ("formateur_disponibilites")} />
      <ZoneTexte libelle="Présentation courte" rows={3} aide="Quelques lignes, reprises dans vos programmes si vous le souhaitez." {...champ("formateur_bio")} />
      <ZoneTexte libelle="Parcours professionnel" rows={5} aide="Votre expérience, vos domaines d'intervention, vos références (indicateurs Qualiopi 21-22)." {...champ("parcours")} />
      {enregistrer.error && Object.keys(err).length === 0 && <Alerte ton="danger">{enregistrer.error.message}</Alerte>}
      <Bouton type="submit" variante="primaire" disabled={fige} enCours={enregistrer.isPending}>Enregistrer mon profil</Bouton>
    </form>
  );
}
