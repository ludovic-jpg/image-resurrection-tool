/**
 * Les deux espaces de communication (cahier des charges 6.4.2 et 6.4.3). Une ligne par pièce, un statut binaire,
 * et pour chaque pièce les deux voies de retour : signer en ligne, ou télécharger / signer / redéposer (F-COM-06).
 * L'interface ne décide de rien : `peut_signer` et `peut_deposer` viennent du serveur.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileCheck2, PenLine, RefreshCw, ShieldCheck, ShieldX } from "lucide-react";
import { api, instantFr, type Dossier, type Integrite, type Piece } from "../api";
import { useActeur } from "../session";
import {
  Alerte,
  Bouton,
  Carte,
  DepotFichier,
  EtatVide,
  Modale,
  PastilleStatut,
  useNotifier,
} from "../ui/base";
import { FormulaireSignature } from "../ui/Signature";

export function useRafraichirDossier(id: string) {
  const requetes = useQueryClient();
  return () =>
    Promise.all([
      requetes.invalidateQueries({ queryKey: ["dossier", id] }),
      requetes.invalidateQueries({ queryKey: ["dossiers"] }),
      requetes.invalidateQueries({ queryKey: ["courriers"] }),
    ]);
}

function nomStagiaire(d: Dossier, id: string | null) {
  const st = d.stagiaires.find((x) => x.id === id);
  return st ? `${st.prenom} ${st.nom}` : null;
}

/** Aperçu d'une pièce (générée ou validée) dans un cadre isolé ; réutilisé par les formulaires de l'apprenant. */
export function Apercu({
  piece,
  fermer,
}: {
  piece: Pick<Piece, "id" | "libelle">;
  fermer: () => void;
}) {
  return (
    <Modale ouverte fermer={fermer} titre={piece.libelle} large>
      {/* Cadre isolé : le document s'affiche sans script ni ressource externe (CSP posée par le serveur). */}
      <iframe
        title={piece.libelle}
        src={`/api/pieces/${piece.id}/apercu`}
        sandbox=""
        className="h-[70dvh] w-full rounded-md border border-trait bg-papier-3"
      />
    </Modale>
  );
}

function Signer({
  piece,
  dossierId,
  fermer,
}: {
  piece: Piece;
  dossierId: string;
  fermer: () => void;
}) {
  const rafraichir = useRafraichirDossier(dossierId);
  const notifier = useNotifier();
  const signer = useMutation({
    mutationFn: (d: { trace_png: string; lieu: string; consentement: boolean }) =>
      api.post(`/pieces/${piece.id}/signer`, d),
    onSuccess: async () => {
      await rafraichir();
      notifier("succes", `${piece.libelle} : signature enregistrée.`);
      fermer();
    },
  });
  return (
    <Modale ouverte fermer={fermer} titre={`Signer — ${piece.libelle}`} large>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <iframe
          title={piece.libelle}
          src={`/api/pieces/${piece.id}/apercu`}
          sandbox=""
          className="h-[46dvh] w-full rounded-md border border-trait bg-papier-3 lg:h-[64dvh]"
        />
        <div>
          <p className="mb-4 text-sm text-encre-2">
            Relisez le document, puis tracez votre signature à la souris ou au doigt.
          </p>
          <FormulaireSignature
            libelleDocument={piece.libelle}
            enCours={signer.isPending}
            erreur={signer.error?.message}
            signer={(d) => signer.mutate(d)}
          />
        </div>
      </div>
    </Modale>
  );
}

function ControleIntegrite({ piece, fermer }: { piece: Piece; fermer: () => void }) {
  const controle = useQuery({
    queryKey: ["integrite", piece.id],
    queryFn: () => api.get<Integrite>(`/pieces/${piece.id}/integrite`),
    staleTime: 0,
  });
  const p = controle.data?.preuve;
  return (
    <Modale ouverte fermer={fermer} titre={`Preuve — ${piece.libelle}`}>
      {controle.isPending ? (
        <p className="text-sm text-encre-3">Recalcul de l'empreinte…</p>
      ) : controle.data?.integre ? (
        <Alerte ton="succes" titre="Document intègre">
          L'empreinte du fichier archivé correspond à celle scellée lors du retour : il n'a pas été
          modifié depuis.
        </Alerte>
      ) : (
        <Alerte ton="danger" titre="Document altéré">
          L'empreinte du fichier archivé ne correspond plus à celle scellée lors du retour.
        </Alerte>
      )}
      {p && (
        <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {[
            ["Signataire", `${p.signataire_nom} (${p.signataire_role})`],
            ["Adresse e-mail", p.signataire_email],
            ["Fait à", p.lieu],
            ["Horodatage", instantFr(p.horodatage)],
            ["Adresse IP", p.adresse_ip || "non relevée"],
            ["Empreinte du document présenté", p.empreinte_document],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-encre-3">{k}</dt>
              <dd className="chiffres break-all">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modale>
  );
}

function LignePiece({ d, piece }: { d: Dossier; piece: Piece }) {
  const acteur = useActeur();
  const rafraichir = useRafraichirDossier(d.id);
  const notifier = useNotifier();
  const [modale, setModale] = useState<"apercu" | "signer" | "preuve" | null>(null);
  const stagiaire = nomStagiaire(d, piece.stagiaire_id);
  const interne = acteur.role !== "apprenant";

  const deposer = useMutation({
    mutationFn: (f: File) => api.fichier(`/pieces/${piece.id}/deposer`, f),
    onSuccess: async () => {
      await rafraichir();
      notifier("succes", `${piece.libelle} : document reçu, pièce validée.`);
    },
    onError: (e) => notifier("danger", e.message),
  });
  const regenerer = useMutation({
    mutationFn: () => api.post(`/pieces/${piece.id}/regenerer`),
    onSuccess: async () => {
      await rafraichir();
      notifier("succes", `${piece.libelle} : document régénéré avec les données à jour.`);
    },
    onError: (e) => notifier("danger", e.message),
  });

  const generee = piece.mode === "generee";
  return (
    <li className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="chiffres mt-0.5 w-9 shrink-0 text-right font-display text-sm font-semibold text-encre-3">
          {piece.ordre ?? "·"}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-encre">
            {piece.libelle}
            {stagiaire && interne && (
              <span className="font-normal text-encre-2"> — {stagiaire}</span>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <PastilleStatut statut={piece.statut} libelle={piece.libelle_statut} />
            {piece.retour_le && (
              <span className="text-xs text-encre-3">
                {piece.mode_retour === "signature"
                  ? "Signée en ligne"
                  : piece.mode_retour === "formulaire"
                    ? "Renseignée en ligne"
                    : "Document déposé"}{" "}
                le {instantFr(piece.retour_le)}
              </span>
            )}
            {!generee && !piece.a_un_retour && (
              <span className="text-xs text-encre-3">Document externe, à déposer</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-[50px] sm:justify-end sm:pl-0">
        {piece.peut_signer && (
          <Bouton
            variante="primaire"
            taille="sm"
            icone={<PenLine className="size-3.5" aria-hidden />}
            onClick={() => setModale("signer")}
          >
            Signer
          </Bouton>
        )}
        {piece.peut_deposer && (
          <DepotFichier
            compact
            libelle={generee ? "Déposer signé" : "Déposer"}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.odt"
            enCours={deposer.isPending}
            deposer={(f) => deposer.mutate(f)}
          />
        )}
        {generee && (
          <Bouton
            variante="discret"
            taille="sm"
            icone={<Eye className="size-3.5" aria-hidden />}
            onClick={() => setModale("apercu")}
          >
            Voir
          </Bouton>
        )}
        {generee && (
          <a
            href={`/api/pieces/${piece.id}/telecharger`}
            className="inline-flex h-8 items-center gap-2 rounded-sm px-3 text-[13px] font-medium whitespace-nowrap text-encre-2 hover:bg-papier-3 hover:text-encre"
          >
            <Download className="size-3.5" aria-hidden />
            Télécharger
          </a>
        )}
        {piece.a_un_retour && (
          <a
            href={`/api/pieces/${piece.id}/telecharger?version=retour`}
            className="inline-flex h-8 items-center gap-2 rounded-sm px-3 text-[13px] font-medium whitespace-nowrap text-accent hover:bg-accent-doux"
          >
            <FileCheck2 className="size-3.5" aria-hidden />
            Version retournée
          </a>
        )}
        {piece.a_un_retour && interne && (
          <Bouton
            variante="discret"
            taille="sm"
            aria-label="Vérifier l'intégrité"
            title="Vérifier l'intégrité du document retourné"
            onClick={() => setModale("preuve")}
            icone={<ShieldCheck className="size-3.5" aria-hidden />}
          />
        )}
        {generee && interne && piece.statut !== "valide" && !d.archive && (
          <Bouton
            variante="discret"
            taille="sm"
            aria-label="Régénérer"
            title="Régénérer le document avec les données à jour"
            enCours={regenerer.isPending}
            onClick={() => regenerer.mutate()}
            icone={<RefreshCw className="size-3.5" aria-hidden />}
          />
        )}
      </div>

      {modale === "apercu" && <Apercu piece={piece} fermer={() => setModale(null)} />}
      {modale === "signer" && (
        <Signer piece={piece} dossierId={d.id} fermer={() => setModale(null)} />
      )}
      {modale === "preuve" && <ControleIntegrite piece={piece} fermer={() => setModale(null)} />}
    </li>
  );
}

export function EspaceCommunication({ d, espace }: { d: Dossier; espace: "apprenant" | "of" }) {
  const pieces = d.pieces.filter((p) => p.espace === espace);
  if (pieces.length === 0) {
    return (
      <EtatVide
        icone={<ShieldX className="size-7" aria-hidden />}
        titre={
          espace === "of"
            ? "Rien à échanger avec l'organisme pour l'instant"
            : "Aucune pièce pour l'instant"
        }
      >
        {espace === "of"
          ? "L'ordre de mission vous sera envoyé automatiquement dès que l'accord de financement sera déposé sur le dossier."
          : "Les pièces apparaîtront ici dès que l'organisme aura validé le dossier."}
      </EtatVide>
    );
  }
  return (
    <Carte>
      <ul className="divide-y divide-trait">
        {pieces.map((p) => (
          <LignePiece key={p.id} d={d} piece={p} />
        ))}
      </ul>
    </Carte>
  );
}

/** Pièces d'une section du parcours de l'apprenant, dans l'ordre donné par le serveur. */
export function ListePieces({ d, codes }: { d: Dossier; codes: readonly string[] }) {
  const pieces = codes.flatMap((code) => d.pieces.filter((p) => p.code === code));
  if (pieces.length === 0) return null;
  return (
    <Carte>
      <ul className="divide-y divide-trait">
        {pieces.map((p) => (
          <LignePiece key={p.id} d={d} piece={p} />
        ))}
      </ul>
    </Carte>
  );
}

/** Pièces hors des deux espaces : recueil, positionnement, enquêtes de satisfaction, justificatif de refus. */
export function AutresPieces({ d }: { d: Dossier }) {
  const pieces = d.pieces.filter((p) => p.espace === null);
  if (pieces.length === 0) return null;
  return (
    <Carte>
      <ul className="divide-y divide-trait">
        {pieces.map((p) => (
          <LignePiece key={p.id} d={d} piece={p} />
        ))}
      </ul>
    </Carte>
  );
}
