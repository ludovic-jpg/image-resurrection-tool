/** Cadre de l'application : exige une session, affiche la navigation propre à chaque rôle (rail latéral, tiroir sur mobile). */
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  Building2,
  ClipboardCheck,
  ClipboardSignature,
  FilePen,
  FileSpreadsheet,
  FolderKanban,
  FolderLock,
  House,
  IdCard,
  LogOut,
  Mail,
  Menu,
  PencilRuler,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { navigationPour, type CleIcone, type LienNav } from "../navigation";
import { useDeconnexion, useMoi } from "../session";
import { Chargement, cx } from "../ui/base";

const ICONES: Record<CleIcone, (c: string) => React.ReactNode> = {
  formations: (c) => <BookOpen className={c} />,
  outils: (c) => <PencilRuler className={c} />,
  apprenants: (c) => <UsersRound className={c} />,
  convention: (c) => <FilePen className={c} />,
  dossiers: (c) => <FolderKanban className={c} />,
  bpf: (c) => <FileSpreadsheet className={c} />,
  courriers: (c) => <Mail className={c} />,
  candidatures: (c) => <ClipboardCheck className={c} />,
  organisme: (c) => <Building2 className={c} />,
  coffre: (c) => <FolderLock className={c} />,
  positionnement: (c) => <ClipboardSignature className={c} />,
  profil: (c) => <IdCard className={c} />,
  archives: (c) => <Archive className={c} />,
};

export function Icone({ cle, className = "size-[18px]" }: { cle: CleIcone; className?: string }) {
  return <>{ICONES[cle](className)}</>;
}

const ROLES: Record<string, string> = {
  admin: "Organisme de formation",
  formateur: "Formateur",
  apprenant: "Apprenant",
};

export function Cadre() {
  const moi = useMoi();
  const deconnecter = useDeconnexion();
  const { pathname } = useLocation();
  const [tiroir, setTiroir] = useState(false);
  useEffect(() => setTiroir(false), [pathname]);

  // La garde du routeur (`beforeLoad`) a déjà vérifié la session : ici, l'acteur existe.
  const acteur = moi.data?.acteur;
  if (!acteur)
    return (
      <div className="px-8">
        <Chargement />
      </div>
    );

  // Menu principal : trois espaces pour le formateur (pédagogique, apprenant, formation) — voir navigation.ts.
  const { accueil, espaces, personnels } = navigationPour(acteur.role, acteur.formateur_valide);
  const lien = (l: LienNav, icone: React.ReactNode) => (
    <Link
      key={l.vers}
      to={l.vers}
      activeOptions={{ exact: l.exact ?? false }}
      className="flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium text-encre-2 transition-colors duration-150 hover:bg-papier-3 hover:text-encre"
      activeProps={{ className: "!bg-accent-doux !text-accent-fort" }}
    >
      {icone}
      {l.libelle}
    </Link>
  );
  const navigation = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Navigation principale">
      {accueil && lien(accueil, <House className="size-[18px]" aria-hidden />)}
      {espaces.map((e) => (
        <div key={e.cle} role="group" aria-label={e.titre} className="mt-3 first:mt-0">
          {espaces.length > 1 && (
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-encre-3 uppercase">
              {e.titre}
            </p>
          )}
          <div className="flex flex-col gap-0.5">{e.liens.map((l) => lien(l, <Icone cle={l.icone} />))}</div>
        </div>
      ))}
      {personnels.length > 0 && (
        <div role="group" aria-label="Mon espace" className="mt-3">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-encre-3 uppercase">
            Mon espace
          </p>
          <div className="flex flex-col gap-0.5">
            {personnels.map((l) => lien(l, <Icone cle={l.icone} />))}
          </div>
        </div>
      )}
    </nav>
  );
  const pied = (
    <div className="border-t border-trait pt-3">
      <Link
        to="/compte"
        className="flex items-center gap-3 rounded-sm px-3 py-2 hover:bg-papier-3"
        activeProps={{ className: "!bg-accent-doux" }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-papier-3 text-encre-2">
          <UserRound className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium">{acteur.nom}</span>
          <span className="block text-xs text-encre-3">{ROLES[acteur.role]}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={deconnecter}
        className="mt-1 flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm text-encre-3 hover:bg-papier-3 hover:text-encre"
      >
        <LogOut className="size-[18px]" aria-hidden />
        Se déconnecter
      </button>
    </div>
  );
  const marque = (
    <div className="flex items-center gap-2.5 px-3 pb-6">
      <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-accent text-sur-accent">
        <ShieldCheck className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 truncate font-display text-[15px] leading-tight font-semibold">
        {moi.data?.organisme?.nom ?? "Dossiers de formation"}
      </span>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-trait bg-papier-2 p-4 lg:flex">
        {marque}
        {navigation}
        {pied}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-trait bg-papier/95 px-4 py-3 backdrop-blur lg:hidden">
        <span className="min-w-0 truncate font-display font-semibold">{moi.data?.organisme?.nom}</span>
        <button
          type="button"
          onClick={() => setTiroir(true)}
          aria-label="Ouvrir le menu"
          className="rounded-sm p-2 hover:bg-papier-3"
        >
          <Menu className="size-5" />
        </button>
      </header>
      {tiroir && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-encre/40"
            onClick={() => setTiroir(false)}
          />
          <div
            className={cx(
              "absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-papier-2 p-4 shadow-flottant",
            )}
          >
            <div className="flex items-start justify-between">
              {marque}
              <button
                type="button"
                onClick={() => setTiroir(false)}
                aria-label="Fermer"
                className="rounded-sm p-1.5 hover:bg-papier-3"
              >
                <X className="size-5" />
              </button>
            </div>
            {navigation}
            {pied}
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
