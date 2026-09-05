import React, { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "../ui/button";

const DOC_META = {
  idFront: { title: "Recto de la pièce d'identité",    hint: "CNI, passeport ou permis — côté recto" },
  idBack:  { title: "Verso de la pièce d'identité",    hint: "CNI ou permis — côté verso" },
  selfie:  { title: "Selfie avec pièce d'identité",    hint: "Tenez votre pièce bien visible à côté de votre visage" },
  address: { title: "Justificatif de domicile",         hint: "Facture ou relevé bancaire — moins de 3 mois" },
};

// step states: idle → selected → uploading → done
export function KycDocCard({ doc, onUpload, onConfirmed, locked }) {
  const inputRef = useRef(null);
  const [state, setState] = useState(() => {
    const done = doc?.has_file || (doc?.status && doc.status !== "missing" && doc.status !== "rejected");
    return done ? "done" : "idle";
  });
  const [localFile, setLocalFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const done = doc?.has_file || (doc?.status && doc.status !== "missing" && doc.status !== "rejected");
    setState(done ? "done" : "idle");
    setLocalFile(null);
    setPreviewUrl(null);
  }, [doc?.key]); // eslint-disable-line

  const meta = DOC_META[doc?.key] || { title: doc?.key || "", hint: "" };

  const selectFile = (file) => {
    if (!file || locked) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(file);
    setLocalFile(file);
    setPreviewUrl(url);
    setState("selected");
  };

  const handleConfirm = async () => {
    if (!localFile) return;
    setState("uploading");
    try {
      await onUpload(doc.key, localFile);
      setState("done");
      onConfirmed?.();
    } catch {
      setState("selected");
    }
  };

  const handleRetake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setLocalFile(null);
    setPreviewUrl(null);
    setState("idle");
  };

  const isImage = localFile?.type?.startsWith("image/");

  return (
    <div className="rounded-xl bg-surface border border-border overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm">{meta.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{meta.hint}</p>
          </div>
          {state === "done" && (
            <span className="kyc-pulse-check shrink-0 h-7 w-7 rounded-full bg-success/10 text-success flex items-center justify-center">
              <CheckCircle2 size={16} />
            </span>
          )}
        </div>
        {doc?.status === "rejected" && doc?.reason && (
          <p className="mt-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            Rejeté : {doc.reason}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="px-5 pb-5">
        {/* IDLE — drop zone */}
        {state === "idle" && (
          <button
            type="button"
            onClick={() => !locked && inputRef.current?.click()}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); selectFile(e.dataTransfer?.files?.[0]); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            disabled={locked}
            className={`w-full rounded-xl border-2 border-dashed transition-base flex flex-col items-center justify-center gap-3 py-12 ${
              locked ? "border-border opacity-50 cursor-not-allowed"
              : isDragOver ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
            }`}
          >
            <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Camera size={26} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Cliquez ou glissez un fichier</p>
              <p className="text-xs text-muted-foreground mt-0.5">JPG · PNG · PDF · max 8 Mo</p>
            </div>
          </button>
        )}

        {/* SELECTED — local preview + confirm */}
        {state === "selected" && (
          <div className="space-y-4 fade-in">
            <div className="rounded-xl overflow-hidden border border-border bg-secondary flex items-center justify-center min-h-[180px]">
              {isImage ? (
                <img src={previewUrl} alt="preview" className="max-h-72 w-full object-contain" />
              ) : (
                <div className="py-10 flex flex-col items-center gap-3 text-muted-foreground">
                  <Upload size={36} />
                  <p className="text-sm break-all px-4 text-center">{localFile?.name}</p>
                </div>
              )}
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Vérifiez que le document est <strong>lisible et non coupé</strong> avant de confirmer.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleRetake} className="flex-1 rounded-md border-border">
                <RefreshCw size={13} className="mr-1.5" /> Reprendre
              </Button>
              <Button type="button" onClick={handleConfirm} className="flex-1 bg-primary hover:bg-primary/90 rounded-md text-primary-foreground">
                <CheckCircle2 size={13} className="mr-1.5" /> Confirmer l'envoi
              </Button>
            </div>
          </div>
        )}

        {/* UPLOADING */}
        {state === "uploading" && (
          <div className="py-12 flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Envoi en cours…</p>
          </div>
        )}

        {/* DONE */}
        {state === "done" && (
          <div className="space-y-3 fade-in">
            <div className={`rounded-xl overflow-hidden border bg-success/5 flex items-center justify-center min-h-[120px] ${previewUrl ? "border-success/30" : "border-border"}`}>
              {previewUrl && isImage ? (
                <img src={previewUrl} alt="preview" className="max-h-56 w-full object-contain" />
              ) : (
                <div className="py-8 flex flex-col items-center gap-2 text-success">
                  <CheckCircle2 size={32} />
                  <p className="text-sm font-medium">Document envoyé</p>
                  {(localFile?.name || doc?.file_name) && (
                    <p className="text-xs text-muted-foreground">{localFile?.name || doc?.file_name}</p>
                  )}
                </div>
              )}
            </div>
            {!locked && (
              <Button type="button" variant="outline" size="sm" onClick={handleRetake} className="w-full rounded-md border-border text-xs">
                <RefreshCw size={11} className="mr-1.5" /> Remplacer ce document
              </Button>
            )}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        disabled={locked}
        onChange={(e) => selectFile(e.target.files?.[0])}
      />
    </div>
  );
}
