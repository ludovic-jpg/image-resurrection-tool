/**
 * Adresse IP de l'appelant, pour la preuve de signature (équivalent de `ip(c)` de l'ancien `app.ts`).
 *
 * Sur Cloudflare Workers, `cf-connecting-ip` est posé par Cloudflare lui-même et ne se falsifie pas depuis le
 * navigateur ; à défaut (autre hébergement derrière un proxy), on retient le premier élément de `x-forwarded-for`,
 * comme le faisait l'ancien serveur. Chaîne vide hors requête (test, tâche planifiée) : l'IP est « non relevée ».
 */
export function adresseIpDe(entetes: Pick<Headers, "get"> | null | undefined): string {
  if (!entetes) return "";
  const cf = entetes.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  return (entetes.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "").slice(0, 64);
}

export async function adresseIpDeLaRequete(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    return adresseIpDe(getRequest()?.headers);
  } catch {
    return "";
  }
}
