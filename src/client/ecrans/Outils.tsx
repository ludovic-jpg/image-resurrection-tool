/**
 * Module 3 — Mes outils pédagogiques : modèles de recueil, de test de positionnement et d'évaluation des acquis
 * (F-OUT-01 à 03). « Modification 1 » (23/09/2026) puis version 7 : génération en un clic par l'assistant IA depuis le
 * parcours et son dossier d'enjeux, puis aménagement ; archives restaurables, historique des versions, versions
 * imprimables (et corrigé).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Download,
  History,
  PencilRuler,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { NOMBRES_QUESTIONS } from "@/domaine/pedagogie/listes";
import { api, ErreurApi, instantFr, type Formation, type Outil } from "../api";
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
  Selecteur,
  TitrePage,
  useNotifier,
} from "../ui/base";
import { BandeauBrouillon } from "../ui/BandeauBrouillon";
import { useBrouillonLocal } from "../ui/brouillon";
import { AlerteIaIndisponible, BoutonIaQcm, MentionMoteur, useEtatIa } from "./AssistantIa";
import { HistoriqueVersions } from "./Versions";

type TypeOutil = "recueil" | "positionnement" | "acquis";
const TYPES: Record<TypeOutil, { libelle: string; aide: string }> = {
  positionnement: {
    libelle: "Test de positionnement",
    aide: "QCM passé avant la formation, pour ajuster le programme (indicateur Qualiopi n° 8).",
  },
  acquis: {
    libelle: "Évaluation des acquis",
    aide: "QCM passé en fin de formation ; son score figure sur l'attestation (indicateur n° 11).",
  },
  recueil: {
    libelle: "Recueil des besoins",
    aide: "Les questions de l'organisme sont fixes ; vous pouvez y ajouter les vôtres.",
  },
};
type Question = { enonce: string; propositions: string[]; bonne_reponse: number };

type Proposition = { type: TypeOutil; titre: string; formation_id: string; questions: Question[] };

export function Editeur({
  initial,
  proposition,
  formations,
  fermer,
}: {
  initial?: Outil;
  proposition?: Proposition;
  formations: Formation[];
  fermer: () => void;
}) {
  const requetes = useQueryClient();
  const contenu = initial?.contenu as
    { questions?: Question[]; questions_supplementaires?: string[] } | undefined;
  const [type, setType] = useState<TypeOutil>(
    (initial?.type as TypeOutil) ?? proposition?.type ?? "positionnement",
  );
  const [titre, setTitre] = useState(initial?.titre ?? proposition?.titre ?? "");
  const [formationId, setFormationId] = useState(
    initial?.formation_id ?? proposition?.formation_id ?? "",
  );
  const [questions, setQuestions] = useState<Question[]>(
    contenu?.questions ??
      proposition?.questions ?? [{ enonce: "", propositions: ["", ""], bonne_reponse: 0 }],
  );
  const [libres, setLibres] = useState<string[]>(contenu?.questions_supplementaires ?? []);
  const etat = { type, titre, formationId, questions, libres };
  const brouillon = useBrouillonLocal(`outil:${initial?.id ?? "nouveau"}`, etat, etat);

  const enregistrer = useMutation({
    mutationFn: () => {
      const corps = {
        type,
        titre,
        formation_id: formationId || null,
        contenu:
          type === "recueil"
            ? { questions_supplementaires: libres.filter((q) => q.trim()) }
            : { titre, questions },
      };
      return initial ? api.put(`/outils/${initial.id}`, corps) : api.post("/outils", corps);
    },
    onSuccess: async () => {
      brouillon.oublier();
      await requetes.invalidateQueries({ queryKey: ["outils"] });
      await requetes.invalidateQueries({ queryKey: ["coffre-parcours"] });
      fermer();
    },
  });
  const details =
    enregistrer.error instanceof ErreurApi ? enregistrer.error.details?.erreurs : undefined;
  const maj = (i: number, q: Partial<Question>) =>
    setQuestions(questions.map((x, k) => (k === i ? { ...x, ...q } : x)));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        enregistrer.mutate();
      }}
    >
      {brouillon.propose && !proposition && (
        <BandeauBrouillon
          le={brouillon.propose.le}
          reprendre={() => {
            const b = brouillon.accepter();
            if (b) {
              setType(b.type);
              setTitre(b.titre);
              setFormationId(b.formationId);
              setQuestions(b.questions);
              setLibres(b.libres);
            }
          }}
          ignorer={brouillon.ignorer}
        />
      )}
      {proposition && (
        <Alerte ton="attention" titre="Brouillon généré">
          Relisez chaque question et chaque bonne réponse, aménagez-les, puis enregistrez : vous en
          êtes l'auteur.
        </Alerte>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Selecteur
          libelle="Type d'outil"
          value={type}
          disabled={!!initial}
          onChange={(e) => setType(e.target.value as TypeOutil)}
          aide={TYPES[type].aide}
        >
          {Object.entries(TYPES).map(([cle, t]) => (
            <option key={cle} value={cle}>
              {t.libelle}
            </option>
          ))}
        </Selecteur>
        <Selecteur
          libelle="Formation rattachée"
          value={formationId}
          onChange={(e) => setFormationId(e.target.value)}
          aide="Sans rattachement, le modèle sert de recours pour toutes vos formations."
        >
          <option value="">— Toutes mes formations —</option>
          {formations.map((f) => (
            <option key={f.id} value={f.id}>
              {f.formation_titre}
            </option>
          ))}
        </Selecteur>
      </div>
      <Champ libelle="Titre" required value={titre} onChange={(e) => setTitre(e.target.value)} />

      {type === "recueil" ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[13px] font-medium text-encre-2">
            Questions supplémentaires
          </legend>
          {libres.map((q, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={q}
                aria-label={`Question supplémentaire ${i + 1}`}
                onChange={(e) => setLibres(libres.map((x, k) => (k === i ? e.target.value : x)))}
                className="h-10 min-w-0 flex-1 rounded-sm border border-trait-fort bg-carte px-3 text-sm focus:border-accent focus:outline-none"
              />
              <Bouton
                variante="discret"
                aria-label="Retirer"
                icone={<Trash2 className="size-4" aria-hidden />}
                onClick={() => setLibres(libres.filter((_, k) => k !== i))}
              />
            </div>
          ))}
          <Bouton
            variante="discret"
            taille="sm"
            disabled={libres.length >= 10}
            icone={<Plus className="size-4" aria-hidden />}
            onClick={() => setLibres([...libres, ""])}
          >
            Ajouter une question
          </Bouton>
        </fieldset>
      ) : (
        <div className="space-y-4">
          <BoutonIaQcm
            formationId={formationId}
            type={type as "positionnement" | "acquis"}
            recevoir={(q) => {
              setQuestions(q.questions);
              if (!titre.trim()) setTitre(q.titre);
            }}
          />
          {questions.map((q, i) => (
            <fieldset key={i} className="rounded-md border border-trait bg-papier-2/60 p-4">
              <div className="flex items-start gap-2">
                <span className="chiffres mt-2.5 w-6 shrink-0 font-display font-semibold text-accent">
                  {i + 1}.
                </span>
                <input
                  value={q.enonce}
                  placeholder="Énoncé de la question"
                  aria-label={`Énoncé de la question ${i + 1}`}
                  onChange={(e) => maj(i, { enonce: e.target.value })}
                  className="h-10 min-w-0 flex-1 rounded-sm border border-trait-fort bg-carte px-3 text-sm font-medium focus:border-accent focus:outline-none"
                />
                <Bouton
                  variante="discret"
                  aria-label="Supprimer la question"
                  disabled={questions.length === 1}
                  icone={<Trash2 className="size-4" aria-hidden />}
                  onClick={() => setQuestions(questions.filter((_, k) => k !== i))}
                />
              </div>
              <div className="mt-3 space-y-1.5 pl-8">
                {q.propositions.map((p, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`bonne-${i}`}
                      checked={q.bonne_reponse === j}
                      onChange={() => maj(i, { bonne_reponse: j })}
                      aria-label={`Bonne réponse : proposition ${j + 1}`}
                      className="size-4 shrink-0 accent-(--color-accent)"
                    />
                    <input
                      value={p}
                      placeholder={`Proposition ${j + 1}`}
                      aria-label={`Proposition ${j + 1}`}
                      onChange={(e) =>
                        maj(i, {
                          propositions: q.propositions.map((x, k) =>
                            k === j ? e.target.value : x,
                          ),
                        })
                      }
                      className={cx(
                        "h-9 min-w-0 flex-1 rounded-sm border bg-carte px-3 text-sm focus:border-accent focus:outline-none",
                        q.bonne_reponse === j ? "border-valide" : "border-trait-fort",
                      )}
                    />
                    <Bouton
                      variante="discret"
                      taille="sm"
                      aria-label="Retirer la proposition"
                      disabled={q.propositions.length <= 2}
                      icone={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() =>
                        maj(i, {
                          propositions: q.propositions.filter((_, k) => k !== j),
                          bonne_reponse: Math.min(q.bonne_reponse, q.propositions.length - 2),
                        })
                      }
                    />
                  </div>
                ))}
                <Bouton
                  variante="discret"
                  taille="sm"
                  disabled={q.propositions.length >= 8}
                  icone={<Plus className="size-3.5" aria-hidden />}
                  onClick={() => maj(i, { propositions: [...q.propositions, ""] })}
                >
                  Proposition
                </Bouton>
              </div>
            </fieldset>
          ))}
          <p className="text-[13px] text-encre-3">
            Cochez la bonne réponse de chaque question. Le corrigé n'est jamais transmis à
            l'apprenant.
          </p>
          <Bouton
            disabled={questions.length >= 40}
            icone={<Plus className="size-4" aria-hidden />}
            onClick={() =>
              setQuestions([...questions, { enonce: "", propositions: ["", ""], bonne_reponse: 0 }])
            }
          >
            Ajouter une question
          </Bouton>
        </div>
      )}

      {enregistrer.error && (
        <Alerte ton="danger" titre={enregistrer.error.message}>
          {Array.isArray(details) && (
            <ul className="list-disc pl-4">
              {details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </Alerte>
      )}
      <Bouton type="submit" variante="primaire" enCours={enregistrer.isPending}>
        Enregistrer le modèle
      </Bouton>
    </form>
  );
}

export function Outils() {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const [edition, setEdition] = useState<{ outil?: Outil } | null>(null);
  const [versions, setVersions] = useState<Outil | null>(null);
  const [generation, setGeneration] = useState(false);
  const [vue, setVue] = useState<"actifs" | "archives">("actifs");
  const outils = useQuery({
    queryKey: ["outils", vue],
    queryFn: () => api.get<Outil[]>(`/outils${vue === "archives" ? "?archives=1" : ""}`),
  });
  const formations = useQuery({
    queryKey: ["formations", "actives"],
    queryFn: () => api.get<Formation[]>("/formations"),
  });
  const supprimer = useMutation({
    mutationFn: (id: string) => api.suppr(`/outils/${id}`),
    onSuccess: async () => {
      await requetes.invalidateQueries({ queryKey: ["outils"] });
      notifier("succes", "Modèle archivé : il se restaure depuis l'onglet « Archivés ».");
    },
  });
  const restaurer = useMutation({
    mutationFn: (id: string) => api.post(`/outils/${id}/restaurer`),
    onSuccess: async () => {
      await requetes.invalidateQueries({ queryKey: ["outils"] });
      notifier("succes", "Modèle restauré.");
    },
  });
  if (outils.isPending || formations.isPending) return <Chargement />;
  const titreFormation = (id: string | null) =>
    formations.data?.find((f) => f.id === id)?.formation_titre;

  return (
    <>
      <TitrePage
        titre="Outils pédagogiques"
        soustitre="Vos modèles de questionnaires. À la création d'un dossier, celui de la formation est repris tel quel — le modifier ensuite ne réécrit pas les dossiers existants."
        actions={
          <>
            <Bouton
              icone={<Sparkles className="size-4" aria-hidden />}
              onClick={() => setGeneration(true)}
            >
              Générer depuis un parcours
            </Bouton>
            <Bouton
              variante="primaire"
              icone={<Plus className="size-4" aria-hidden />}
              onClick={() => setEdition({})}
            >
              Nouveau modèle
            </Bouton>
          </>
        }
      />
      <Onglets
        actif={vue}
        choisir={setVue}
        onglets={[
          { cle: "actifs", libelle: "Mes modèles" },
          { cle: "archives", libelle: "Archivés" },
        ]}
      />
      {vue === "archives" ? (
        outils.data?.length ? (
          <Carte>
            <ul className="divide-y divide-trait">
              {outils.data.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{o.titre}</p>
                    <p className="text-[13px] text-encre-3">
                      {TYPES[o.type as TypeOutil].libelle} · archivé le {instantFr(o.archive_le)}
                    </p>
                  </div>
                  <Bouton
                    taille="sm"
                    icone={<RotateCcw className="size-3.5" aria-hidden />}
                    onClick={() => restaurer.mutate(o.id)}
                  >
                    Restaurer
                  </Bouton>
                </li>
              ))}
            </ul>
          </Carte>
        ) : (
          <EtatVide icone={<Archive className="size-8" aria-hidden />} titre="Aucun modèle archivé">
            Un modèle supprimé est archivé ici : il se restaure d'un clic.
          </EtatVide>
        )
      ) : outils.data?.length ? (
        <Carte>
          <ul className="divide-y divide-trait">
            {outils.data.map((o) => {
              const nb =
                (o.contenu as { questions?: unknown[]; questions_supplementaires?: unknown[] })
                  .questions?.length ??
                (o.contenu as { questions_supplementaires?: unknown[] }).questions_supplementaires
                  ?.length ??
                0;
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{o.titre}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-encre-2">
                      <Etiquette ton="accent">{TYPES[o.type as TypeOutil].libelle}</Etiquette>
                      <span className="chiffres">{nb} question(s)</span>
                      <span className="truncate">
                        · {titreFormation(o.formation_id) ?? "Toutes mes formations"}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Bouton taille="sm" onClick={() => setEdition({ outil: o })}>
                      Modifier
                    </Bouton>
                    <a
                      href={`/api/outils/${o.id}/document`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] text-encre-2 hover:bg-papier-3"
                      title="Version imprimable, sans corrigé"
                    >
                      <Download className="size-3.5" aria-hidden /> Imprimable
                    </a>
                    {o.type !== "recueil" && (
                      <a
                        href={`/api/outils/${o.id}/document?corrige=1`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] text-encre-2 hover:bg-papier-3"
                      >
                        <Download className="size-3.5" aria-hidden /> Corrigé
                      </a>
                    )}
                    <Bouton
                      variante="discret"
                      taille="sm"
                      aria-label={`Historique de ${o.titre}`}
                      icone={<History className="size-3.5" aria-hidden />}
                      onClick={() => setVersions(o)}
                    />
                    <Bouton
                      variante="discret"
                      taille="sm"
                      aria-label={`Supprimer ${o.titre}`}
                      icone={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() =>
                        confirm(
                          `Archiver le modèle « ${o.titre} » ? Les dossiers déjà créés gardent leur copie ; vous pourrez le restaurer.`,
                        ) && supprimer.mutate(o.id)
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Carte>
      ) : (
        <EtatVide
          icone={<PencilRuler className="size-8" aria-hidden />}
          titre="Aucun modèle pour l'instant"
          action={
            <Bouton variante="primaire" onClick={() => setEdition({})}>
              Créer un test de positionnement
            </Bouton>
          }
        >
          Sans test de positionnement, un dossier ne peut pas être soumis à la validation de
          l'organisme.
        </EtatVide>
      )}
      <Modale
        ouverte={edition !== null}
        fermer={() => setEdition(null)}
        titre={edition?.outil ? "Modifier le modèle" : "Nouveau modèle"}
        large
      >
        {edition && (
          <Editeur
            initial={edition.outil}
            formations={formations.data ?? []}
            fermer={() => setEdition(null)}
          />
        )}
      </Modale>
      <Modale
        ouverte={versions !== null}
        fermer={() => setVersions(null)}
        titre={`Historique — ${versions?.titre ?? ""}`}
        large
      >
        {versions && (
          <HistoriqueVersions
            type="outil"
            id={versions.id}
            restaure={() => {
              setVersions(null);
              void requetes.invalidateQueries({ queryKey: ["outils"] });
            }}
          />
        )}
      </Modale>
      <Modale
        ouverte={generation}
        fermer={() => setGeneration(false)}
        titre="Générer un questionnaire depuis un parcours"
        large
      >
        {generation && (
          <GenerateurTest formations={formations.data ?? []} termine={() => setGeneration(false)} />
        )}
      </Modale>
    </>
  );
}

/**
 * Génération d'un test de positionnement ou d'une évaluation des acquis depuis un parcours (« Modification 1 », puis
 * version 7 : toujours par l'assistant IA, à partir du dossier d'enjeux et du parcours — questions de connaissances).
 * Le résultat s'ouvre dans l'éditeur : on aménage, puis on enregistre.
 */
export function GenerateurTest({
  formationId,
  type: typeInitial,
  formations,
  termine,
}: {
  formationId?: string;
  type?: "positionnement" | "acquis";
  formations?: Formation[];
  termine: () => void;
}) {
  const ia = useEtatIa();
  const liste = useQuery({
    queryKey: ["formations", "actives"],
    queryFn: () => api.get<Formation[]>("/formations"),
    enabled: !formations,
  });
  const toutes = formations ?? liste.data ?? [];
  const [choix, setChoix] = useState({
    formation_id: formationId ?? "",
    type: typeInitial ?? "positionnement",
    nombre: "10",
  });
  const generer = useMutation({
    mutationFn: () =>
      api.post<{ questionnaire: { titre: string; questions: Question[] }; source: string }>(
        "/ia/test",
        {
          formation_id: choix.formation_id,
          type: choix.type,
          nombre: Number(choix.nombre),
        },
      ),
  });
  if (generer.data) {
    return (
      <Editeur
        formations={toutes}
        proposition={{
          type: choix.type,
          titre: generer.data.questionnaire.titre,
          formation_id: choix.formation_id,
          questions: generer.data.questionnaire.questions,
        }}
        fermer={termine}
      />
    );
  }
  const erreurs =
    generer.error instanceof ErreurApi && Array.isArray(generer.error.details?.erreurs)
      ? generer.error.details.erreurs
      : [];
  const formationChoisie = toutes.find((f) => f.id === choix.formation_id);
  return (
    <div className="space-y-4">
      {!ia.chargement && !ia.disponible && <AlerteIaIndisponible />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Selecteur
          libelle="Parcours de formation"
          value={choix.formation_id}
          disabled={Boolean(formationId)}
          onChange={(e) => setChoix({ ...choix, formation_id: e.target.value })}
        >
          <option value="">— Choisir —</option>
          {toutes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.formation_titre}
            </option>
          ))}
        </Selecteur>
        <Selecteur
          libelle="Questionnaire"
          value={choix.type}
          onChange={(e) =>
            setChoix({ ...choix, type: e.target.value as "positionnement" | "acquis" })
          }
        >
          <option value="positionnement">Test de positionnement (avant la formation)</option>
          <option value="acquis">Évaluation des acquis (fin de formation)</option>
        </Selecteur>
        <Selecteur
          libelle="Nombre de questions (au plus)"
          value={choix.nombre}
          onChange={(e) => setChoix({ ...choix, nombre: e.target.value })}
        >
          {NOMBRES_QUESTIONS.map((n) => (
            <option key={n} value={n}>
              {n} questions
            </option>
          ))}
        </Selecteur>
      </div>
      <p className="text-[13px] text-encre-2">
        L'assistant rédige des questions de connaissances à choix multiples, fondées sur le dossier
        d'enjeux et le parcours de la formation : le test de positionnement mesure le niveau de
        départ (indicateur Qualiopi n° 8), l'évaluation des acquis ce qui a été appris (indicateur
        n° 11). Vous relisez chaque question et chaque bonne réponse avant d'enregistrer.
      </p>
      {formationChoisie && !formationChoisie.dossier_enjeux && (
        <Alerte>
          Cette formation n'a pas encore de dossier d'enjeux : il sera constitué d'abord (recherche
          web), ce qui ajoute une minute environ.
        </Alerte>
      )}
      {generer.error && (
        <Alerte ton="danger" titre={generer.error.message}>
          {erreurs.length > 0 && (
            <ul className="list-disc pl-4">
              {erreurs.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </Alerte>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Bouton
          variante="primaire"
          icone={<Sparkles className="size-4" aria-hidden />}
          disabled={!choix.formation_id || !ia.disponible}
          enCours={generer.isPending}
          onClick={() => generer.mutate()}
        >
          Générer le brouillon
        </Bouton>
        {ia.disponible && <MentionMoteur description={ia.description} />}
        {generer.isPending && (
          <span className="text-[12.5px] text-encre-3">
            Rédaction en cours — une à deux minutes.
          </span>
        )}
      </div>
    </div>
  );
}
