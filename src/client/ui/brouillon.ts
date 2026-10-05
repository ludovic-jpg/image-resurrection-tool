/**
 * « Enregistrer à tout moment et faire réapparaître » (« Modification 1 », 23/09/2026).
 *
 * Tant qu'un formulaire n'est pas enregistré sur le serveur, son contenu est gardé DANS CE NAVIGATEUR (stockage
 * local), à chaque frappe. Si la page se ferme, plante ou si l'on part trop vite, le formulaire propose à la
 * prochaine ouverture de « reprendre le brouillon non enregistré ». Aucune donnée ne part ailleurs.
 * Le stockage local peut être indisponible (navigation privée) : tout est protégé, le formulaire marche sans.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const PREFIXE = "s4m:brouillon:";

function lire<T>(cle: string): { valeur: T; le: string } | null {
  try {
    const brut = localStorage.getItem(PREFIXE + cle);
    return brut ? (JSON.parse(brut) as { valeur: T; le: string }) : null;
  } catch {
    return null;
  }
}

/**
 * `cle` identifie le formulaire (ex. `formation:<id>` ou `formation:nouvelle`), `valeur` son état courant,
 * `initiale` l'état enregistré (le brouillon n'est proposé que s'il en diffère).
 */
export function useBrouillonLocal<T>(cle: string, valeur: T, initiale: T) {
  const [propose, setPropose] = useState<{ valeur: T; le: string } | null>(() => {
    const b = lire<T>(cle);
    return b && JSON.stringify(b.valeur) !== JSON.stringify(initiale) ? b : null;
  });
  const modifie = useRef(false);
  const depart = useRef(JSON.stringify(initiale));

  useEffect(() => {
    const courant = JSON.stringify(valeur);
    if (!modifie.current && courant === depart.current) return;
    modifie.current = true;
    const minuterie = setTimeout(() => {
      try {
        if (courant === depart.current) localStorage.removeItem(PREFIXE + cle);
        else
          localStorage.setItem(
            PREFIXE + cle,
            JSON.stringify({ valeur, le: new Date().toISOString() }),
          );
      } catch {
        /* stockage indisponible : on continue sans filet */
      }
    }, 400);
    return () => clearTimeout(minuterie);
  }, [cle, valeur]);

  /** À appeler après un enregistrement réussi sur le serveur : le filet local n'a plus lieu d'être. */
  const oublier = useCallback(
    (nouvelEtatEnregistre?: T) => {
      if (nouvelEtatEnregistre !== undefined) depart.current = JSON.stringify(nouvelEtatEnregistre);
      try {
        localStorage.removeItem(PREFIXE + cle);
      } catch {
        /* rien */
      }
      setPropose(null);
      modifie.current = false;
    },
    [cle],
  );

  return {
    propose,
    ignorer: () => {
      oublier();
    },
    accepter: () => {
      const v = propose?.valeur;
      setPropose(null);
      return v;
    },
    oublier,
  };
}
