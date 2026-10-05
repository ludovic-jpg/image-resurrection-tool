// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxBd } from "@/test/faux-supabase";
import { ouvrirArchive } from "./archive.server";

afterEach(() => vi.unstubAllEnvs());

describe("archive Storage", () => {
  it("écrit dans le bucket `archive` sous <of_id>/ et renvoie le chemin relatif", async () => {
    const { bd, stockage } = fauxBd();
    const a = ouvrirArchive(bd as never, { ofId: "of1" });
    const chemin = await a.ecrire("of1/candidatures/f1/cv.pdf", "contenu", "application/pdf");
    expect(chemin).toBe("of1/candidatures/f1/cv.pdf");
    expect(bd.storage.from).toHaveBeenCalledWith("archive");
    const [cheminEnvoye, corps, options] = stockage.upload.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      { upsert: boolean; contentType: string },
    ];
    expect(cheminEnvoye).toBe("of1/candidatures/f1/cv.pdf");
    expect(new TextDecoder().decode(corps)).toBe("contenu");
    expect(options).toMatchObject({ upsert: true, contentType: "application/pdf" });
  });

  it("refuse tout chemin hors de l'organisme avant de toucher Storage", async () => {
    const { bd, stockage } = fauxBd();
    const a = ouvrirArchive(bd as never, { ofId: "of1" });
    for (const mauvais of ["of2/x/y.pdf", "of1/../of2/y.pdf", "/of1/x.pdf", "y.pdf"]) {
      await expect(a.lire(mauvais)).rejects.toThrow(/Chemin de fichier invalide/);
      await expect(a.ecrire(mauvais, "x")).rejects.toThrow(/invalide/);
      await expect(a.supprimer(mauvais)).rejects.toThrow(/invalide/);
      await expect(a.urlSignee(mauvais)).rejects.toThrow(/invalide/);
    }
    await expect(a.deplacer("of1/a/b.pdf", "of2/a/b.pdf")).rejects.toThrow(/invalide/);
    expect(stockage.upload).not.toHaveBeenCalled();
    expect(stockage.download).not.toHaveBeenCalled();
    expect(stockage.remove).not.toHaveBeenCalled();
    expect(stockage.move).not.toHaveBeenCalled();
    expect(stockage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("lit en Uint8Array, signe un lien avec nom de téléchargement, déplace, supprime", async () => {
    const { bd, stockage } = fauxBd();
    const a = ouvrirArchive(bd as never, { ofId: "of1" });
    expect([...(await a.lire("of1/dossiers/ADF/Retour/x.pdf"))]).toEqual([1, 2, 3]);
    expect(await a.urlSignee("of1/dossiers/ADF/Retour/x.pdf", 30, "Mon fichier.pdf")).toBe(
      "https://stockage.test/signe",
    );
    expect(stockage.createSignedUrl).toHaveBeenCalledWith("of1/dossiers/ADF/Retour/x.pdf", 30, {
      download: "Mon fichier.pdf",
    });
    await a.deplacer("of1/tmp/a.pdf", "of1/dossiers/ADF/Retour/a.pdf");
    expect(stockage.move).toHaveBeenCalledWith("of1/tmp/a.pdf", "of1/dossiers/ADF/Retour/a.pdf");
    await a.supprimer("of1/tmp/a.pdf");
    expect(stockage.remove).toHaveBeenCalledWith(["of1/tmp/a.pdf"]);
  });

  it("existe : cherche le nom exact dans le dossier parent", async () => {
    const { bd, stockage } = fauxBd();
    stockage.list.mockResolvedValue({ data: [{ name: "a.pdf" }] as never, error: null });
    const a = ouvrirArchive(bd as never, { ofId: "of1" });
    expect(await a.existe("of1/x/a.pdf")).toBe(true);
    expect(await a.existe("of1/x/b.pdf")).toBe(false);
    expect(stockage.list).toHaveBeenCalledWith("of1/x", { limit: 100, search: "a.pdf" });
  });

  it("choisit le bucket demandé, ou celui d'une variable d'environnement", async () => {
    const { bd } = fauxBd();
    ouvrirArchive(bd as never, { ofId: "of1", bucket: "coffre" })
      .supprimer("of1/a/b")
      .catch(() => {});
    expect(bd.storage.from).toHaveBeenLastCalledWith("coffre");
    vi.stubEnv("ARCHIVE_BUCKET", "archive-test");
    await ouvrirArchive(bd as never, { ofId: "of1" }).supprimer("of1/a/b");
    expect(bd.storage.from).toHaveBeenLastCalledWith("archive-test");
  });

  it("transforme une erreur Storage en panne sans exposer le détail à l'utilisateur", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bd, stockage } = fauxBd();
    stockage.download.mockResolvedValue({
      data: null as never,
      error: { message: "boom" } as never,
    });
    await expect(ouvrirArchive(bd as never, { ofId: "of1" }).lire("of1/a/b")).rejects.toThrow(
      /lecture impossible/,
    );
    spy.mockRestore();
  });
});
