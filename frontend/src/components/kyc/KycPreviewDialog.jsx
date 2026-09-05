import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export function KycPreviewDialog({ open, onOpenChange, title, previewUrl, fileName }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>
            Prévisualisation du document KYC sélectionné avant validation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {fileName && <p className="text-xs text-muted-foreground break-all">{fileName}</p>}
          {previewUrl ? (
            // Images will render; PDFs can be opened via the browser viewer.
            previewUrl.startsWith("blob:") || previewUrl.startsWith("data:") ? (
              <img src={previewUrl} alt={title} className="w-full max-h-[70vh] object-contain rounded-md border border-border" />
            ) : (
              <a className="text-primary underline" href={previewUrl} target="_blank" rel="noreferrer">
                Ouvrir le fichier
              </a>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Aucun fichier à prévisualiser.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
