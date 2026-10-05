/**
 * Coffre-fort pédagogique PAR PARCOURS (« Modification 1 », 23/09/2026) : un onglet du menu, puis une page dédiée par
 * parcours avec tous les documents, en téléchargement ET en chargement :
 *  - Pédagogique : supports générés (PPTX), fichiers déposés par rubrique, questionnaires, programme ;
 *  - Administratif : documents administratifs et qualité, positionnements signés, et l'état des pièces de chaque dossier
 *    ouvert sur ce parcours (interactif : ce qui est déposé, validé, en attente) ;
 *  - Corbeille : ce qui a été supprimé se restaure.
 * Le formateur écrit ; l'organisme (admin) consulte et télécharge.
 */
import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileText,
  FolderLock,
  Presentation,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { CATEGORIES_COFFRE, libelleCategorie } from "@/domaine/pedagogie/listes";
import {
  DIAPOS_PAR_MODULE,
  heuresTexte,
  type Diapo,
  type ModuleParcours,
} from "@/domaine/pedagogie/parcours";
import {
  api,
  ErreurApi,
  dateFr,
  heuresFr,
  instantFr,
  octets,
  type CarteCoffre,
  type Formation,
  type VueCoffre,
} from "../api";
import { useActeur } from "../session";
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
import { AlerteIaIndisponible, MentionMoteur, useEtatIa } from "./AssistantIa";
import { InviterPositionnement } from "./Positionnements";

export function CoffresParcours() {
  const coffres = useQuery({
    queryKey: ["coffres-parcours"],
    queryFn: () => api.get<CarteCoffre[]>("/coffres-parcours"),
  });
  const acteur = useActeur();
  if (coffres.isPending) return <Chargement />;
  if (coffres.error) return <Alerte ton="danger">{coffres.error.message}</Alerte>;
  return (
    <>
      <TitrePage
        titre="Coffre-fort pédagogique"
        soustitre="Un coffre par parcours de formation : supports, questionnaires et programme d'un côté ; pièces administratives, positionnements et dossiers de l'autre. Tout se télécharge et se dépose au même endroit."
      />
      {coffres.data.length === 0 ? (
        <EtatVide
          icone={<FolderLock className="size-8" aria-hidden />}
          titre="Aucun parcours pour l'instant"
        >
          {acteur.role === "formateur"
            ? "Créez une formation : son coffre-fort se crée avec elle et se remplit de ses supports et de ses tests."
            : "Les coffres des formateurs apparaîtront ici."}
        </EtatVide>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {coffres.data.map((c) => (
            <Link
              key={c.id}
              to="/coffres/$id"
              params={{ id: c.id }}
              className="flex flex-col rounded-md border border-trait bg-carte p-5 shadow-carte transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-accent/60"
            >
              <span className="flex items-start gap-2">
                <FolderLock className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                <span className="font-display text-[16px] leading-snug font-semibold">
                  {c.formation_titre}
                </span>
              </span>
              {acteur.role === "admin" && (
                <span className="mt-1 text-[13px] text-encre-3">{c.formateur}</span>
              )}
              <span className="mt-3 flex flex-wrap gap-1.5">
                <Etiquette>{heuresFr(c.heures)}</Etiquette>
                {c.modules > 0 && <Etiquette>{c.modules} module(s)</Etiquette>}
              </span>
              <dl className="chiffres mt-4 grid grid-cols-2 gap-2 text-[13px]">
                <div className="rounded-sm bg-papier-2 px-2.5 py-2">
                  <dt className="text-encre-3">Pédagogique</dt>
                  <dd className="font-semibold">{c.pedagogique} élément(s)</dd>
                </div>
                <div className="rounded-sm bg-papier-2 px-2.5 py-2">
                  <dt className="text-encre-3">Administratif</dt>
                  <dd className="font-semibold">{c.administratif} document(s)</dd>
                </div>
                <div className="rounded-sm bg-papier-2 px-2.5 py-2">
                  <dt className="text-encre-3">Dossiers</dt>
                  <dd className="font-semibold">{c.dossiers}</dd>
                </div>
                <div className="rounded-sm bg-papier-2 px-2.5 py-2">
                  <dt className="text-encre-3">Positionnements</dt>
                  <dd className="font-semibold">
                    {c.positionnements_signes} signé(s)
                    {c.positionnements_attente ? ` · ${c.positionnements_attente} en attente` : ""}
                  </dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

const LIEN =
  "inline-flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-[13px] text-encre-2 hover:bg-papier-3 hover:text-encre";

export function CoffreParcours() {
  const { id } = useParams({ from: "/_authenticated/coffres/$id" });
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const [onglet, setOnglet] = useState<"pedagogique" | "administratif" | "corbeille">(
    "pedagogique",
  );
  const [modale, setModale] = useState<"depot" | "supports" | "inviter" | null>(null);
  const vue = useQuery({
    queryKey: ["coffre-parcours", id],
    queryFn: () => api.get<VueCoffre>(`/coffres-parcours/${id}`),
  });
  const rafraichir = () => requetes.invalidateQueries({ queryKey: ["coffre-parcours", id] });
  const action = useMutation({
    mutationFn: (a: {
      type: "partager" | "corbeille" | "restaurer" | "purger";
      id: string;
      partageable?: boolean;
    }) =>
      a.type === "partager"
        ? api.patch(`/coffre/${a.id}`, { partageable: a.partageable })
        : a.type === "corbeille"
          ? api.suppr(`/coffre/${a.id}`)
          : a.type === "restaurer"
            ? api.post(`/coffre/${a.id}/restaurer`)
            : api.suppr(`/coffre/${a.id}/definitif`),
    onSuccess: async (_r, a) => {
      await rafraichir();
      if (a.type === "corbeille")
        notifier(
          "succes",
          "Fichier mis à la corbeille : il se restaure depuis l'onglet « Corbeille ».",
        );
      if (a.type === "restaurer") notifier("succes", "Fichier restauré.");
    },
    onError: (e) => notifier("danger", e.message),
  });

  if (vue.isPending) return <Chargement />;
  if (vue.error) return <Alerte ton="danger">{vue.error.message}</Alerte>;
  const c = vue.data;
  const proprietaire = c.formation.proprietaire;
  const administratives = new Set<string>(
    CATEGORIES_COFFRE.filter((x) => x.partie === "administratif").map((x) => x.valeur),
  );
  const pedagogiques = c.fichiers.filter((f) => !administratives.has(f.categorie));
  const admin = c.fichiers.filter((f) => administratives.has(f.categorie));
  const supportsGeneres = pedagogiques.filter((f) => f.origine === "genere");
  const deposes = pedagogiques.filter((f) => f.origine !== "genere");
  const TYPES: Record<string, string> = {
    recueil: "Recueil des besoins",
    positionnement: "Test de positionnement",
    acquis: "Évaluation des acquis",
  };

  const ligneFichier = (f: VueCoffre["fichiers"][number]) => (
    <li key={f.id} className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{f.nom_fichier}</p>
        <p className="chiffres text-xs text-encre-3">
          {[
            libelleCategorie(f.categorie),
            octets(f.taille),
            instantFr(f.cree_le),
            f.origine === "genere" ? "généré" : "déposé",
          ].join(" · ")}
        </p>
      </div>
      {proprietaire && (
        <Bouton
          variante="discret"
          taille="sm"
          onClick={() => action.mutate({ type: "partager", id: f.id, partageable: !f.partageable })}
          icone={
            f.partageable ? (
              <Eye className="size-3.5 text-valide" aria-hidden />
            ) : (
              <EyeOff className="size-3.5" aria-hidden />
            )
          }
        >
          {f.partageable ? "Partagé" : "Privé"}
        </Bouton>
      )}
      <a
        href={`/api/coffre/${f.id}/telecharger`}
        className={LIEN}
        aria-label={`Télécharger ${f.nom_fichier}`}
      >
        <Download className="size-4" aria-hidden />
      </a>
      {proprietaire && (
        <Bouton
          variante="discret"
          taille="sm"
          aria-label={`Mettre ${f.nom_fichier} à la corbeille`}
          icone={<Trash2 className="size-3.5" aria-hidden />}
          onClick={() => action.mutate({ type: "corbeille", id: f.id })}
        />
      )}
    </li>
  );

  return (
    <>
      <Link
        to="/coffres"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-encre-3 hover:text-encre"
      >
        <ArrowLeft className="size-4" aria-hidden /> Coffre-fort pédagogique
      </Link>
      <TitrePage
        titre={c.formation.formation_titre}
        soustitre={`Coffre-fort du parcours — ${heuresFr(c.formation.formation_duree_heures_total)}${c.formation.modules.length ? `, ${c.formation.modules.length} module(s)` : ""}${c.formation.formation_niveau ? ` · ${c.formation.formation_niveau}` : ""}`}
        actions={
          <>
            <a
              href={`/api/coffres-parcours/${id}/zip`}
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-trait-fort bg-carte px-4 text-sm font-medium hover:bg-papier-2"
            >
              <FileArchive className="size-4" aria-hidden /> Tout télécharger (ZIP)
            </a>
            {proprietaire && (
              <Bouton
                variante="primaire"
                icone={<Upload className="size-4" aria-hidden />}
                onClick={() => setModale("depot")}
              >
                Déposer un document
              </Bouton>
            )}
          </>
        }
      />
      <Onglets
        actif={onglet}
        choisir={setOnglet}
        onglets={[
          {
            cle: "pedagogique",
            libelle: "Pédagogique",
            compteur: String(pedagogiques.length + c.outils.length + 1),
          },
          {
            cle: "administratif",
            libelle: "Administratif",
            compteur: String(admin.length + c.positionnements.length + c.dossiers.length),
          },
          ...(proprietaire
            ? [
                {
                  cle: "corbeille" as const,
                  libelle: "Corbeille",
                  compteur: c.corbeille.length ? String(c.corbeille.length) : undefined,
                },
              ]
            : []),
        ]}
      />

      {onglet === "pedagogique" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Carte className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Presentation className="size-4 text-accent" aria-hidden /> Supports de cours
                </h2>
                <p className="mt-0.5 text-[13px] text-encre-2">
                  Un PPTX de {DIAPOS_PAR_MODULE} diapositives par module, produit depuis le
                  parcours.
                </p>
              </div>
              {proprietaire && (
                <Bouton
                  taille="sm"
                  icone={<Sparkles className="size-3.5" aria-hidden />}
                  onClick={() => setModale("supports")}
                >
                  Produire les supports
                </Bouton>
              )}
            </div>
            {supportsGeneres.length ? (
              <ul className="mt-3 divide-y divide-trait">{supportsGeneres.map(ligneFichier)}</ul>
            ) : (
              <p className="mt-3 text-sm text-encre-3">Aucun support généré pour l'instant.</p>
            )}
          </Carte>

          <Carte className="p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileText className="size-4 text-accent" aria-hidden /> Programme et questionnaires
            </h2>
            <ul className="mt-3 divide-y divide-trait">
              <li className="flex items-center justify-between gap-2 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Programme de formation</span>
                  <span className="text-xs text-encre-3">
                    Produit à jour depuis la fiche formation
                  </span>
                </span>
                <a href={`/api/coffres-parcours/${id}/programme`} className={LIEN}>
                  <Download className="size-4" aria-hidden /> PDF
                </a>
              </li>
              {c.outils.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{o.titre}</span>
                    <span className="text-xs text-encre-3">
                      {TYPES[o.type]} · {o.questions} question(s)
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <a href={`/api/outils/${o.id}/document`} className={LIEN}>
                      <Download className="size-4" aria-hidden /> Vierge
                    </a>
                    {o.type !== "recueil" && (
                      <a href={`/api/outils/${o.id}/document?corrige=1`} className={LIEN}>
                        <Download className="size-4" aria-hidden /> Corrigé
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {c.outils.length === 0 && (
              <p className="mt-2 text-[13px] text-encre-3">
                Aucun questionnaire rattaché : générez-les depuis la fiche de la formation.
              </p>
            )}
            {proprietaire && (
              <Link
                to="/formations/$id"
                params={{ id }}
                className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
              >
                Fiche formation et kit pédagogique
              </Link>
            )}
          </Carte>

          <Carte className="p-5 xl:col-span-2">
            <h2 className="text-base font-semibold">Mes supports déposés</h2>
            <p className="mt-0.5 text-[13px] text-encre-2">
              Ouverts à l'apprenant dès l'accord de financement, pour les fichiers marqués « Partagé
              ».
            </p>
            {deposes.length ? (
              <ul className="mt-3 divide-y divide-trait">{deposes.map(ligneFichier)}</ul>
            ) : (
              <p className="mt-3 rounded-md border border-dashed border-trait-fort px-4 py-6 text-center text-sm text-encre-3">
                Aucun document déposé. {proprietaire && "Utilisez « Déposer un document »."}
              </p>
            )}
          </Carte>
        </div>
      )}

      {onglet === "administratif" && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <Carte className="p-5">
              <h2 className="text-base font-semibold">Documents administratifs et qualité</h2>
              <p className="mt-0.5 text-[13px] text-encre-2">
                Règlement intérieur, livret d'accueil, CGV, attestations… (privés par défaut).
              </p>
              {admin.length ? (
                <ul className="mt-3 divide-y divide-trait">{admin.map(ligneFichier)}</ul>
              ) : (
                <p className="mt-3 text-sm text-encre-3">Aucun document administratif déposé.</p>
              )}
            </Carte>
            <Carte className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Positionnements</h2>
                  <p className="mt-0.5 text-[13px] text-encre-2">
                    Recueil des besoins et test signés par les apprenants invités sur ce parcours.
                  </p>
                </div>
                {proprietaire && (
                  <Bouton
                    taille="sm"
                    icone={<UserPlus className="size-3.5" aria-hidden />}
                    onClick={() => setModale("inviter")}
                  >
                    Inviter
                  </Bouton>
                )}
              </div>
              {c.positionnements.length ? (
                <ul className="mt-3 divide-y divide-trait">
                  {c.positionnements.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{p.apprenant}</span>
                        <span className="text-xs text-encre-3">
                          {[
                            p.entreprise,
                            p.signe_le
                              ? `signé le ${instantFr(p.signe_le)}`
                              : p.expire
                                ? "lien expiré"
                                : "en attente",
                            p.score !== null ? `score ${p.score}/100` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {p.pdf ? (
                        <a href={`/api/positionnements/${p.id}/pdf`} className={LIEN}>
                          <Download className="size-4" aria-hidden /> PDF signé
                        </a>
                      ) : (
                        <PastilleStatut
                          statut="en_attente"
                          libelle={p.statut === "en_cours" ? "En cours" : "Envoyé"}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-encre-3">Aucun positionnement sur ce parcours.</p>
              )}
            </Carte>
          </div>

          <Carte className="p-5">
            <h2 className="text-base font-semibold">Dossiers de formation sur ce parcours</h2>
            <p className="mt-0.5 text-[13px] text-encre-2">
              L'état des pièces de chaque dossier, à jour : ce qui est validé, ce qui est émis, ce
              qui reste attendu.
            </p>
            {c.dossiers.length === 0 ? (
              <p className="mt-3 text-sm text-encre-3">Aucun dossier ouvert sur ce parcours.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {c.dossiers.map((d) => (
                  <details key={d.id} className="rounded-md border border-trait">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                      <span className="chiffres font-semibold">{d.reference}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-encre-2">
                        {d.entreprise} · {d.stagiaires.join(", ")}
                        {d.dates ? ` · ${d.dates.split(" → ").map(dateFr).join(" → ")}` : ""}
                      </span>
                      <Etiquette ton="accent">{d.statut}</Etiquette>
                      <span className="flex w-full items-center gap-2 sm:w-40">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-papier-3">
                          <span
                            className="block h-full bg-valide"
                            style={{
                              width: `${d.progression.total ? Math.round((d.progression.validees / d.progression.total) * 100) : 0}%`,
                            }}
                          />
                        </span>
                        <span className="chiffres text-xs text-encre-3">
                          {d.progression.validees}/{d.progression.total}
                        </span>
                      </span>
                    </summary>
                    <ul className="divide-y divide-trait border-t border-trait">
                      {d.pieces.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                          <span className="min-w-0 flex-1 text-sm">
                            {p.statut === "valide" ? (
                              <CheckCircle2
                                className="mr-1.5 inline size-4 text-valide"
                                aria-hidden
                              />
                            ) : (
                              <Clock3 className="mr-1.5 inline size-4 text-encre-3" aria-hidden />
                            )}
                            {p.ordre ? `${p.ordre}. ` : ""}
                            {p.libelle}
                            {p.stagiaire ? ` — ${p.stagiaire}` : ""}
                          </span>
                          {p.suivi ? (
                            <PastilleStatut
                              statut={p.statut}
                              libelle={p.statut === "valide" ? "Validé" : "En attente"}
                            />
                          ) : p.depart ? (
                            <PastilleStatut statut={null} libelle="Transmis" />
                          ) : null}
                          {p.depart && (
                            <a
                              href={`/api/pieces/${p.id}/telecharger`}
                              className={LIEN}
                              aria-label={`Télécharger ${p.libelle}`}
                            >
                              <Download className="size-4" aria-hidden />
                            </a>
                          )}
                          {p.retour && (
                            <a
                              href={`/api/pieces/${p.id}/telecharger?version=retour`}
                              className={LIEN}
                            >
                              Retour signé
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-trait px-4 py-2.5">
                      <Link
                        to="/dossiers/$id"
                        params={{ id: d.id }}
                        className="text-sm font-medium text-accent hover:underline"
                      >
                        Ouvrir le dossier
                      </Link>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Carte>
        </div>
      )}

      {onglet === "corbeille" && (
        <Carte className="p-5">
          <h2 className="text-base font-semibold">Corbeille</h2>
          <p className="mt-0.5 text-[13px] text-encre-2">
            Les fichiers supprimés restent ici, restaurables, jusqu'à leur suppression définitive.
          </p>
          {c.corbeille.length ? (
            <ul className="mt-3 divide-y divide-trait">
              {c.corbeille.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.nom_fichier}</span>
                    <span className="text-xs text-encre-3">
                      {libelleCategorie(f.categorie)} · supprimé le {instantFr(f.supprime_le)}
                    </span>
                  </span>
                  <Bouton
                    taille="sm"
                    icone={<RotateCcw className="size-3.5" aria-hidden />}
                    onClick={() => action.mutate({ type: "restaurer", id: f.id })}
                  >
                    Restaurer
                  </Bouton>
                  <Bouton
                    taille="sm"
                    variante="discret"
                    onClick={() =>
                      confirm(
                        `Supprimer définitivement « ${f.nom_fichier} » ? Cette action est irréversible.`,
                      ) && action.mutate({ type: "purger", id: f.id })
                    }
                  >
                    Supprimer définitivement
                  </Bouton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-encre-3">La corbeille est vide.</p>
          )}
        </Carte>
      )}

      <Modale
        ouverte={modale === "depot"}
        fermer={() => setModale(null)}
        titre="Déposer un document dans le coffre-fort"
      >
        {modale === "depot" && (
          <DepotCoffre
            formationId={id}
            partie={onglet === "administratif" ? "administratif" : "pedagogique"}
            termine={() => {
              setModale(null);
              void rafraichir();
            }}
          />
        )}
      </Modale>
      <Modale
        ouverte={modale === "supports"}
        fermer={() => {
          setModale(null);
          void rafraichir();
        }}
        titre="Supports de cours PPTX"
        large
      >
        {modale === "supports" && <StudioSupports formationId={id} />}
      </Modale>
      <Modale
        ouverte={modale === "inviter"}
        fermer={() => setModale(null)}
        titre="Inviter à se positionner"
      >
        {modale === "inviter" && (
          <InviterPositionnement
            formationId={id}
            termine={() => {
              setModale(null);
              void rafraichir();
            }}
          />
        )}
      </Modale>
    </>
  );
}

function DepotCoffre({
  formationId,
  partie,
  termine,
}: {
  formationId: string;
  partie: "pedagogique" | "administratif";
  termine: () => void;
}) {
  const notifier = useNotifier();
  const [fichier, setFichier] = useState<File | null>(null);
  const [v, setV] = useState({
    categorie: partie === "administratif" ? "administratif" : "support",
    description: "",
    partageable: partie !== "administratif",
  });
  const deposer = useMutation({
    mutationFn: () =>
      api.fichier(`/formations/${formationId}/coffre`, fichier!, {
        categorie: v.categorie,
        description: v.description,
        partageable: v.partageable ? "oui" : "non",
      }),
    onSuccess: () => {
      notifier("succes", "Document déposé dans le coffre-fort.");
      termine();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (fichier) deposer.mutate();
      }}
    >
      <div>
        <label
          className="mb-1.5 block text-[13px] font-medium text-encre-2"
          htmlFor="fichier-coffre"
        >
          Fichier
        </label>
        <input
          id="fichier-coffre"
          type="file"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-sm file:border file:border-trait-fort file:bg-carte file:px-3 file:py-2 file:text-sm"
        />
        <p className="mt-1.5 text-[13px] text-encre-3">
          PDF, Office, images, vidéo, ZIP… jusqu'à 100 Mo.
        </p>
      </div>
      <Selecteur
        libelle="Rubrique"
        value={v.categorie}
        onChange={(e) =>
          setV({
            ...v,
            categorie: e.target.value,
            partageable:
              CATEGORIES_COFFRE.find((c) => c.valeur === e.target.value)?.partie !==
              "administratif",
          })
        }
      >
        <optgroup label="Pédagogique">
          {CATEGORIES_COFFRE.filter((c) => c.partie === "pedagogique").map((c) => (
            <option key={c.valeur} value={c.valeur}>
              {c.libelle}
            </option>
          ))}
        </optgroup>
        <optgroup label="Administratif">
          {CATEGORIES_COFFRE.filter((c) => c.partie === "administratif").map((c) => (
            <option key={c.valeur} value={c.valeur}>
              {c.libelle}
            </option>
          ))}
        </optgroup>
      </Selecteur>
      <Champ
        libelle="Description (facultatif)"
        value={v.description}
        onChange={(e) => setV({ ...v, description: e.target.value })}
      />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={v.partageable}
          onChange={(e) => setV({ ...v, partageable: e.target.checked })}
          className="mt-0.5 size-4 accent-(--color-accent)"
        />
        Partager avec les apprenants (dès l'accord de financement de leur dossier)
      </label>
      {deposer.error && <Alerte ton="danger">{deposer.error.message}</Alerte>}
      <Bouton
        type="submit"
        variante="primaire"
        disabled={!fichier}
        enCours={deposer.isPending}
        icone={<Upload className="size-4" aria-hidden />}
      >
        Déposer
      </Bouton>
    </form>
  );
}

/**
 * Atelier des supports (version 7 : toujours par l'assistant IA) : on choisit un module, on fait préparer le plan de
 * 20 diapositives à partir du dossier d'enjeux et du parcours, on l'aménage, puis on produit le PPTX, rangé dans le
 * coffre-fort. Ou tout le parcours d'un coup.
 */
export function StudioSupports({
  formation,
  formationId,
}: {
  formation?: Formation;
  formationId?: string;
}) {
  const id = formation?.id ?? formationId!;
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const ia = useEtatIa();
  const donnees = useQuery({
    queryKey: ["formation", id],
    queryFn: () => api.get<Formation>(`/formations/${id}`),
    initialData: formation,
  });
  const [module, setModule] = useState("0");
  const [diapos, setDiapos] = useState<Diapo[] | null>(null);
  const rafraichirCoffres = () =>
    Promise.all([
      requetes.invalidateQueries({ queryKey: ["coffre-parcours", id] }),
      requetes.invalidateQueries({ queryKey: ["coffre", id] }),
    ]);
  const plan = useMutation({
    mutationFn: () =>
      api.post<{ diapos: Diapo[] }>("/ia/plan-support", {
        formation_id: id,
        module_index: Number(module),
      }),
    onSuccess: (r) => setDiapos(r.diapos),
  });
  const produire = useMutation({
    mutationFn: () =>
      api.post<{ nom: string }>("/supports", {
        formation_id: id,
        module_index: Number(module),
        diapos,
      }),
    onSuccess: async (r) => {
      await rafraichirCoffres();
      notifier("succes", `« ${r.nom} » est dans le coffre-fort.`);
      setDiapos(null);
    },
  });
  const tous = useMutation({
    mutationFn: () =>
      api.post<{ produits: Array<{ nom: string }>; echecs: string[] }>("/supports/tous", {
        formation_id: id,
      }),
    onSuccess: async (r) => {
      await rafraichirCoffres();
      notifier(
        r.echecs.length ? "danger" : "succes",
        `${r.produits.length} support(s) produit(s)${r.echecs.length ? ` — ${r.echecs.length} échec(s)` : ""}.`,
      );
    },
  });
  if (!donnees.data) return <Chargement />;
  const modules = donnees.data.formation_modules as ModuleParcours[];
  const erreurs = (e: unknown) =>
    e instanceof ErreurApi && Array.isArray(e.details?.erreurs) ? e.details.erreurs : [];
  const majDiapo = (i: number, x: Partial<Diapo>) =>
    setDiapos((d) => d!.map((y, k) => (k === i ? { ...y, ...x } : y)));
  const nbModules = Math.max(modules.length, 1);

  return (
    <div className="space-y-4">
      {!ia.chargement && !ia.disponible && <AlerteIaIndisponible />}
      {modules.length === 0 && (
        <Alerte ton="attention" titre="Pas encore de parcours en modules">
          Le support sera construit sur la formation entière (objectifs et programme). Pour un
          support par module, générez d'abord le parcours dans la fiche formation.
        </Alerte>
      )}
      {!donnees.data.dossier_enjeux && (
        <Alerte>
          Cette formation n'a pas encore de dossier d'enjeux : l'assistant le constituera d'abord
          (recherche web), ce qui ajoute une minute environ.
        </Alerte>
      )}
      <Selecteur
        libelle="Module"
        value={module}
        onChange={(e) => {
          setModule(e.target.value);
          setDiapos(null);
        }}
      >
        {(modules.length
          ? modules
          : [
              {
                titre: donnees.data.formation_titre,
                duree_heures: donnees.data.formation_duree_heures_total ?? 0,
              },
            ]
        ).map((m, i) => (
          <option key={i} value={i}>
            Module {i + 1} — {m.titre} ({heuresTexte(m.duree_heures)})
          </option>
        ))}
      </Selecteur>
      <p className="text-[13px] text-encre-2">
        L'assistant rédige le contenu de chaque diapositive à partir du dossier d'enjeux et du
        module : une idée par diapositive, 3 à 5 points, un visuel suggéré, un point d'étape toutes
        les 4 à 5 diapositives, un atelier de mise en pratique (consigne, critères, débriefing), une
        synthèse et un quiz. Les notes du formateur accompagnent chaque diapositive. Vous relisez et
        aménagez le plan avant de produire le fichier.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Bouton
          variante="primaire"
          icone={<Sparkles className="size-4" aria-hidden />}
          disabled={!ia.disponible}
          enCours={plan.isPending}
          onClick={() => plan.mutate()}
        >
          Préparer le plan du module
        </Bouton>
        <Bouton
          disabled={!ia.disponible}
          enCours={tous.isPending}
          onClick={() =>
            confirm(
              `Produire directement les supports de tous les modules (${nbModules}) ? Comptez une à deux minutes par module. Les supports déjà produits passent à la corbeille.`,
            ) && tous.mutate()
          }
        >
          Produire tous les modules d'un coup
        </Bouton>
        {ia.disponible && <MentionMoteur description={ia.description} />}
      </div>
      {plan.isPending && (
        <p role="status" className="text-[13px] text-encre-3">
          Rédaction du plan de {DIAPOS_PAR_MODULE} diapositives — une à deux minutes.
        </p>
      )}
      {tous.isPending && (
        <p role="status" className="text-[13px] text-encre-3">
          Production de {nbModules} support(s), module après module — comptez une à deux minutes par
          module. Vous pouvez laisser cette fenêtre ouverte.
        </p>
      )}
      {(plan.error || tous.error) && (
        <Alerte ton="danger" titre={(plan.error ?? tous.error)!.message}>
          {erreurs(plan.error ?? tous.error).length > 0 && (
            <ul className="list-disc pl-4">
              {erreurs(plan.error ?? tous.error).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </Alerte>
      )}
      {tous.data?.echecs.length ? (
        <Alerte ton="attention" titre="Certains modules n'ont pas pu être produits">
          <ul className="list-disc pl-4">
            {tous.data.echecs.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}

      {diapos && (
        <div className="space-y-3">
          <Alerte ton="attention" titre={`Plan de ${diapos.length} diapositives`}>
            Aménagez les titres, les points (un par ligne), le visuel suggéré et vos notes, puis
            produisez le PPTX.
          </Alerte>
          <ol className="space-y-2">
            {diapos.map((d, i) => (
              <li key={i}>
                <details
                  className={cx(
                    "rounded-md border",
                    d.type === "pratique" ? "border-accent/50" : "border-trait",
                  )}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                    <span className="chiffres w-6 shrink-0 font-semibold text-accent">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{d.titre}</span>
                    <Etiquette>{d.type.replace("_", " ")}</Etiquette>
                  </summary>
                  <div className="space-y-2 border-t border-trait px-3 py-3">
                    <Champ
                      libelle="Titre"
                      value={d.titre}
                      onChange={(e) => majDiapo(i, { titre: e.target.value })}
                    />
                    <ZoneTexte
                      libelle="Points (un par ligne, 6 au plus)"
                      rows={3}
                      value={d.points.join("\n")}
                      onChange={(e) =>
                        majDiapo(i, { points: e.target.value.split("\n").slice(0, 6) })
                      }
                    />
                    <Champ
                      libelle="Visuel suggéré"
                      value={d.visuel}
                      onChange={(e) => majDiapo(i, { visuel: e.target.value })}
                    />
                    <ZoneTexte
                      libelle="Notes du formateur"
                      rows={2}
                      value={d.notes}
                      onChange={(e) => majDiapo(i, { notes: e.target.value })}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ol>
          {produire.error && (
            <Alerte ton="danger" titre={produire.error.message}>
              {erreurs(produire.error).length > 0 && (
                <ul className="list-disc pl-4">
                  {erreurs(produire.error).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </Alerte>
          )}
          <Bouton
            variante="primaire"
            icone={<Presentation className="size-4" aria-hidden />}
            enCours={produire.isPending}
            onClick={() => produire.mutate()}
          >
            Produire le PPTX et le ranger dans le coffre-fort
          </Bouton>
        </div>
      )}
    </div>
  );
}
