/**
 * Accueil, selon le rôle :
 *  - formateur : le menu principal des trois espaces (pédagogique, apprenant, formation) — CdC oral du 23/09/2026 ;
 *  - admin : le pipeline « Tous les dossiers » — sept colonnes, de gauche à droite (F-CRM-01, F-CRM-02) ;
 *    le formateur retrouve ce même pipeline dans « Espace formation → Mes dossiers » (`MesDossiers`) ;
 *  - apprenant : ses formations, et ce qui est attendu de lui.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArrowRight, CalendarDays, FolderPlus, Search, UserRound } from "lucide-react";
import { api, dateFr, type CarteDossier, type ListeDossiers } from "../api";
import { useActeur } from "../session";
import { Bouton, Chargement, cx, EtatVide, Etiquette, TitrePage } from "../ui/base";
import { ESPACES_FORMATEUR } from "../navigation";
import { Icone } from "./Cadre";

export function Accueil() {
  const acteur = useActeur();
  const liste = useQuery({ queryKey: ["dossiers"], queryFn: () => api.get<ListeDossiers>("/dossiers") });
  if (liste.isPending) return <Chargement />;
  if (liste.error) return <p className="text-danger">{liste.error.message}</p>;
  if (acteur.role === "apprenant")
    return <MesFormations liste={liste.data} prenom={acteur.nom.split(" ")[0] ?? ""} />;
  // Formateur : le menu principal des trois espaces (cahier des charges oral du 23/09/2026). Admin : le pipeline.
  if (acteur.role === "formateur")
    return <MenuEspaces liste={liste.data} prenom={acteur.nom.split(" ")[0] ?? ""} />;
  return <Pipeline liste={liste.data} admin />;
}

/** « Mes dossiers » du formateur (espace formation) — et « Tous les dossiers » pour l'admin qui suivrait ce lien. */
export function MesDossiers() {
  const acteur = useActeur();
  const liste = useQuery({ queryKey: ["dossiers"], queryFn: () => api.get<ListeDossiers>("/dossiers") });
  if (liste.isPending) return <Chargement />;
  if (liste.error) return <p className="text-danger">{liste.error.message}</p>;
  return <Pipeline liste={liste.data} admin={acteur.role === "admin"} />;
}

const TONS_ESPACE = {
  pedagogique: "bg-accent-doux text-accent-fort",
  apprenant: "bg-attente-doux text-attente-encre",
  formation: "bg-papier-3 text-encre",
  administration: "bg-papier-3 text-encre",
} as const;

function MenuEspaces({ liste, prenom }: { liste: ListeDossiers; prenom: string }) {
  const aTraiter = liste.dossiers.filter((d) => d.sous_statut === "brouillon").length;
  const enCours = liste.dossiers.filter((d) => !d.archive).length;
  const indicateur: Partial<Record<string, string>> = {
    "/dossiers":
      enCours === 0
        ? "aucun dossier en cours"
        : enCours === 1
          ? "1 dossier en cours"
          : `${enCours} dossiers en cours`,
    "/dossiers/nouveau":
      aTraiter > 0 ? (aTraiter === 1 ? "1 brouillon à finaliser" : `${aTraiter} brouillons à finaliser`) : "",
  };
  return (
    <>
      <TitrePage
        titre={`Bonjour ${prenom}`}
        soustitre="Trois espaces : préparez vos formations, suivez vos apprenants, instruisez vos dossiers."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {ESPACES_FORMATEUR.map((e) => (
          <section
            key={e.cle}
            aria-label={e.titre}
            className="flex flex-col rounded-lg border border-trait bg-carte p-5 shadow-carte"
          >
            <h2 className="flex items-center gap-2.5 text-lg font-semibold">
              <span className={cx("grid size-9 place-items-center rounded-md", TONS_ESPACE[e.cle])}>
                <Icone cle={e.liens[0]!.icone} className="size-[18px]" />
              </span>
              {e.titre}
            </h2>
            <p className="mt-2 text-sm text-encre-2">{e.description}</p>
            <ul className="mt-4 flex flex-1 flex-col gap-1.5">
              {e.liens.map((l) => (
                <li key={l.vers}>
                  <Link
                    to={l.vers}
                    className="group flex items-center gap-3 rounded-md border border-trait px-3 py-2.5 transition-colors duration-150 hover:border-accent/60 hover:bg-papier-2"
                  >
                    <Icone cle={l.icone} className="size-4 shrink-0 text-encre-3 group-hover:text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{l.libelle}</span>
                      {(indicateur[l.vers] || l.aide) && (
                        <span className="block truncate text-xs text-encre-3">
                          {indicateur[l.vers] || l.aide}
                        </span>
                      )}
                    </span>
                    <ArrowRight
                      className="size-4 shrink-0 text-encre-3 transition-transform duration-150 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function Avancement({ validees, total }: { validees: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-2" title={`${validees} pièce(s) validée(s) sur ${total}`}>
      <div className="flex h-1.5 flex-1 gap-px overflow-hidden rounded-full">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cx("flex-1", i < validees ? "bg-valide" : "bg-attente/70")} />
        ))}
      </div>
      <span className="chiffres shrink-0 text-[11px] font-medium text-encre-3">
        {validees}/{total}
      </span>
    </div>
  );
}

function Carte({ d, admin }: { d: CarteDossier; admin: boolean }) {
  return (
    <Link
      to="/dossiers/$id"
      params={{ id: d.id }}
      className={cx(
        "group block rounded-md border bg-carte p-3.5 shadow-carte transition-[border-color,transform] duration-150 ease-(--ease-out) hover:-translate-y-px hover:border-accent/60",
        d.archive ? "border-trait opacity-75 hover:opacity-100" : "border-trait",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <span className="chiffres text-[11px] font-semibold tracking-wide whitespace-nowrap text-encre-3">
          {d.dossier_reference}
        </span>
        <Etiquette
          ton={
            d.sous_statut === "refus_financement"
              ? "danger"
              : d.archive
                ? "neutre"
                : d.sous_statut === "en_cours_validation"
                  ? "attente"
                  : "accent"
          }
        >
          {d.libelle_statut}
        </Etiquette>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-semibold text-encre">{d.formation_titre}</p>
      <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13px] text-encre-2">
        <UserRound className="size-3.5 shrink-0 text-encre-3" aria-hidden />
        <span className="truncate">{d.apprenants.join(", ") || "—"}</span>
      </p>
      <p className="chiffres mt-1 flex items-center gap-1.5 text-[13px] text-encre-2">
        <CalendarDays className="size-3.5 shrink-0 text-encre-3" aria-hidden />
        {d.formation_date_debut
          ? `${dateFr(d.formation_date_debut)} → ${dateFr(d.formation_date_fin)}`
          : "Dates à définir"}
      </p>
      {admin && d.formateur && (
        <p className="mt-1 truncate text-xs text-encre-3">Formateur : {d.formateur}</p>
      )}
      <div className="mt-3">
        <Avancement validees={d.pieces_validees} total={d.pieces_total} />
      </div>
    </Link>
  );
}

function Pipeline({ liste, admin }: { liste: ListeDossiers; admin: boolean }) {
  const [recherche, setRecherche] = useState("");
  const [archives, setArchives] = useState(true);
  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return liste.dossiers.filter(
      (d) =>
        (archives || !d.archive) &&
        (!q ||
          [d.dossier_reference, d.formation_titre, d.formateur, ...d.apprenants]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
  }, [liste.dossiers, recherche, archives]);
  const aValider = liste.dossiers.filter((d) => d.sous_statut === "en_cours_validation").length;

  return (
    <>
      <TitrePage
        titre={admin ? "Tous les dossiers" : "Mes dossiers"}
        soustitre={
          admin
            ? aValider > 0
              ? aValider === 1
                ? "1 dossier attend votre validation."
                : `${aValider} dossiers attendent votre validation.`
              : "Aucun dossier en attente de validation."
            : "Chaque carte avance de gauche à droite, de la création à l'archivage."
        }
        actions={
          !admin && (
            <Link to="/dossiers/nouveau">
              <Bouton variante="primaire" icone={<FolderPlus className="size-4" aria-hidden />}>
                Nouveau dossier
              </Bouton>
            </Link>
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 basis-full sm:max-w-xs sm:basis-auto sm:flex-1">
          <span className="sr-only">Rechercher un dossier</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-encre-3"
            aria-hidden
          />
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Référence, formation, apprenant…"
            className="h-10 w-full rounded-sm border border-trait-fort bg-carte pr-3 pl-9 text-sm placeholder:text-encre-3 hover:border-encre-3 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-encre-2">
          <input
            type="checkbox"
            checked={archives}
            onChange={(e) => setArchives(e.target.checked)}
            className="size-4 accent-(--color-accent)"
          />
          Afficher les dossiers archivés
        </label>
      </div>

      {liste.dossiers.length === 0 ? (
        <EtatVide
          icone={<FolderPlus className="size-8" aria-hidden />}
          titre="Aucun dossier pour l'instant"
          action={
            !admin && (
              <Link to="/dossiers/nouveau">
                <Bouton variante="primaire">Créer mon premier dossier</Bouton>
              </Link>
            )
          }
        >
          {admin
            ? "Les dossiers créés par les formateurs apparaîtront ici."
            : "Un dossier réunit un apprenant, son entreprise et une formation. Créez d'abord une formation et une fiche apprenant si ce n'est pas fait."}
        </EtatVide>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8">
          <div className="grid auto-cols-[minmax(248px,1fr)] grid-flow-col gap-3 max-lg:auto-cols-[78vw] sm:max-lg:auto-cols-[320px]">
            {liste.etapes.map((etape) => {
              const cartes = filtres.filter((d) => d.etape === etape.cle);
              return (
                <section
                  key={etape.cle}
                  aria-label={etape.titre}
                  className="flex min-w-0 flex-col rounded-lg bg-papier-2 p-2.5"
                >
                  <header className="flex items-baseline justify-between gap-2 px-1.5 pt-1 pb-3">
                    <h2 className="min-w-0 text-[13px] leading-tight font-semibold text-encre">
                      <span className="mr-1.5 text-encre-3">{etape.cle}</span>
                      {etape.titre}
                    </h2>
                    <span className="chiffres shrink-0 text-xs font-semibold text-encre-3">
                      {cartes.length}
                    </span>
                  </header>
                  <div className="flex flex-1 flex-col gap-2">
                    {cartes.map((d) => (
                      <Carte key={d.id} d={d} admin={admin} />
                    ))}
                    {cartes.length === 0 && (
                      <p className="rounded-md border border-dashed border-trait-fort px-3 py-6 text-center text-xs text-encre-3">
                        Aucun dossier
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function MesFormations({ liste, prenom }: { liste: ListeDossiers; prenom: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <TitrePage
        titre={`Bonjour ${prenom}`}
        soustitre="Retrouvez ici vos formations et les documents qui attendent votre retour."
      />
      {liste.dossiers.length === 0 ? (
        <EtatVide titre="Aucune formation pour l'instant">
          Dès que votre formateur vous aura inscrit à une formation, elle apparaîtra ici.
        </EtatVide>
      ) : (
        <ul className="space-y-3">
          {liste.dossiers.map((d) => {
            const enAttente = d.pieces_total - d.pieces_validees;
            return (
              <li key={d.id}>
                <Link
                  to="/dossiers/$id"
                  params={{ id: d.id }}
                  className="group flex items-center gap-4 rounded-md border border-trait bg-carte p-4 shadow-carte transition-[border-color] duration-150 hover:border-accent/60 sm:p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[17px] leading-snug font-semibold">{d.formation_titre}</p>
                    <p className="chiffres mt-1 text-sm text-encre-2">
                      {d.formation_date_debut
                        ? `Du ${dateFr(d.formation_date_debut)} au ${dateFr(d.formation_date_fin)}`
                        : "Dates à venir"}{" "}
                      · {d.formateur}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {d.archive ? (
                        <Etiquette>
                          <Archive className="mr-1 size-3" aria-hidden />
                          Terminé
                        </Etiquette>
                      ) : enAttente > 0 ? (
                        <Etiquette ton="attente">
                          {enAttente === 1 ? "1 document à traiter" : `${enAttente} documents à traiter`}
                        </Etiquette>
                      ) : (
                        <Etiquette ton="accent">Vous êtes à jour</Etiquette>
                      )}
                    </div>
                  </div>
                  <ArrowRight
                    className="size-5 shrink-0 text-encre-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
