import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

const ETAPES = ["Création", "Finance.", "Début", "Fin", "Paiem.", "Encaissé", "Archivé"];

/** Mise en page commune des écrans d'accès (connexion, inscription, mot de passe). */
export function CoquilleAcces({
  titre,
  accroche,
  children,
  pied,
}: {
  titre: string;
  accroche: string;
  children: ReactNode;
  pied?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-encre p-12 text-sur-accent lg:flex">
        <Link to="/" className="flex items-center gap-3 font-display text-lg font-semibold">
          <span className="grid size-9 place-items-center rounded-md bg-accent">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          Dossiers de formation
        </Link>
        <div>
          <p className="max-w-[22ch] font-display text-[40px] font-semibold leading-[1.1]">
            Un dossier complet, sans courir après les signatures.
          </p>
          <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-sur-accent/70">
            De la candidature du formateur à l’archivage : chaque pièce est générée, suivie, signée
            et classée.
          </p>
        </div>
        <ol
          className="grid grid-cols-7 gap-1.5 text-[11px] font-medium text-sur-accent/60"
          aria-label="Étapes du dossier"
        >
          {ETAPES.map((e, i) => (
            <li key={e}>
              <span className={`mb-2 block h-1 ${i < 3 ? "bg-attente" : "bg-sur-accent/20"}`} />
              {e}
            </li>
          ))}
        </ol>
      </aside>
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <Link
            to="/"
            className="mb-10 flex items-center gap-2 font-display font-semibold lg:hidden"
          >
            <ShieldCheck className="size-5 text-accent" aria-hidden />
            Dossiers de formation
          </Link>
          <h1 className="text-[28px] font-semibold leading-tight">{titre}</h1>
          <p className="mt-2 text-encre-2">{accroche}</p>
          <div className="mt-8">{children}</div>
          {pied && (
            <div className="mt-8 border-t border-trait pt-5 text-sm text-encre-2">{pied}</div>
          )}
        </div>
      </main>
    </div>
  );
}

/** Séparateur « ou » entre le formulaire et la connexion Google. */
export function SeparateurOu() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-encre-3">
      <span className="h-px flex-1 bg-trait" />
      ou
      <span className="h-px flex-1 bg-trait" />
    </div>
  );
}
