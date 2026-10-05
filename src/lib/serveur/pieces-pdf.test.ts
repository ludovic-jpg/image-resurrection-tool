// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertirEnPdf, pdfConfigure } from "./pieces-pdf.server";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // « %PDF-1 »
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("conversion PDF (Gotenberg)", () => {
  it("sans PDF_SERVICE_URL : aucun appel, repli HTML (null)", async () => {
    vi.stubEnv("PDF_SERVICE_URL", "");
    const f = vi.fn();
    expect(pdfConfigure()).toBe(false);
    expect(await convertirEnPdf("<p>x</p>", { fetch: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("avec le service : POST multipart vers /forms/chromium/convert/html, clé en Bearer", async () => {
    vi.stubEnv("PDF_SERVICE_URL", "https://pdf.exemple.fr/");
    vi.stubEnv("PDF_API_KEY", "secret");
    const f = vi.fn(async () => new Response(PDF, { status: 200 }));
    const sortie = await convertirEnPdf("<p>x</p>", { fetch: f as unknown as typeof fetch });
    expect(sortie).toEqual(PDF);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pdf.exemple.fr/forms/chromium/convert/html");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("files")).toBeInstanceOf(Blob);
  });

  it("service en erreur, réponse qui n'est pas un PDF, ou panne réseau : null, sans exception", async () => {
    vi.stubEnv("PDF_SERVICE_URL", "https://pdf.exemple.fr");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cas = [
      async () => new Response("erreur", { status: 500 }),
      async () => new Response("<html>", { status: 200 }),
      async () => {
        throw new TypeError("réseau");
      },
    ];
    for (const c of cas)
      expect(await convertirEnPdf("<p>x</p>", { fetch: c as unknown as typeof fetch })).toBeNull();
  });
});
