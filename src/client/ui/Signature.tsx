/**
 * Signature manuscrite : tracé à la souris, au doigt ou au stylet (Pointer Events), exporté en PNG.
 * Aucune bibliothèque. Le lieu et le consentement sont saisis ici ; l'horodatage, lui, est posé par le serveur.
 */
import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import { Bouton, Champ, cx } from "./base";

export function ZoneDeTrace({ surChangement, hauteur = 170 }: { surChangement: (png: string | null) => void; hauteur?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dessin = useRef({ actif: false, vide: true, x: 0, y: 0 });
  const [vide, setVide] = useState(true);

  // Le canevas suit la densité de l'écran : le tracé reste net sur un téléphone comme sur un grand écran.
  useEffect(() => {
    const canvas = ref.current!;
    const ajuster = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const { width } = canvas.getBoundingClientRect();
      // Ne réinitialiser que si la LARGEUR change : l'ouverture du clavier d'un téléphone ne doit pas effacer le tracé.
      if (Math.round(width * ratio) === canvas.width && canvas.height === Math.round(hauteur * ratio)) return;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(hauteur * ratio);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = getComputedStyle(canvas).color;
      dessin.current.vide = true;
      setVide(true);
      surChangement(null);
    };
    ajuster();
    const observateur = new ResizeObserver(ajuster);
    observateur.observe(canvas.parentElement!);
    return () => observateur.disconnect();
    // `surChangement` est un setState chez tous les appelants : référence stable, volontairement hors dépendances.
  }, [hauteur]);

  const position = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <div className={cx("relative overflow-hidden rounded-md border-2 border-dashed bg-papier", vide ? "border-trait-fort" : "border-accent/50")}>
        <canvas
          ref={ref}
          style={{ height: hauteur, touchAction: "none" }}
          className="block w-full cursor-crosshair text-encre"
          aria-label="Zone de signature : tracez votre signature à la souris ou au doigt"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            Object.assign(dessin.current, { actif: true, ...position(e) });
          }}
          onPointerMove={(e) => {
            const d = dessin.current;
            if (!d.actif) return;
            const p = position(e);
            const ctx = ref.current!.getContext("2d")!;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            Object.assign(d, p, { vide: false });
          }}
          onPointerUp={() => {
            dessin.current.actif = false;
            if (!dessin.current.vide) {
              setVide(false);
              surChangement(ref.current!.toDataURL("image/png"));
            }
          }}
        />
        {vide && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-encre-3">
            <PenLine className="size-4" aria-hidden /> Signez ici
          </p>
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <Bouton
          variante="discret"
          taille="sm"
          disabled={vide}
          icone={<Eraser className="size-3.5" aria-hidden />}
          onClick={() => {
            const canvas = ref.current!;
            canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
            dessin.current.vide = true;
            setVide(true);
            surChangement(null);
          }}
        >
          Effacer
        </Bouton>
      </div>
    </div>
  );
}

export interface DemandeSignature {
  trace_png: string;
  lieu: string;
  consentement: boolean;
}

export function FormulaireSignature({ libelleDocument, enCours, erreur, signer }: { libelleDocument: string; enCours: boolean; erreur?: string; signer: (d: DemandeSignature) => void }) {
  const [trace, setTrace] = useState<string | null>(null);
  const [lieu, setLieu] = useState("");
  const [consentement, setConsentement] = useState(false);
  const pret = trace !== null && lieu.trim() !== "" && consentement;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pret) signer({ trace_png: trace, lieu: lieu.trim(), consentement });
      }}
    >
      <ZoneDeTrace surChangement={setTrace} />
      <Champ libelle="Fait à" placeholder="Ville" value={lieu} onChange={(e) => setLieu(e.target.value)} required maxLength={120} autoComplete="address-level2" />
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-trait bg-papier-2 p-3 text-[13.5px] leading-relaxed text-encre-2">
        <input type="checkbox" checked={consentement} onChange={(e) => setConsentement(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-(--color-accent)" />
        <span>
          J'ai lu le document « {libelleDocument} » et je le signe électroniquement. La date et l'heure de ma signature sont enregistrées, ainsi qu'une empreinte du document qui permet de prouver qu'il n'a pas
          été modifié ensuite.
        </span>
      </label>
      {erreur && <p className="text-sm text-danger">{erreur}</p>}
      <Bouton type="submit" variante="primaire" enCours={enCours} disabled={!pret} className="w-full">
        Signer le document
      </Bouton>
    </form>
  );
}
