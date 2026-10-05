/** Historique des versions d'une formation ou d'un questionnaire, avec restauration (« faire réapparaître »). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { api, instantFr } from "../api";
import { Alerte, Bouton, Chargement, useNotifier } from "../ui/base";

type Version = { id: string; cree_le: string; libelle: string; apercu: string };

export function HistoriqueVersions({ type, id, restaure }: { type: "formation" | "outil"; id: string; restaure: () => void }) {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const versions = useQuery({ queryKey: ["versions", type, id], queryFn: () => api.get<Version[]>(`/versions/${type}/${id}`) });
  const restaurer = useMutation({
    mutationFn: (versionId: string) => api.post(`/versions/${versionId}/restaurer`),
    onSuccess: async () => {
      await requetes.invalidateQueries();
      notifier("succes", "Version restaurée. L'état précédent a lui-même été gardé dans l'historique.");
      restaure();
    },
    onError: (e) => notifier("danger", e.message),
  });
  if (versions.isPending) return <Chargement />;
  if (versions.error) return <Alerte ton="danger">{versions.error.message}</Alerte>;
  if (versions.data.length === 0) return <Alerte>Aucune version antérieure : l'historique commence au premier enregistrement qui suit la création.</Alerte>;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-encre-2">Chaque enregistrement conserve l'état précédent (50 versions au plus). Restaurer une version est réversible : l'état actuel est d'abord mis de côté.</p>
      <ul className="divide-y divide-trait rounded-md border border-trait">
        {versions.data.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{instantFr(v.cree_le)}</p>
              <p className="truncate text-[13px] text-encre-2">{v.apercu}</p>
            </div>
            <Bouton taille="sm" icone={<RotateCcw className="size-3.5" aria-hidden />} enCours={restaurer.isPending && restaurer.variables === v.id} onClick={() => confirm("Restaurer cette version ?") && restaurer.mutate(v.id)}>
              Restaurer
            </Bouton>
          </li>
        ))}
      </ul>
    </div>
  );
}
