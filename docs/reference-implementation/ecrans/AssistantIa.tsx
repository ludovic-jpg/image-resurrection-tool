/**
 * Assistant IA de l'espace pédagogique (cahier des charges oral du 23/09/2026, puis version 7).
 * Version 7 : plus aucune « trame » sans IA — toute génération passe par l'assistant. Quand il n'est pas configuré,
 * les boutons de génération sont désactivés et une alerte explique où le régler (Organisme → Assistant IA).
 * L'IA ne remplit qu'un BROUILLON dans le formulaire : le formateur relit, corrige, puis enregistre lui-même.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, ErreurApi, type EtatIa } from "../api";
import { Alerte, Bouton } from "../ui/base";

/** État de l'assistant IA de l'organisme : disponible ? avec quel moteur ? (mis en cache cinq minutes). */
export function useEtatIa(): { disponible: boolean; description: string; chargement: boolean } {
  const etat = useQuery({ queryKey: ["ia-etat"], queryFn: () => api.get<EtatIa>("/ia/etat"), staleTime: 5 * 60_000 });
  return { disponible: etat.data?.disponible === true, description: etat.data?.description ?? "", chargement: etat.isPending };
}

export function useIaDisponible(): boolean {
  return useEtatIa().disponible;
}

/** Alerte affichée à la place d'un générateur quand l'assistant n'est pas configuré. */
export function AlerteIaIndisponible() {
  return (
    <Alerte ton="attention" titre="L'assistant IA n'est pas configuré">
      L'administrateur de l'organisme le règle dans <strong>Organisme → Assistant IA</strong>. En attendant, la génération est indisponible : vous pouvez tout rédiger à la main.
    </Alerte>
  );
}

/** Mention discrète du moteur, à côté d'un bouton de génération (ex. « Sonnet 5 + recherche web »). */
export function MentionMoteur({ description, className }: { description: string; className?: string }) {
  if (!description) return null;
  return (
    <span className={["inline-flex items-center gap-1.5 text-[12.5px] text-encre-3", className].filter(Boolean).join(" ")}>
      <Sparkles className="size-3.5" aria-hidden />
      {description}
    </span>
  );
}

type Question = { enonce: string; propositions: string[]; bonne_reponse: number };

export function BoutonIaQcm({ formationId, type, recevoir }: { formationId: string; type: "positionnement" | "acquis"; recevoir: (q: { titre: string; questions: Question[] }) => void }) {
  const ia = useEtatIa();
  const proposer = useMutation({
    mutationFn: () => api.post<{ questionnaire: { titre: string; questions: Question[] } }>("/ia/qcm", { formation_id: formationId, type, nombre: 10 }),
    onSuccess: (r) => recevoir(r.questionnaire),
  });
  if (ia.chargement) return null;
  if (!ia.disponible) return <AlerteIaIndisponible />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Bouton variante="secondaire" taille="sm" icone={<Sparkles className="size-3.5" aria-hidden />} disabled={!formationId} title={formationId ? undefined : "Rattachez d'abord le modèle à une formation"} enCours={proposer.isPending} onClick={() => proposer.mutate()}>
          Proposer 10 questions avec l'IA
        </Bouton>
        <MentionMoteur description={ia.description} />
      </div>
      {proposer.isPending && <p className="text-[13px] text-encre-3">Rédaction en cours à partir du dossier d'enjeux et du parcours — une minute environ.</p>}
      {proposer.isSuccess && <Alerte ton="attention" titre="Brouillon proposé par l'IA">Relisez chaque question et chaque bonne réponse avant d'enregistrer : vous en êtes l'auteur.</Alerte>}
      {proposer.error && <Alerte ton="danger">{proposer.error.message}</Alerte>}
    </div>
  );
}

export function BoutonIaProgramme({ contexte, recevoir }: { contexte: { formation_titre: string; formation_niveau: string; public_vise: string; formation_prerequis: string; formation_duree_heures_total: number | null }; recevoir: (p: { formation_objectifs: string; programme: string }) => void }) {
  const ia = useEtatIa();
  const proposer = useMutation({
    mutationFn: () => api.post<{ formation_objectifs: string; programme: string }>("/ia/programme", contexte),
    onSuccess: recevoir,
  });
  if (!ia.disponible) return null;
  const erreurs = proposer.error instanceof ErreurApi && Array.isArray(proposer.error.details?.erreurs) ? proposer.error.details.erreurs : [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Bouton variante="secondaire" taille="sm" icone={<Sparkles className="size-3.5" aria-hidden />} disabled={contexte.formation_titre.trim().length < 3} enCours={proposer.isPending} onClick={() => proposer.mutate()}>
          Proposer objectifs et programme avec l'IA
        </Bouton>
        <MentionMoteur description={ia.description} />
      </div>
      {proposer.isSuccess && <Alerte ton="attention" titre="Brouillon proposé par l'IA">Objectifs et programme ont été pré-remplis ci-dessous. Relisez et corrigez avant d'enregistrer.</Alerte>}
      {proposer.error && (
        <Alerte ton="danger" titre={proposer.error.message}>
          {erreurs.length > 0 && <ul className="list-disc pl-4">{erreurs.map((e) => <li key={e}>{e}</li>)}</ul>}
        </Alerte>
      )}
    </div>
  );
}
