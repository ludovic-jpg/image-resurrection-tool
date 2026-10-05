/**
 * Archives, corbeille et sauvegarde (« Modification 1 », 23/09/2026 : « garde un point sur l'archivage des données, et
 * la possibilité d'enregistrer à tout moment et de faire réapparaître des choses »).
 * Tout ce qui a été archivé ou supprimé par le formateur est ici, restaurable d'un clic ; la sauvegarde exporte
 * l'espace pédagogique dans un fichier, et la restauration le recrée (en copies, sans rien écraser).
 */
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, RotateCcw, Upload } from "lucide-react";
import { api, instantFr, octets, type Archives as VueArchives } from "../api";
import { Alerte, Bouton, Carte, Chargement, TitrePage, useNotifier } from "../ui/base";

type Rubrique = keyof VueArchives;

const RUBRIQUES: Array<{ cle: Rubrique; titre: string; restaurer: (id: string) => Promise<unknown> }> = [
  { cle: "formations", titre: "Formations archivées", restaurer: (id) => api.post(`/formations/${id}/restaurer`) },
  { cle: "outils", titre: "Questionnaires archivés", restaurer: (id) => api.post(`/outils/${id}/restaurer`) },
  { cle: "fichiers", titre: "Corbeille du coffre-fort", restaurer: (id) => api.post(`/coffre/${id}/restaurer`) },
  { cle: "stagiaires", titre: "Fiches apprenants archivées", restaurer: (id) => api.post(`/stagiaires/${id}/archiver`, { archiver: false }) },
  { cle: "entreprises", titre: "Entreprises archivées", restaurer: (id) => api.post(`/entreprises/${id}/archiver`, { archiver: false }) },
  { cle: "positionnements", titre: "Positionnements archivés", restaurer: (id) => api.post(`/positionnements/${id}/archiver`, { archiver: false }) },
];

export function Archives() {
  const requetes = useQueryClient();
  const notifier = useNotifier();
  const fichier = useRef<HTMLInputElement>(null);
  const vue = useQuery({ queryKey: ["archives"], queryFn: () => api.get<VueArchives>("/archives") });
  const restaurer = useMutation({
    mutationFn: (x: { rubrique: Rubrique; id: string }) => RUBRIQUES.find((r) => r.cle === x.rubrique)!.restaurer(x.id),
    onSuccess: async () => { await requetes.invalidateQueries(); notifier("succes", "Restauré : l'élément a réapparu à sa place."); },
    onError: (e) => notifier("danger", e.message),
  });
  const importer = useMutation({
    mutationFn: (f: File) => api.fichier<{ formations: number; outils: number; erreurs: string[] }>("/sauvegarde/import", f),
    onSuccess: async (r) => { await requetes.invalidateQueries(); notifier(r.erreurs.length ? "danger" : "succes", `Restauration : ${r.formations} formation(s) et ${r.outils} questionnaire(s) recréés${r.erreurs.length ? ` — ${r.erreurs.length} élément(s) écarté(s)` : ""}.`); },
    onError: (e) => notifier("danger", e.message),
  });
  if (vue.isPending) return <Chargement />;
  if (vue.error) return <Alerte ton="danger">{vue.error.message}</Alerte>;
  const total = RUBRIQUES.reduce((n, r) => n + vue.data[r.cle].length, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <TitrePage titre="Archives et sauvegarde" soustitre="Rien n'est détruit d'un clic : ce que vous archivez ou supprimez attend ici, prêt à réapparaître. Les dossiers de formation, eux, sont archivés par l'organisme et conservés selon sa durée légale." />

      <Carte className="mb-6 p-5">
        <h2 className="text-base font-semibold">Sauvegarde de mon espace pédagogique</h2>
        <p className="mt-1 text-[13px] text-encre-2">Un fichier JSON avec vos formations (et leurs parcours), vos questionnaires, vos fiches apprenants et entreprises. Gardez-le en lieu sûr ; il sert aussi à recréer vos formations sur une autre installation.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/sauvegarde/export" className="inline-flex h-10 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-sur-accent hover:bg-accent-fort"><Download className="size-4" aria-hidden /> Télécharger ma sauvegarde</a>
          <input ref={fichier} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f && confirm("Recréer les formations et questionnaires de cette sauvegarde ? Des copies « (restaurée) » seront ajoutées ; rien n'est écrasé.")) importer.mutate(f); e.target.value = ""; }} />
          <Bouton icone={<Upload className="size-4" aria-hidden />} enCours={importer.isPending} onClick={() => fichier.current?.click()}>Restaurer depuis une sauvegarde</Bouton>
        </div>
        {importer.data?.erreurs.length ? <div className="mt-3"><Alerte ton="attention" titre="Éléments écartés"><ul className="list-disc pl-4">{importer.data.erreurs.map((x) => <li key={x}>{x}</li>)}</ul></Alerte></div> : null}
      </Carte>

      {total === 0 ? (
        <Alerte titre="Rien à restaurer">Vos archives et votre corbeille sont vides.</Alerte>
      ) : (
        <div className="space-y-4">
          {RUBRIQUES.filter((r) => vue.data[r.cle].length > 0).map((r) => (
            <Carte key={r.cle} className="p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Archive className="size-4 text-encre-3" aria-hidden /> {r.titre} <span className="chiffres text-encre-3">({vue.data[r.cle].length})</span></h2>
              <ul className="mt-3 divide-y divide-trait">
                {(vue.data[r.cle] as Array<{ id: string; depuis: string | null; titre?: string; nom?: string; formation?: string; taille?: number }>).map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{x.titre ?? x.nom}</span>
                      <span className="text-xs text-encre-3">{[x.formation, x.taille !== undefined ? octets(x.taille) : "", `depuis le ${instantFr(x.depuis)}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Bouton taille="sm" icone={<RotateCcw className="size-3.5" aria-hidden />} enCours={restaurer.isPending && restaurer.variables?.id === x.id} onClick={() => restaurer.mutate({ rubrique: r.cle, id: x.id })}>Restaurer</Bouton>
                  </li>
                ))}
              </ul>
            </Carte>
          ))}
        </div>
      )}
    </div>
  );
}
