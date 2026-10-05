/** Formats d'affichage français. Les montants sont manipulés en CENTIMES (entiers) : jamais de flottants. */

export function formaterDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function formaterHeure(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? `${m[1]!.padStart(2, "0")} h ${m[2]}` : "";
}

export function formaterMontant(centimes: number | null | undefined): string {
  if (centimes === null || centimes === undefined || !Number.isFinite(centimes)) return "";
  const negatif = centimes < 0;
  const abs = Math.abs(Math.round(centimes));
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const cts = (abs % 100).toString().padStart(2, "0");
  return `${negatif ? "−" : ""}${euros},${cts} €`;
}

export function formaterNombre(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return (Math.round(n * 100) / 100).toString().replace(".", ",");
}

export function formaterPourcentage(p: number | null | undefined): string {
  const n = formaterNombre(p);
  return n === "" ? "" : `${n} %`;
}

const LIBELLES_MODALITE: Record<string, string> = {
  presentiel: "Présentiel",
  distanciel: "Distanciel",
  mixte: "Mixte (présentiel et distanciel)",
};

export function formaterModalite(m: string | null | undefined): string {
  return m ? (LIBELLES_MODALITE[m] ?? m) : "";
}

/** Durée d'une séance en heures décimales, à partir de « HH:MM ». */
export function dureeSeanceHeures(debut: string, fin: string): number {
  const min = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const d = min(fin) - min(debut);
  return Number.isFinite(d) && d > 0 ? d / 60 : 0;
}
