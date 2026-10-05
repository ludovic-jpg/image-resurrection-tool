/**
 * Petit système de composants de l'application. Chaque élément interactif couvre ses huit états :
 * repos · survol · focus visible · appui · désactivé · chargement · erreur · succès.
 * Toutes les couleurs passent par les jetons de `styles.css` — aucune valeur en dur ici.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, Check, CircleAlert, Clock3, Info, Loader2, Upload, X } from "lucide-react";

export const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

// ——— Bouton ———
type VarianteBouton = "primaire" | "secondaire" | "discret" | "danger";
const VARIANTES: Record<VarianteBouton, string> = {
  primaire: "bg-accent text-sur-accent hover:bg-accent-fort active:bg-accent-fort shadow-carte",
  secondaire: "bg-carte text-encre border border-trait-fort hover:bg-papier-2 active:bg-papier-3",
  discret: "text-encre-2 hover:bg-papier-3 hover:text-encre active:bg-papier-3",
  danger: "bg-danger text-sur-accent hover:brightness-95 active:brightness-90",
};

export function Bouton({
  variante = "secondaire",
  taille = "md",
  enCours = false,
  icone,
  children,
  className,
  disabled,
  ...reste
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBouton;
  taille?: "sm" | "md";
  enCours?: boolean;
  icone?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...reste}
      disabled={disabled || enCours}
      aria-busy={enCours || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-sm font-medium whitespace-nowrap select-none",
        "transition-[background-color,transform,filter] duration-150 ease-(--ease-out) active:translate-y-px",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0",
        taille === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        VARIANTES[variante],
        className,
      )}
    >
      {enCours ? <Loader2 className="size-4 tourne" aria-hidden /> : icone}
      {children}
    </button>
  );
}

// ——— Champs ———
const BASE_CHAMP =
  "w-full rounded-sm border bg-carte px-3 text-sm text-encre placeholder:text-encre-3 transition-[border-color,box-shadow] duration-150 " +
  "border-trait-fort hover:border-encre-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 " +
  "disabled:bg-papier-2 disabled:text-encre-3 disabled:cursor-not-allowed aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15";

function Enveloppe({
  id,
  libelle,
  aide,
  erreur,
  requis,
  children,
}: {
  id: string;
  libelle: string;
  aide?: string | undefined;
  erreur?: string | undefined;
  requis?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-encre-2">
        {libelle}
        {requis && <span className="text-danger"> *</span>}
      </label>
      {children}
      {erreur ? (
        <p id={`${id}-erreur`} className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {erreur}
        </p>
      ) : aide ? (
        <p className="mt-1.5 text-[13px] text-encre-3">{aide}</p>
      ) : null}
    </div>
  );
}

export type PropsChamp = {
  libelle: string;
  aide?: string | undefined;
  erreur?: string | undefined;
};

export function Champ({
  libelle,
  aide,
  erreur,
  className,
  ...reste
}: InputHTMLAttributes<HTMLInputElement> & PropsChamp) {
  const id = useId();
  return (
    <Enveloppe id={id} libelle={libelle} aide={aide} erreur={erreur} requis={reste.required}>
      <input
        id={id}
        {...reste}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
        className={cx(BASE_CHAMP, "h-10", className)}
      />
    </Enveloppe>
  );
}

export function ZoneTexte({
  libelle,
  aide,
  erreur,
  className,
  ...reste
}: TextareaHTMLAttributes<HTMLTextAreaElement> & PropsChamp) {
  const id = useId();
  return (
    <Enveloppe id={id} libelle={libelle} aide={aide} erreur={erreur} requis={reste.required}>
      <textarea
        id={id}
        rows={4}
        {...reste}
        aria-invalid={erreur ? true : undefined}
        className={cx(BASE_CHAMP, "py-2.5 leading-relaxed", className)}
      />
    </Enveloppe>
  );
}

export function Selecteur({
  libelle,
  aide,
  erreur,
  className,
  children,
  ...reste
}: SelectHTMLAttributes<HTMLSelectElement> & PropsChamp) {
  const id = useId();
  return (
    <Enveloppe id={id} libelle={libelle} aide={aide} erreur={erreur} requis={reste.required}>
      <select
        id={id}
        {...reste}
        aria-invalid={erreur ? true : undefined}
        className={cx(BASE_CHAMP, "h-10 pr-8", className)}
      >
        {children}
      </select>
    </Enveloppe>
  );
}

// ——— Surfaces ———
export function Carte({ children, className, ...reste }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...reste}
      className={cx("rounded-md border border-trait bg-carte shadow-carte", className)}
    >
      {children}
    </div>
  );
}

export function TitrePage({
  titre,
  soustitre,
  actions,
}: {
  titre: string;
  soustitre?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight text-encre">{titre}</h1>
        {soustitre && <p className="mt-1 max-w-[70ch] text-encre-2">{soustitre}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ——— Statut d'une pièce : binaire, comme le cahier des charges (RG-03) ———
export function PastilleStatut({
  statut,
  libelle,
}: {
  statut: "en_attente" | "valide" | null;
  libelle: string;
}) {
  if (statut === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-trait bg-papier-2 px-2.5 py-1 text-xs font-medium text-encre-2">
        <Info className="size-3.5" aria-hidden />
        {libelle}
      </span>
    );
  }
  const valide = statut === "valide";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        valide ? "bg-valide-doux text-valide" : "bg-attente-doux text-attente-encre",
      )}
    >
      {valide ? (
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      ) : (
        <Clock3 className="size-3.5" aria-hidden />
      )}
      {libelle}
    </span>
  );
}

export function Etiquette({
  children,
  ton = "neutre",
}: {
  children: ReactNode;
  ton?: "neutre" | "accent" | "attente" | "danger";
}) {
  const tons = {
    neutre: "bg-papier-3 text-encre-2",
    accent: "bg-accent-doux text-accent-fort",
    attente: "bg-attente-doux text-attente-encre",
    danger: "bg-danger-doux text-danger",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-xs px-1.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap",
        tons[ton],
      )}
    >
      {children}
    </span>
  );
}

export function Alerte({
  ton = "info",
  titre,
  children,
}: {
  ton?: "info" | "attention" | "danger" | "succes";
  titre?: string;
  children?: ReactNode;
}) {
  const styles = {
    info: [
      "border-trait bg-papier-2 text-encre-2",
      <Info key="i" className="size-4.5" aria-hidden />,
    ],
    attention: [
      "border-attente/60 bg-attente-doux text-attente-encre",
      <AlertTriangle key="i" className="size-4.5" aria-hidden />,
    ],
    danger: [
      "border-danger/30 bg-danger-doux text-danger",
      <CircleAlert key="i" className="size-4.5" aria-hidden />,
    ],
    succes: [
      "border-valide/30 bg-valide-doux text-valide",
      <Check key="i" className="size-4.5" aria-hidden />,
    ],
  } as const;
  const [classes, icone] = styles[ton];
  return (
    <div
      role={ton === "danger" ? "alert" : "status"}
      className={cx("flex gap-3 rounded-md border px-4 py-3 text-sm", classes)}
    >
      <span className="mt-0.5 shrink-0">{icone}</span>
      <div className="min-w-0">
        {titre && <p className="font-semibold">{titre}</p>}
        {children && (
          <div className={cx(titre && "mt-0.5", "text-[13.5px] leading-relaxed")}>{children}</div>
        )}
      </div>
    </div>
  );
}

export function ListeManques({ titre, manques }: { titre: string; manques: string[] }) {
  if (manques.length === 0) return null;
  return (
    <Alerte ton="attention" titre={titre}>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {manques.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </Alerte>
  );
}

export function EtatVide({
  icone,
  titre,
  children,
  action,
}: {
  icone?: ReactNode;
  titre: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-trait-fort px-6 py-12 text-center">
      {icone && <div className="mb-3 text-encre-3">{icone}</div>}
      <p className="font-display text-base font-semibold">{titre}</p>
      {children && <p className="mt-1 max-w-[52ch] text-sm text-encre-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Chargement({ libelle = "Chargement…" }: { libelle?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-16 text-sm text-encre-3" role="status">
      <Loader2 className="size-4 tourne" aria-hidden />
      {libelle}
    </div>
  );
}

// ——— Modale : l'élément <dialog> natif (piège de focus, Échap et fond gérés par le navigateur) ———
export function Modale({
  ouverte,
  fermer,
  titre,
  children,
  large = false,
}: {
  ouverte: boolean;
  fermer: () => void;
  titre: string;
  children: ReactNode;
  large?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ouverte && !d.open) d.showModal();
    if (!ouverte && d.open) d.close();
  }, [ouverte]);
  return (
    <dialog
      ref={ref}
      onClose={fermer}
      onClick={(e) => e.target === ref.current && fermer()}
      className={cx(
        "m-auto w-[calc(100vw-2rem)] rounded-lg border border-trait bg-carte p-0 text-encre shadow-flottant",
        large ? "max-w-4xl" : "max-w-lg",
      )}
    >
      {ouverte && (
        <div className="flex max-h-[calc(100dvh-3rem)] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-trait px-5 py-3.5">
            <h2 className="text-base font-semibold">{titre}</h2>
            <button
              type="button"
              onClick={fermer}
              aria-label="Fermer"
              className="rounded-sm p-1.5 text-encre-3 hover:bg-papier-3 hover:text-encre"
            >
              <X className="size-4.5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Onglets<T extends string>({
  onglets,
  actif,
  choisir,
}: {
  onglets: Array<{ cle: T; libelle: string; compteur?: string }>;
  actif: T;
  choisir: (cle: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-trait px-1"
    >
      {onglets.map((o) => (
        <button
          key={o.cle}
          role="tab"
          type="button"
          aria-selected={o.cle === actif}
          onClick={() => choisir(o.cle)}
          className={cx(
            "relative -mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
            o.cle === actif
              ? "border-accent text-encre"
              : "border-transparent text-encre-3 hover:text-encre hover:border-trait-fort",
          )}
        >
          {o.libelle}
          {o.compteur && (
            <span className="chiffres rounded-full bg-papier-3 px-1.5 text-[11px] font-semibold text-encre-2">
              {o.compteur}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ——— Dépôt de fichier ———
export function DepotFichier({
  libelle,
  accept,
  enCours,
  deposer,
  compact = false,
}: {
  libelle: string;
  accept?: string;
  enCours?: boolean;
  deposer: (f: File) => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) deposer(f);
          e.target.value = "";
        }}
      />
      <Bouton
        variante="secondaire"
        taille={compact ? "sm" : "md"}
        enCours={enCours ?? false}
        icone={<Upload className="size-4" aria-hidden />}
        onClick={() => ref.current?.click()}
      >
        {libelle}
      </Bouton>
    </>
  );
}

// ——— Notifications : succès discrets, erreurs lisibles ———
type Toast = { id: number; ton: "succes" | "danger"; message: string };
const ContexteToasts = createContext<(ton: Toast["ton"], message: string) => void>(() => undefined);
export const useNotifier = () => useContext(ContexteToasts);

export function FournisseurToasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notifier = useCallback((ton: Toast["ton"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, ton, message }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      ton === "danger" ? 8000 : 3500,
    );
  }, []);
  return (
    <ContexteToasts.Provider value={notifier}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-md px-4 py-3 text-sm shadow-flottant",
              t.ton === "danger" ? "bg-danger text-sur-accent" : "bg-encre text-sur-accent",
            )}
          >
            {t.ton === "danger" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ContexteToasts.Provider>
  );
}
