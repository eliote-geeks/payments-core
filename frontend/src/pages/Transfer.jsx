import React, { useEffect, useMemo, useRef, useState } from "react"; // useRef kept for QrScanButton
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2, CheckCircle, ArrowRight, ArrowLeftRight, Globe, RefreshCw, Loader2,
  QrCode, Star, Trash2, Plus, ScanLine, User, AlertTriangle, X,
  Landmark, CreditCard, Smartphone, Copy, Coins, Clock, Send, ShieldCheck, CircleDot, Lock,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { PinInput } from "../components/common/PinInput";
import { PhoneInput } from "../components/common/PhoneInput";
import { formatAmount } from "../lib/format";
import { useCurrencyInput } from "../hooks/useCurrencyInput";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { lookupUser, p2pTransfer, getP2pFeePreview } from "../api/p2p";
import { cancelTransfer, createQuote, createTransfer, getCorridors, getCryptoWallets, getPaymentInstructions, getMyPendingTransfer, getTransfer } from "../api/transfers";
import { quoteMobileMoneyTransfer, initMobileMoneyTransfer } from "../api/mobileMoneyTransfers";
import { addContact, getContacts, removeContact } from "../api/user";
import { api } from "../api/client";
import QRCodeLib from "qrcode";
import jsQR from "jsqr";

function apiErrorMessage(err, fallback) {
  const friendly = (message) => {
    if (!message) return fallback;
    const text = String(message);
    const map = {
      account_blocked: "Votre compte est temporairement bloqué. Vous ne pouvez pas effectuer cette action pour le moment. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
      sender_blocked: "Votre compte est temporairement bloqué. Vous ne pouvez pas envoyer d'argent pour le moment. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
      recipient_blocked: "Ce destinataire ne peut pas recevoir d'argent pour le moment. Essayez un autre compte ou demandez-lui de contacter le support.",
      "Compte expéditeur bloqué": "Votre compte est temporairement bloqué. Vous ne pouvez pas envoyer d'argent pour le moment. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
      "Compte destinataire bloqué": "Ce destinataire ne peut pas recevoir d'argent pour le moment. Essayez un autre compte ou demandez-lui de contacter le support.",
    };
    if (map[text]) return map[text];
    if (/exp[ée]diteur.*bloqu/i.test(text)) return map.sender_blocked;
    if (/destinataire.*bloqu/i.test(text)) return map.recipient_blocked;
    if (/transaction.*bloqu/i.test(text)) {
      return "Nous n'avons pas pu envoyer ce transfert pour des raisons de sécurité. Aucun montant n'a été débité.";
    }
    return text;
  };
  const detail = err?.response?.data?.detail;
  if (Array.isArray(detail)) {
    const message = detail
      .map((item) => item?.msg || item?.message || JSON.stringify(item))
      .filter(Boolean)
      .join(" | ");
    return friendly(message);
  }
  if (detail && typeof detail === "object") {
    return friendly(detail.msg || detail.message || JSON.stringify(detail));
  }
  return friendly(detail || fallback);
}

// ─── QR Display Dialog ───────────────────────────────────────────────────────

function QrDisplayDialog({ open, onClose, phone }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);

  useEffect(() => {
    if (!open || !phone) { setQrDataUrl(null); return; }
    QRCodeLib.toDataURL(phone, {
      width: 224,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setQrDataUrl).catch(() => {});
  }, [open, phone]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xs rounded-xl text-center">
        <DialogHeader>
          <DialogTitle className="font-display">Mon QR de paiement</DialogTitle>
          <DialogDescription>Faites scanner ce code pour recevoir un paiement.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl border border-border p-3 bg-white inline-flex">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR paiement" className="w-48 h-48 block" />
            ) : (
              <div className="w-48 h-48 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            )}
          </div>
          <p className="text-sm font-medium tabular-nums text-muted-foreground">{phone}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── QR Scanner ─────────────────────────────────────────────────────────────

function QrScanButton({ onScanned }) {
  const inputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      URL.revokeObjectURL(url);
      if (code?.data) {
        onScanned(code.data);
      } else {
        toast.error("QR code non reconnu");
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast.error("Impossible de lire l'image"); };
    img.src = url;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-base px-2 py-1 rounded-md hover:bg-secondary"
        title="Scanner un QR code"
      >
        <ScanLine size={14} /> Scanner QR
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </>
  );
}

// ─── Contacts Picker Dialog ──────────────────────────────────────────────────

function ContactsDialog({ open, onClose, onSelect }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getContacts()
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [open]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;
    setAdding(true);
    try {
      const c = await addContact(newName.trim(), newPhone.trim());
      setContacts((prev) => [...prev, c]);
      setNewName("");
      setNewPhone("");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Impossible d'ajouter"));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await removeContact(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch {
      toast.error("Impossible de supprimer");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Contacts favoris</DialogTitle>
          <DialogDescription>Sélectionnez ou ajoutez un destinataire fréquent.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {contacts.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Aucun contact enregistré</p>
            )}
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-md hover:bg-secondary transition-base">
                <button
                  type="button"
                  className="flex-1 text-left min-w-0"
                  onClick={() => { onSelect(c.phone); onClose(); }}
                >
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{c.phone}</p>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="text-muted-foreground hover:text-destructive transition-base p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAdd} className="border-t border-border pt-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ajouter un contact</p>
          <Input
            placeholder="Nom complet"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-md text-sm"
          />
          <PhoneInput
            value={newPhone}
            onChange={setNewPhone}
            placeholder="6 XX XX XX XX"
            testId="contact-phone"
          />
          <Button
            type="submit"
            disabled={adding || !newName.trim() || !newPhone.trim()}
            size="sm"
            className="w-full bg-primary hover:bg-primary/90 rounded-md text-primary-foreground"
          >
            {adding ? <Loader2 size={13} className="animate-spin mr-1" /> : <Plus size={13} className="mr-1" />}
            Ajouter
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── P2P (internal FCFA) ─────────────────────────────────────────────────────

function P2PTab({ t }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recipient, setRecipient] = useState("");
  const [recipientInfo, setRecipientInfo] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const amountInput = useCurrencyInput("");
  const amount = amountInput.raw;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  const num = Number(amount) || 0;
  const [feePreview, setFeePreview] = useState({ fee_fcfa: 0, total_fcfa: 0 });
  useEffect(() => {
    if (num < 100) { setFeePreview({ fee_fcfa: 0, total_fcfa: num }); return; }
    const t = setTimeout(() => {
      getP2pFeePreview(num).then(setFeePreview).catch(() => {
        setFeePreview({ fee_fcfa: Math.max(num * 0.015, 100), total_fcfa: num + Math.max(num * 0.015, 100) });
      });
    }, 300);
    return () => clearTimeout(t);
  }, [num]);
  const fee = feePreview.fee_fcfa;
  const total = feePreview.total_fcfa || num + fee;

  const handleRecipientBlur = async () => {
    if (!recipient || recipient.length < 3) { setRecipientInfo(null); return; }
    setLookingUp(true);
    try {
      const res = await lookupUser(recipient);
      setRecipientInfo(res);
    } catch {
      setRecipientInfo({ found: false });
    } finally {
      setLookingUp(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!recipient || num <= 0) { toast.error("Destinataire et montant requis"); return; }
    if (num < 100) { toast.error("Montant minimum : 100 FCFA"); return; }
    if (recipientInfo?.found === false) { toast.error("Ce destinataire n'est pas inscrit sur Kobo"); return; }
    setConfirmOpen(true);
  };

  const onPinComplete = (code) => {
    setPinOpen(false);
    const idem = `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    p2pTransfer({ to_identifier: recipient, amount: num, note: "", pin: code }, idem)
      .then((res) => {
        setRef(res?.transfer?.id || `KB-${Date.now().toString(36).toUpperCase().slice(-8)}`);
        if (res?.fraud_warning?.length) {
          toast.warning("Transaction effectuée — activité inhabituelle détectée sur votre compte.", { duration: 6000 });
        }
        setSuccessOpen(true);
      })
      .catch((err) => toast.error(apiErrorMessage(err, t("common.retry"))));
  };

  const recipientSuffix = lookingUp
    ? <Loader2 size={14} className="animate-spin text-muted-foreground" />
    : recipientInfo?.found === true
    ? <CheckCircle2 size={14} className="text-success" />
    : recipientInfo?.found === false
    ? <X size={14} className="text-destructive" />
    : null;

  return (
    <>
      <form onSubmit={onSubmit} className="rounded-xl bg-surface border border-border p-5 sm:p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label>{t("transfer.recipient")}</Label>
            <div className="flex items-center gap-1">
              <QrScanButton onScanned={(val) => { setRecipient(val); setRecipientInfo(null); }} />
              <button
                type="button"
                onClick={() => setContactsOpen(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-base px-2 py-1 rounded-md hover:bg-secondary"
              >
                <Star size={13} /> Contacts
              </button>
            </div>
          </div>
          <div className="relative mt-1.5">
            <Input
              data-testid="transfer-recipient"
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setRecipientInfo(null); }}
              onBlur={handleRecipientBlur}
              placeholder="Email, @pseudo ou +237 6XX XXX XXX"
              className="rounded-md pr-8"
            />
            {recipientSuffix && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center">
                {recipientSuffix}
              </span>
            )}
          </div>
          {recipientInfo?.found === true && recipientInfo.user?.fullName && (
            <p className="text-xs text-success mt-1.5 ml-1">{recipientInfo.user.fullName}</p>
          )}
          {recipientInfo?.found === false && (
            <p className="text-xs text-destructive mt-1.5 ml-1">Destinataire non inscrit sur Kobo</p>
          )}
        </div>

        <div>
          <Label>{t("transfer.amount")} (FCFA)</Label>
          <Input
            type="text"
            inputMode="numeric"
            data-testid="transfer-amount"
            value={amountInput.display}
            onChange={amountInput.onChange}
            placeholder="0"
            className="rounded-md mt-1.5 tabular-nums text-lg font-semibold"
          />
        </div>

        {num > 0 && (
          <div className="rounded-md bg-secondary p-3 text-sm space-y-1.5">
            <div className="flex justify-between text-muted-foreground">
              <span>{t("transfer.fee")}</span>
              <span className="tabular-nums">{formatAmount(fee, "FCFA")}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>{t("transfer.total")}</span>
              <span className="tabular-nums">{formatAmount(total, "FCFA")}</span>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setQrOpen(true)}
            className="rounded-md border-border gap-1.5"
          >
            <QrCode size={15} /> Mon QR
          </Button>
          <Button type="submit" data-testid="transfer-submit" className="flex-1 bg-primary hover:bg-primary/90 rounded-md h-11 text-primary-foreground">
            {t("common.continue")} <ArrowRight size={16} className="ml-1" />
          </Button>
        </div>
      </form>

      <QrDisplayDialog open={qrOpen} onClose={() => setQrOpen(false)} phone={user?.phone || ""} />
      <ContactsDialog
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        onSelect={(phone) => setRecipient(phone)}
      />

      {/* Step 1: Review confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display">Confirmer le transfert</DialogTitle>
            <DialogDescription>Vérifiez les détails avant de valider.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-secondary/60 p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Destinataire</span>
                <span className="font-semibold">{recipient}</span>
              </div>
              {recipientInfo?.user?.fullName && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Nom</span>
                  <span className="font-medium text-success">{recipientInfo.user.fullName}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Montant envoyé</span>
                <span className="font-semibold">{formatAmount(num, "FCFA")}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Frais</span>
                <span className="tabular-nums">{formatAmount(fee, "FCFA")}</span>
              </div>
              <div className="border-t border-border pt-3 flex justify-between text-sm font-bold">
                <span>Total débité</span>
                <span className="text-primary tabular-nums">{formatAmount(total, "FCFA")}</span>
              </div>
            </div>
            <p className="text-xs text-center text-muted-foreground">Cette opération est irréversible. Assurez-vous que les informations sont correctes.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} className="flex-1 rounded-lg">Annuler</Button>
              <Button onClick={() => { setConfirmOpen(false); setPinOpen(true); }} className="flex-1 rounded-lg">
                Confirmer <ArrowRight size={14} className="ml-1.5" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Step 2: PIN */}
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display">{t("transfer.confirmPin")}</DialogTitle>
            <DialogDescription>{formatAmount(total, "FCFA")} → {recipient}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <PinInput length={6} onComplete={onPinComplete} testId="confirm-pin" />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-success/10 text-success flex items-center justify-center">
            <CheckCircle2 size={32} />
          </div>
          <DialogTitle className="font-display text-xl">{t("transfer.success")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("transfer.successSub")}</p>
          <div className="rounded-md bg-secondary p-3 text-sm text-left space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("transfer.recipient")}</span>
              <span className="font-medium">{recipient}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("transfer.total")}</span>
              <span className="font-medium tabular-nums">{formatAmount(total, "FCFA")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("transfer.ref")}</span>
              <code className="font-mono text-xs">{ref}</code>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/dashboard")} className="flex-1 rounded-md">{t("nav.home")}</Button>
            <Button onClick={() => { setSuccessOpen(false); amountInput.reset(); setRecipient(""); }} className="flex-1 bg-primary hover:bg-primary/90 rounded-md text-primary-foreground">
              {t("transfer.sendAgain")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Mobile Money direct (Kobo → MTN/Orange) ────────────────────────────────

export function MobileMoneyTab({ standalone = false }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const amountInput = useCurrencyInput("");
  const amount = amountInput.raw;
  const num = Number(amount) || 0;
  const [payerName, setPayerName] = useState(user?.fullName || user?.profile?.fullName || "");
  const [sourcePhone, setSourcePhone] = useState(user?.phone || user?.phone_e164 || "");
  const [sourceProvider, setSourceProvider] = useState("mtn");
  const [recipientName, setRecipientName] = useState("");
  const [destPhone, setDestPhone] = useState("");
  const [destProvider, setDestProvider] = useState("orange");
  const [feePreview, setFeePreview] = useState({ fee_fcfa: 0, payin_total_fcfa: 0, beneficiary_receives_fcfa: 0, min_amount_fcfa: 100 });
  const [serviceStatus, setServiceStatus] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    api.get("/service-status").then((r) => setServiceStatus(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      quoteMobileMoneyTransfer({ amount: num || 0 })
        .then(setFeePreview)
        .catch(() => setFeePreview({ fee_fcfa: 0, payin_total_fcfa: num, beneficiary_receives_fcfa: num, min_amount_fcfa: 100 }));
    }, 250);
    return () => clearTimeout(timer);
  }, [num]);

  const minAmount = Number(feePreview?.min_amount_fcfa || 100);
  const fee = num > 0 ? Number(feePreview?.fee_fcfa || 0) : 0;
  const total = num > 0 ? Number(feePreview?.payin_total_fcfa || num + fee) : 0;
  const kycLevel = user?.kycLevel ?? 0;
  const blocked = serviceStatus && !serviceStatus.withdrawals_enabled;

  const providerMeta = {
    mtn: {
      label: "MTN Mobile Money",
      short: "MTN",
      logo: "/brands/mtn-momo.svg",
      className: "border-yellow-400 bg-yellow-50 text-yellow-900 dark:bg-yellow-400/10 dark:text-yellow-100",
    },
    orange: {
      label: "Orange Money",
      short: "Orange",
      logo: "/brands/orange-money.svg",
      className: "border-orange-400 bg-orange-50 text-orange-900 dark:bg-orange-500/10 dark:text-orange-100",
    },
  };

  const ProviderSelector = ({ label, value, onChange }) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(providerMeta).map(([id, meta]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`min-h-[92px] rounded-lg border transition-base flex flex-col items-center justify-center gap-2 px-3 ${value === id ? `${meta.className} ring-1 ring-current/20` : "border-border bg-secondary text-muted-foreground hover:text-foreground"}`}
          >
            <span className="h-12 w-full max-w-[150px] rounded-md bg-white border border-black/5 flex items-center justify-center overflow-hidden px-2 shadow-sm">
              <img src={meta.logo} alt={meta.label} className="max-h-10 w-full object-contain" />
            </span>
            <span className="text-sm font-semibold">{meta.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const steps = [
    { id: 1, label: "Départ", title: "Choisissez le compte qui paie" },
    { id: 2, label: "Arrivée", title: "Choisissez le compte qui reçoit" },
    { id: 3, label: "Montant", title: "Montant et validation" },
  ];

  const StepHeader = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {steps.map((s, index) => (
          <React.Fragment key={s.id}>
            <button
              type="button"
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-2 shrink-0 ${step === s.id ? "text-primary" : step > s.id ? "text-success" : "text-muted-foreground"}`}
            >
              <span className={`h-8 w-8 rounded-full border flex items-center justify-center text-sm font-bold ${
                step === s.id ? "border-primary bg-primary text-primary-foreground" : step > s.id ? "border-success bg-success/10" : "border-border bg-secondary"
              }`}>
                {step > s.id ? <CheckCircle2 size={15} /> : s.id}
              </span>
              <span className="hidden sm:inline text-sm font-semibold">{s.label}</span>
            </button>
            {index < steps.length - 1 && <div className={`h-px flex-1 ${step > s.id ? "bg-success/50" : "bg-border"}`} />}
          </React.Fragment>
        ))}
      </div>
      <div>
        <h2 className="text-xl font-bold tracking-tight">{steps.find((s) => s.id === step)?.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {step === 1 && "Le téléphone source reçoit la demande de paiement Mobile Money."}
          {step === 2 && "Le bénéficiaire reçoit directement sur son compte Mobile Money."}
          {step === 3 && "Kobo ne facture pas de frais sur ce transfert direct Orange ↔ MTN."}
        </p>
      </div>
    </div>
  );

  const goNext = () => {
    if (step === 1) {
      if (!payerName.trim()) return toast.error("Nom du payeur requis");
      if (!sourcePhone.trim()) return toast.error("Numéro source requis");
    }
    if (step === 2) {
      if (!recipientName.trim()) return toast.error("Nom du bénéficiaire requis");
      if (!destPhone.trim()) return toast.error("Numéro bénéficiaire requis");
    }
    setStep((s) => Math.min(3, s + 1));
  };

  const submit = (e) => {
    e.preventDefault();
    if (blocked) {
      toast.error(serviceStatus.withdrawals_message || "Les transferts Mobile Money sont temporairement indisponibles.");
      return;
    }
    if (kycLevel < 1) {
      toast.error("KYC niveau 1 requis avant d'envoyer vers Mobile Money.");
      navigate("/kyc");
      return;
    }
    if (!user?.hasPin) {
      toast.error("Définissez d'abord votre code PIN dans Profil.");
      navigate("/profile");
      return;
    }
    if (!num || num < minAmount) {
      toast.error(`Montant minimum : ${minAmount.toLocaleString("fr-FR")} FCFA`);
      return;
    }
    if (!payerName.trim()) {
      toast.error("Nom du payeur requis");
      return;
    }
    if (!sourcePhone.trim()) {
      toast.error("Numéro source requis");
      return;
    }
    if (!recipientName.trim()) {
      toast.error("Nom du bénéficiaire requis");
      return;
    }
    if (!destPhone.trim()) {
      toast.error("Numéro bénéficiaire requis");
      return;
    }
    setConfirmOpen(true);
  };

  const onPinComplete = async (pin) => {
    setPinOpen(false);
    setLoading(true);
    try {
      const res = await initMobileMoneyTransfer({
        amount: num,
        source_provider: sourceProvider,
        source_phone: sourcePhone.trim(),
        payer_name: payerName.trim(),
        dest_provider: destProvider,
        dest_phone: destPhone.trim(),
        dest_name: recipientName.trim(),
        pin,
      });
      setResult(res);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Impossible d'envoyer ce transfert Mobile Money."));
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-xl bg-surface border border-border p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold">Paiement Mobile Money lancé</h2>
            <p className="text-sm text-muted-foreground mt-1">{result.message}</p>
          </div>
        </div>
        <div className="rounded-lg bg-secondary/60 border border-border divide-y divide-border text-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <span className="text-muted-foreground">Référence</span>
            <span className="font-mono text-xs text-right">{result.reference}</span>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <span className="text-muted-foreground">Statut</span>
            <span className="font-semibold">{result.status === "pending_approval" ? "Validation admin" : "En traitement"}</span>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <span className="text-muted-foreground">Total à valider sur le téléphone source</span>
            <span className="font-bold">{Number(result.payin_total_fcfa || total).toLocaleString("fr-FR")} FCFA</span>
          </div>
        </div>
        <Button className="w-full" onClick={() => navigate("/history")}>Voir l'historique</Button>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={submit} className="rounded-xl bg-surface border border-border p-5 sm:p-6 space-y-5">
        {standalone && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-center gap-3">
              <img src="/brands/orange-money.svg" alt="Orange Money" className="h-12 w-28 object-contain rounded-md bg-white border border-border p-1" />
              <ArrowLeftRight size={20} className="text-primary shrink-0" />
              <img src="/brands/mtn-momo.svg" alt="MTN Mobile Money" className="h-12 w-28 object-contain rounded-md bg-white border border-border p-1" />
            </div>
            <div className="text-center">
              <p className="text-lg font-extrabold tracking-tight">Orange Money ↔ MTN Mobile Money</p>
              <p className="text-sm text-muted-foreground mt-1">
                Transférez entre opérateurs sans passer par votre solde Kobo et sans frais Kobo.
              </p>
            </div>
          </div>
        )}
        <StepHeader />

        {blocked && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-400/30 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{serviceStatus.withdrawals_message || "Les transferts Mobile Money sont temporairement indisponibles."}</span>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="rounded-lg bg-primary/5 border border-primary/15 p-3 text-sm text-muted-foreground">
              Exemple : vous avez Orange Money et le bénéficiaire a MTN. Choisissez ici votre opérateur et le numéro qui va payer.
            </div>
            <ProviderSelector label="Je paie avec" value={sourceProvider} onChange={setSourceProvider} />
            <div className="space-y-2">
              <Label>Nom du titulaire</Label>
              <Input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="Ex: Paul Eliote"
                className="rounded-md"
              />
            </div>
            <div className="space-y-2">
              <Label>Numéro qui paie</Label>
              <PhoneInput value={sourcePhone} onChange={setSourcePhone} placeholder="6 XX XX XX XX" testId="mobile-money-source-phone" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="rounded-lg bg-secondary/60 border border-border p-3 text-sm">
              <span className="text-muted-foreground">Paiement depuis </span>
              <strong>{providerMeta[sourceProvider].short}</strong>
              <span className="text-muted-foreground"> · {sourcePhone || "numéro source"}</span>
            </div>
            <ProviderSelector label="Opérateur qui reçoit" value={destProvider} onChange={setDestProvider} />
            <div className="space-y-2">
              <Label>Nom du bénéficiaire</Label>
              <Input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Nom complet du titulaire Mobile Money"
                className="rounded-md"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Numéro bénéficiaire</Label>
                <QrScanButton onScanned={(val) => setDestPhone(val)} />
              </div>
              <PhoneInput value={destPhone} onChange={setDestPhone} placeholder="6 XX XX XX XX" testId="mobile-money-dest-phone" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Départ</p>
                <p className="font-semibold">{providerMeta[sourceProvider].label}</p>
                <p className="font-mono text-xs text-muted-foreground">{sourcePhone}</p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Arrivée</p>
                <p className="font-semibold">{recipientName || "Bénéficiaire"}</p>
                <p className="font-mono text-xs text-muted-foreground">{providerMeta[destProvider].short} · {destPhone}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Montant que le bénéficiaire reçoit</Label>
              <div className="relative">
                <Input
                  inputMode="numeric"
                  value={amountInput.display}
                  onChange={amountInput.onChange}
                  placeholder="Ex: 25 000"
                  className="rounded-md pr-16 h-12 text-base"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">FCFA</span>
              </div>
              <p className="text-xs text-muted-foreground">Minimum {minAmount.toLocaleString("fr-FR")} FCFA</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 divide-y divide-border text-sm">
              <div className="flex justify-between gap-4 px-4 py-3">
                <span className="text-muted-foreground">Bénéficiaire reçoit</span>
                <span className="font-bold">{num.toLocaleString("fr-FR")} FCFA</span>
              </div>
              <div className="flex justify-between gap-4 px-4 py-3">
                <span className="text-muted-foreground">Frais Kobo</span>
                <span className="font-semibold text-success">{fee > 0 ? `${fee.toLocaleString("fr-FR")} FCFA` : "0 FCFA"}</span>
              </div>
              <div className="flex justify-between gap-4 px-4 py-3 font-bold">
                <span>Total à valider sur le téléphone source</span>
                <span>{total.toLocaleString("fr-FR")} FCFA</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {step > 1 && (
            <Button type="button" variant="outline" className="flex-1 rounded-md" onClick={() => setStep((s) => Math.max(1, s - 1))}>
              Retour
            </Button>
          )}
          {step < 3 ? (
            <Button type="button" className="flex-1 rounded-md" onClick={goNext} disabled={blocked}>
              Continuer <ArrowRight size={16} className="ml-2" />
            </Button>
          ) : (
            <Button type="submit" className="flex-1 rounded-md" disabled={loading || blocked}>
              {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Send size={16} className="mr-2" />}
              Valider le transfert
            </Button>
          )}
        </div>
      </form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Confirmer le transfert Mobile Money</DialogTitle>
            <DialogDescription>Vérifiez la source, le bénéficiaire et le total à valider.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-secondary/60 border border-border divide-y divide-border text-sm">
              <div className="flex justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Source</span><span className="font-semibold">{providerMeta[sourceProvider].label}</span></div>
              <div className="flex justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Numéro source</span><span className="font-mono text-xs">{sourcePhone}</span></div>
              <div className="flex justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Destination</span><span className="font-semibold">{providerMeta[destProvider].label}</span></div>
              <div className="flex justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Bénéficiaire</span><span className="font-semibold text-right">{recipientName}</span></div>
              <div className="flex justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Numéro bénéficiaire</span><span className="font-mono text-xs">{destPhone}</span></div>
              <div className="flex justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Montant envoyé</span><span className="font-semibold">{num.toLocaleString("fr-FR")} FCFA</span></div>
              <div className="flex justify-between gap-4 px-4 py-3"><span className="text-muted-foreground">Frais</span><span className="font-semibold">{fee.toLocaleString("fr-FR")} FCFA</span></div>
              <div className="flex justify-between gap-4 px-4 py-3 font-bold"><span>Total à payer</span><span>{total.toLocaleString("fr-FR")} FCFA</span></div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>Annuler</Button>
              <Button type="button" className="flex-1" onClick={() => { setConfirmOpen(false); setPinOpen(true); }}>Continuer</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Code PIN Kobo</DialogTitle>
            <DialogDescription>Le PIN confirme l'ordre. Vous validerez ensuite {total.toLocaleString("fr-FR")} FCFA sur le téléphone source.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <PinInput length={6} onComplete={onPinComplete} testId="mobile-money-pin" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── International cross-border ──────────────────────────────────────────────

const COUNTRY_LABELS = { CM: "Cameroun", FR: "France", US: "États-Unis", CA: "Canada", GB: "Royaume-Uni" };
const CURRENCY_LABELS = { XAF: "FCFA", FCFA: "FCFA", EUR: "EUR", USD: "USD", GBP: "GBP", CAD: "CAD", USDT: "USDT" };
const CURRENCY_FLAGS  = { EUR: "🇪🇺", USD: "🇺🇸", GBP: "🇬🇧", CAD: "🇨🇦", XAF: "🇨🇲", USDT: "₮" };

const KOBO_USDT_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const KOBO_USDT_NETWORK = "TRC-20 (TRON)";

const FUNDING_METHODS = [
  { id: "bank_wire", label: "Virement bancaire", desc: "SEPA, SWIFT depuis votre banque", icon: Landmark,  available: true  },
  { id: "usdt",      label: "USDT TRC20",        desc: "Détection blockchain automatique", icon: Coins,     available: true  },
  { id: "card",      label: "Carte bancaire",    desc: "Visa, Mastercard — bientôt",      icon: CreditCard,available: false },
];

// Wizard steps for the intl transfer form
const INTL_WIZARD_STEPS = [
  { id: "destination", label: "Destination" },
  { id: "funding",     label: "Paiement" },
  { id: "amount",      label: "Montant" },
];

function WizardShell({ currentStep, title, subtitle, children, onBack, onNext, nextLabel = "Continuer", nextDisabled = false, nextLoading = false }) {
  return (
    <div className="rounded-xl bg-surface border border-border overflow-hidden" data-testid="intl-form">
      <div className="px-5 pt-5 pb-4 border-b border-border">
        <IntlStepBar current={currentStep} />
      </div>
      <div className="p-5 space-y-5">
        <div>
          <h3 className="font-bold text-lg text-foreground">{title}</h3>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {children}
        <div className="flex gap-2 pt-1">
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack} className="flex-1 h-10 rounded-md">
              Retour
            </Button>
          )}
          <Button type="button" onClick={onNext} disabled={nextDisabled || nextLoading}
            className="flex-1 h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md font-semibold">
            {nextLoading ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
            {nextLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function IntlStepBar({ current }) {
  const idx = INTL_WIZARD_STEPS.findIndex((s) => s.id === current);
  if (idx < 0) return null;
  return (
    <div className="flex items-center gap-0">
      {INTL_WIZARD_STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center gap-1">
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${done ? "bg-primary border-primary text-primary-foreground"
                  : active ? "bg-primary/10 border-primary text-primary"
                  : "bg-transparent border-border text-muted-foreground"}`}>
                {done ? <CheckCircle2 size={14} /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium ${active ? "text-primary" : done ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                {s.label}
              </span>
            </div>
            {i < INTL_WIZARD_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mb-4 rounded-full transition-all ${done ? "bg-primary" : "bg-border"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function IntlTab({ t }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [corridors, setCorridors] = useState([]);
  // step: "destination" | "funding" | "amount" | "quote" | "success"
  const [step, setStep] = useState("destination");
  const [loading, setLoading] = useState(false);

  const [sourceCurrency, setSourceCurrency] = useState("EUR");
  const [destCountry, setDestCountry] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("mobile_money");
  const [fundingMethod, setFundingMethod] = useState("bank_wire");
  const amountInput = useCurrencyInput("");
  const amount = amountInput.raw;
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [quote, setQuote] = useState(null);
  const [transfer, setTransfer] = useState(null);

  const [corridorsLoading, setCorridorsLoading] = useState(true);
  const [usdtWallet, setUsdtWallet] = useState(null); // { address, network, label }
  const [bankInfo, setBankInfo] = useState(null); // { beneficiary, iban, bic, bank }
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    Promise.all([
      getCorridors().then(setCorridors).catch(() => {}),
      getPaymentInstructions().then((data) => {
        const w = (data.crypto_wallets || []).find((w) => w.network === "TRC20" || w.network === "TRC-20")
          || (data.crypto_wallets || [])[0] || null;
        setUsdtWallet(w);
        if (data.bank && data.bank.iban) setBankInfo(data.bank);
      }).catch(() => {}),
      getMyPendingTransfer().then((pending) => {
        if (pending) {
          setTransfer(pending);
          setStep("success");
          setFundingMethod(pending.funding_method);
          const isSrcUsdt = pending.funding_method === "usdt";
          setSourceCurrency(isSrcUsdt ? "USDT" : (pending.source_currency || "EUR"));
          setRecipientName((pending.recipient || {}).name || "");
          setRecipientPhone((pending.recipient || {}).phone || "");
        }
      }).catch(() => {}),
    ]).finally(() => setCorridorsLoading(false));
  }, []); // eslint-disable-line

  const handleRefreshStatus = async () => {
    if (!transfer?.transfer_id) return;
    setRefreshing(true);
    try {
      const updated = await getTransfer(transfer.transfer_id);
      setTransfer(updated);
    } catch {
      toast.error("Impossible de rafraîchir le statut");
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-refresh toutes les 30s tant que le transfert n'est pas finalisé
  useEffect(() => {
    const FINAL = ["completed", "failed", "cancelled", "rejected"];
    if (!transfer?.transfer_id || FINAL.includes(transfer.status)) return;
    const id = setInterval(async () => {
      try {
        const updated = await getTransfer(transfer.transfer_id);
        setTransfer(updated);
        if (FINAL.includes(updated.status)) clearInterval(id);
      } catch { /* silencieux */ }
    }, 30000);
    return () => clearInterval(id);
  }, [transfer?.transfer_id, transfer?.status]); // eslint-disable-line

  // USDT uses USD corridor under the hood
  const effectiveSource = sourceCurrency === "USDT" ? "USD" : sourceCurrency;

  // Available source currencies (add USDT if USD corridor exists)
  const availableSources = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of corridors) {
      if (!seen.has(c.source_currency)) { seen.add(c.source_currency); out.push(c.source_currency); }
    }
    if (seen.has("USD") && !seen.has("USDT")) out.push("USDT");
    return out;
  }, [corridors]);

  // Available destination countries for effective source currency
  const availableDestinations = useMemo(() => {
    const seen = new Set();
    return corridors
      .filter((c) => c.source_currency === effectiveSource)
      .filter((c) => { if (seen.has(c.destination_country)) return false; seen.add(c.destination_country); return true; })
      .map((c) => c.destination_country);
  }, [corridors, effectiveSource]);

  // Auto-set destination when source changes
  useEffect(() => {
    if (availableDestinations.length && !availableDestinations.includes(destCountry)) {
      setDestCountry(availableDestinations[0]);
    }
  }, [availableDestinations, destCountry]);

  // Available payout methods for effective source + destination
  const availableMethods = useMemo(() => {
    const seen = new Set();
    return corridors
      .filter((c) => c.source_currency === effectiveSource && c.destination_country === destCountry)
      .filter((c) => { if (seen.has(c.payout_method)) return false; seen.add(c.payout_method); return true; })
      .map((c) => c.payout_method);
  }, [corridors, effectiveSource, destCountry]);

  useEffect(() => {
    if (availableMethods.length && !availableMethods.includes(payoutMethod)) {
      setPayoutMethod(availableMethods[0]);
    }
  }, [availableMethods, payoutMethod]);

  // isUsdtMode convenience flag
  const isUsdtMode = sourceCurrency === "USDT";

  const matchedCorridor = useMemo(() => {
    return corridors.find(
      (c) => c.source_currency === effectiveSource && c.destination_country === destCountry && c.payout_method === payoutMethod
    ) || null;
  }, [corridors, effectiveSource, destCountry, payoutMethod]);

  const displaySourceCurrency = CURRENCY_LABELS[sourceCurrency] || sourceCurrency;
  const displayTargetCurrency = CURRENCY_LABELS[matchedCorridor?.target_currency] || matchedCorridor?.target_currency;

  // Adresse crypto active (depuis l'admin, fallback hardcodé)
  const activeUsdtAddress = usdtWallet?.address || KOBO_USDT_ADDRESS;
  const activeUsdtNetwork = usdtWallet?.network || "TRC-20";
  const activeUsdtLabel = usdtWallet?.label || "USDT";

  const quoteNetSourceAmount = quote
    ? Math.max(Number(quote.source_amount || 0) - Number(quote.fees || 0), 0)
    : 0;

  const resetForm = () => {
    setStep("destination"); setQuote(null); setTransfer(null);
    amountInput.reset(); setRecipientName(""); setRecipientPhone("");
  };

  // Step 1 → 2 (destination → funding)
  const goToFunding = () => {
    if (!isUsdtMode && !destCountry) { toast.error("Sélectionnez un pays de destination"); return; }
    setStep("funding");
  };

  // Step 2 → 3 (funding → amount)
  const goToAmount = () => setStep("amount");

  // Auto-switch funding when source changes to/from USDT
  const handleSourceChange = (val) => {
    setSourceCurrency(val);
    if (val === "USDT") setFundingMethod("usdt");
    else if (fundingMethod === "usdt") setFundingMethod("bank_wire");
  };

  const handleGetQuote = async (e) => {
    e?.preventDefault();
    const num = Number(amount);
    if (!num || num <= 0) { toast.error("Montant invalide"); return; }
    if (!recipientName.trim()) { toast.error("Nom du bénéficiaire requis"); return; }
    if (!recipientPhone.trim()) { toast.error("Numéro requis"); return; }
    if (!matchedCorridor) { toast.error("Corridor indisponible"); return; }
    setLoading(true);
    try {
      const q = await createQuote({
        source_currency: effectiveSource,
        target_currency: matchedCorridor.target_currency,
        source_amount: num,
        destination_country: matchedCorridor.destination_country,
        payout_method: payoutMethod,
      });
      setQuote(q);
      setStep("quote");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Impossible de créer le devis"));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const tr = await createTransfer({
        quote_id: quote.quote_id,
        sender: {
          name: user?.fullName || user?.phone || "Sender",
          phone: user?.phone || "",
          country: sourceCurrency === "XAF" ? "CM" : (user?.country || "FR"),
        },
        recipient: {
          name: recipientName.trim(),
          phone: recipientPhone.trim().replace(/\s/g, ""),
          country: matchedCorridor?.destination_country || "CM",
        },
        funding_method: fundingMethod,
      });
      setTransfer(tr);
      setStep("success");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Impossible de créer le transfert"));
    } finally {
      setLoading(false);
    }
  };

  // ── Succès / Suivi transfert en cours ──────────────────────────────────────
  const FINAL_STATUSES = ["completed", "failed", "cancelled", "rejected"];
  const isFinalized = transfer ? FINAL_STATUSES.includes(transfer.status) : false;

  const STATUS_META = {
    pending_payment:    { label: "En attente de votre paiement", color: "text-amber-600 bg-amber-500/10 border-amber-300/60 dark:border-amber-700/40" },
    pending_settlement: { label: "Paiement reçu — traitement en cours", color: "text-blue-600 bg-blue-500/10 border-blue-300/60 dark:border-blue-700/40" },
    processing:         { label: "Traitement en cours", color: "text-blue-600 bg-blue-500/10 border-blue-300/60 dark:border-blue-700/40" },
    completed:          { label: "Transfert complété", color: "text-green-600 bg-green-500/10 border-green-300/60 dark:border-green-700/40" },
    failed:             { label: "Transfert échoué", color: "text-red-500 bg-red-500/10 border-red-300/60 dark:border-red-700/40" },
    rejected:           { label: "Transfert rejeté", color: "text-red-500 bg-red-500/10 border-red-300/60 dark:border-red-700/40" },
    cancelled:          { label: "Transfert annulé", color: "text-muted-foreground bg-secondary border-border" },
  };

  if (step === "success" && transfer) {
    const displaySrc = sourceCurrency === "USDT" ? "USDT" : transfer.source_currency;
    const isUsdt = fundingMethod === "usdt";
    const srcAmt = Number(transfer.source_amount || 0);
    const tgtAmt = Number(transfer.target_amount || 0);
    const feesAmt = Number(transfer.fees_amount || 0);

    const copyValue = (val, label) => {
      navigator.clipboard.writeText(val).then(() => toast.success(`${label} copié`)).catch(() => {});
    };

    const CopyRow = ({ label, value, mono = false, highlight = false }) => (
      <div className={`flex items-center justify-between gap-2 py-2.5 border-b border-border last:border-0 ${highlight ? "bg-amber-50/60 dark:bg-amber-900/10 -mx-4 px-4" : ""}`}>
        <span className="text-xs text-muted-foreground shrink-0">{label}</span>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm font-medium truncate ${mono ? "font-mono text-xs" : ""} ${highlight ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>{value}</span>
          <button
            onClick={() => copyValue(value, label)}
            className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title={`Copier ${label}`}
          >
            <Copy size={12} />
          </button>
        </div>
      </div>
    );

    const STEPS = [
      {
        icon: <CheckCircle size={18} className="text-emerald-500" />,
        done: true,
        title: "Transfert enregistré",
        sub: (
          <span className="text-xs text-muted-foreground">
            Référence :{" "}
            <button onClick={() => copyValue(transfer.transfer_id, "Référence")} className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-0.5">
              {transfer.transfer_id}<Copy size={10} className="ml-0.5" />
            </button>
          </span>
        ),
      },
      {
        icon: <CircleDot size={18} className="text-primary" />,
        active: true,
        title: isUsdt ? "Envoyez vos USDT — à faire maintenant" : "Effectuez votre virement — à faire maintenant",
        sub: null,
        body: isUsdt ? (
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 divide-y divide-border px-4">
            <div className="py-3 flex items-center gap-2">
              <ShieldCheck size={13} className="text-emerald-500 shrink-0" />
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Réseau : {activeUsdtNetwork} (TRON) uniquement</span>
            </div>
            <CopyRow label="Adresse de réception" value={activeUsdtAddress} mono />
            <CopyRow label="Montant exact à envoyer" value={`${srcAmt.toFixed(2)} USDT`} />
            <CopyRow label="Mémo / Référence" value={transfer.transfer_id} mono highlight />
            <div className="py-3">
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                Tout envoi sur un autre réseau (ERC-20, BEP-20…) entraîne une perte définitive des fonds. Utilisez exclusivement le réseau TRC-20.
              </p>
            </div>
            <div className="py-3">
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                Inscrivez impérativement la référence en mémo/note de la transaction pour que notre équipe puisse identifier votre paiement.
              </p>
            </div>
          </div>
        ) : bankInfo ? (
          <div className="mt-3 rounded-xl border border-amber-200/60 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/10 divide-y divide-border px-4">
            <CopyRow label="Bénéficiaire" value={bankInfo.beneficiary} />
            <CopyRow label="IBAN" value={bankInfo.iban} mono />
            <CopyRow label="BIC / SWIFT" value={bankInfo.bic} mono />
            <CopyRow label="Banque" value={bankInfo.bank} />
            <CopyRow label="Montant exact" value={`${srcAmt.toFixed(2)} ${transfer.source_currency}`} />
            <CopyRow label="Référence OBLIGATOIRE" value={transfer.transfer_id} mono highlight />
            <div className="py-3">
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                La référence est obligatoire. Sans elle, notre équipe ne peut pas identifier votre virement et votre transfert sera retardé.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-amber-200/60 bg-amber-50/50 dark:bg-amber-900/10 p-4">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              Les coordonnées bancaires Kobo ne sont pas encore configurées. Notre équipe vous contactera pour vous les communiquer.
            </p>
            <p className="text-xs text-muted-foreground mt-2">Référence à indiquer : <code className="font-mono text-primary">{transfer.transfer_id}</code></p>
          </div>
        ),
      },
      {
        icon: <Clock size={18} className="text-muted-foreground" />,
        done: false,
        title: isUsdt
          ? "Validation blockchain automatique"
          : "Réception du virement (1 à 3 jours ouvrés)",
        sub: (
          <span className="text-xs text-muted-foreground">
            {isUsdt
              ? "Kobo détecte votre paiement USDT TRC20, contrôle adresse + montant, puis confirme après les validations blockchain requises."
              : "Notre équipe vérifie la réception de votre virement bancaire sur le compte Kobo."}
          </span>
        ),
      },
      {
        icon: <Send size={18} className="text-muted-foreground" />,
        done: false,
        title: `${recipientName || "Le bénéficiaire"} reçoit ${tgtAmt.toLocaleString("fr-FR")} ${transfer.target_currency}`,
        sub: (
          <span className="text-xs text-muted-foreground">
            Envoi via Mobile Money au {recipientPhone || "numéro enregistré"} sous 24h après confirmation.
          </span>
        ),
      },
    ];

    const statusMeta = STATUS_META[transfer.status] || STATUS_META["pending_payment"];

    return (
      <div className="rounded-xl bg-surface border border-border overflow-hidden" data-testid="intl-success">

        {/* Header résumé */}
        <div className="px-5 py-4 bg-emerald-50/60 dark:bg-emerald-900/10 border-b border-border flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
            <CheckCircle2 size={22} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-foreground">Transfert international</p>
            <p className="text-xs text-muted-foreground">
              {formatAmount(srcAmt, displaySrc)} → <span className="font-semibold text-primary">{formatAmount(tgtAmt, transfer.target_currency)}</span>
              {feesAmt > 0 && <> — Frais : {formatAmount(feesAmt, displaySrc)}</>}
            </p>
          </div>
          <button onClick={handleRefreshStatus} disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-background border border-border rounded-lg px-2.5 py-1.5 transition-colors shrink-0">
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Rafraîchir
          </button>
        </div>

        {/* Bannière statut */}
        <div className={`mx-5 mt-4 rounded-xl border px-4 py-2.5 flex items-center gap-2 text-sm font-semibold ${statusMeta.color}`}>
          <CircleDot size={14} className="shrink-0" />
          {statusMeta.label}
          {!isFinalized && <span className="ml-auto text-[10px] font-normal text-muted-foreground">Ref : {transfer.transfer_id?.slice(0, 18)}</span>}
        </div>

        {/* Pipeline étapes */}
        <div className="p-5 space-y-0">
          {STEPS.map((s, i) => (
            <div key={i} className="flex gap-3">
              {/* Colonne icône + trait vertical */}
              <div className="flex flex-col items-center">
                <div className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${s.done ? "bg-emerald-100 dark:bg-emerald-900/30" : s.active ? "bg-primary/10" : "bg-secondary"}`}>
                  {s.icon}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-px flex-1 my-1 ${s.done ? "bg-emerald-300 dark:bg-emerald-700" : "bg-border"}`} style={{ minHeight: 16 }} />
                )}
              </div>
              {/* Contenu */}
              <div className={`pb-5 min-w-0 flex-1 ${i === STEPS.length - 1 ? "pb-0" : ""}`}>
                <p className={`text-sm font-semibold leading-tight ${s.done ? "text-emerald-700 dark:text-emerald-400" : s.active ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.title}
                </p>
                {s.sub && <div className="mt-0.5">{s.sub}</div>}
                {s.body && s.body}
              </div>
            </div>
          ))}
        </div>

        {/* Pied de page */}
        <div className="px-5 pb-5 pt-1 border-t border-border mt-1">
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <ShieldCheck size={11} className="text-primary" />
            {isFinalized
              ? "Ce transfert est finalisé. Vous pouvez en initier un nouveau."
              : "Un transfert est en cours. Finalisez-le avant d'en créer un nouveau."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/dashboard")} className="flex-1 h-9 rounded-md text-sm">Tableau de bord</Button>
            {isFinalized ? (
              <Button onClick={resetForm} className="flex-1 h-9 bg-primary hover:bg-primary/90 rounded-md text-primary-foreground text-sm font-semibold">
                Nouveau transfert
              </Button>
            ) : (
              <Button disabled className="flex-1 h-9 rounded-md text-sm font-semibold opacity-50 cursor-not-allowed flex items-center justify-center gap-1.5">
                <Lock size={12} />
                Transfert en cours
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Devis ──────────────────────────────────────────────────────────────────
  if (step === "quote" && quote) {
    const displaySrc = isUsdtMode ? "USDT" : quote.source_currency;
    return (
      <div className="space-y-4" data-testid="intl-quote-step">
        <div className="rounded-xl bg-surface border border-border overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-bold text-base">Récapitulatif du transfert</h3>
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Valide 15 min</span>
          </div>

          <div className="p-5 space-y-4">
            {/* Visuel envoi → réception */}
            <div className="flex items-center gap-3 bg-secondary/50 rounded-xl p-4">
              <div className="flex-1 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Vous envoyez</p>
                <p className="text-2xl font-black tabular-nums text-foreground">{formatAmount(quote.source_amount, displaySrc)}</p>
              </div>
              <ArrowRight size={20} className="text-primary shrink-0" />
              <div className="flex-1 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Reçoit</p>
                <p className="text-2xl font-black tabular-nums text-primary">{formatAmount(quote.target_amount, quote.target_currency)}</p>
              </div>
            </div>

            {(() => {
              const spread = quote.metadata?.spread_rate || 0;
              const rawRate = quote.metadata?.raw_fx_rate || quote.fx_rate;
              return (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Frais Kobo</span>
                    <span className="tabular-nums text-foreground">{formatAmount(quote.fees, displaySrc)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Montant converti</span>
                    <span className="tabular-nums text-foreground">{formatAmount(quoteNetSourceAmount, displaySrc)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground text-xs pt-1.5 border-t border-border">
                    <span>Taux appliqué</span>
                    <span className="tabular-nums">1 {displaySrc} = {Number(quote.fx_rate).toFixed(4)} {quote.target_currency}</span>
                  </div>
                  {spread > 0 && (
                    <div className="flex justify-between text-muted-foreground text-xs">
                      <span>Taux marché</span>
                      <span className="tabular-nums text-muted-foreground/70">{Number(rawRate).toFixed(4)} {quote.target_currency} <span className="text-[10px]">(-{(spread * 100).toFixed(1)}% spread)</span></span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Bénéficiaire recap */}
            <div className="rounded-xl bg-secondary/40 p-3 text-sm space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bénéficiaire</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Nom</span><span className="font-medium">{recipientName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{isUsdtMode || payoutMethod === "mobile_money" ? "Mobile Money" : "IBAN"}</span><span className="font-medium font-mono text-xs">{recipientPhone}</span></div>
            </div>

            {/* Instructions USDT */}
            {isUsdtMode && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <Coins size={12} />{activeUsdtLabel} — {activeUsdtNetwork}
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono break-all flex-1 text-foreground">{activeUsdtAddress}</code>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(activeUsdtAddress); toast.success("Adresse copiée"); }}
                    className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors">
                    <Copy size={12} />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">Envoyez exactement <strong className="text-foreground">{formatAmount(quote.source_amount, "USDT")}</strong> après confirmation.</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setStep("amount")} className="flex-1 rounded-md h-10">Modifier</Button>
          <Button onClick={handleConfirm} disabled={loading} className="flex-1 bg-primary hover:bg-primary/90 rounded-md h-10 text-primary-foreground font-semibold">
            {loading ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
            Confirmer <ArrowRight size={15} className="ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Wrapper commun ──────────────────────────────────────────────────────────

  // ── Étape 1 : Destination ───────────────────────────────────────────────────
  if (step === "destination") {
    if (corridorsLoading) {
      return (
        <div className="rounded-xl bg-surface border border-border p-8 flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Chargement des destinations disponibles…</p>
        </div>
      );
    }

    return (
      <WizardShell currentStep={step}
        title="Vers quel pays ?"
        subtitle="Choisissez la devise, la destination et le mode de réception."
        onNext={goToFunding}
        nextDisabled={!isUsdtMode && !destCountry}
      >
        {/* Source currency */}
        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Devise que vous envoyez</Label>
          <Select value={sourceCurrency} onValueChange={handleSourceChange}>
            <SelectTrigger data-testid="intl-source-currency" className="rounded-md mt-2 h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableSources.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="flex items-center gap-2 font-medium">
                    {c === "USDT" && <Coins size={13} className="text-emerald-500" />}
                    {CURRENCY_LABELS[c] || c}
                    {c === "USDT" && <span className="text-[10px] text-muted-foreground ml-1">≈ USD</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isUsdtMode ? (
          /* USDT: destination fixe CM */
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Coins size={15} className="text-emerald-500 shrink-0" />
              <p className="text-sm font-semibold text-foreground">USDT (TRC-20) → Cameroun</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Le destinataire reçoit l'équivalent en <strong className="text-foreground">FCFA via Mobile Money</strong> au Cameroun. Taux calculé sur le corridor USD → XAF.
            </p>
          </div>
        ) : (
          <>
            {/* Destination country */}
            {availableDestinations.length > 0 && (
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pays de destination</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {availableDestinations.map((c) => (
                    <button key={c} type="button" onClick={() => setDestCountry(c)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all
                        ${destCountry === c ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "border-border text-foreground hover:border-primary/40"}`}>
                      <Globe size={14} className={destCountry === c ? "text-primary" : "text-muted-foreground"} />
                      {COUNTRY_LABELS[c] || c}
                      {destCountry === c && <CheckCircle2 size={13} className="ml-auto text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payout method */}
            {availableMethods.length > 0 && (
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Le bénéficiaire reçoit via</Label>
                <div className="mt-2 flex gap-2">
                  {availableMethods.map((m) => (
                    <button key={m} type="button" onClick={() => setPayoutMethod(m)}
                      className={`flex-1 flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-all
                        ${payoutMethod === m ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                      {m === "mobile_money" ? <><Smartphone size={15} />Mobile Money</> : <><Landmark size={15} />Virement bancaire</>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </WizardShell>
    );
  }

  // ── Étape 2 : Méthode de paiement ──────────────────────────────────────────
  if (step === "funding") {
    return (
      <WizardShell currentStep={step}
        title="Comment voulez-vous payer ?"
        subtitle="Choisissez la méthode avec laquelle vous financez le transfert."
        onBack={() => setStep("destination")}
        onNext={goToAmount}
      >
        <div className="space-y-2">
          {FUNDING_METHODS.map(({ id, label, desc, icon: Icon, available }) => {
            const disabled = !available || (id === "bank_wire" && isUsdtMode) || (id === "usdt" && sourceCurrency === "XAF");
            const selected = fundingMethod === id;
            return (
              <button key={id} type="button" disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setFundingMethod(id);
                  if (id === "usdt") setSourceCurrency("USDT");
                  else if (sourceCurrency === "USDT") setSourceCurrency("EUR");
                }}
                className={`relative w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all
                  ${disabled ? "opacity-35 cursor-not-allowed" : "cursor-pointer"}
                  ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-surface hover:border-primary/40"}`}>
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0
                  ${selected ? "bg-primary/10" : "bg-secondary"}`}>
                  <Icon size={18} className={selected ? "text-primary" : "text-muted-foreground"} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${selected ? "text-foreground" : "text-foreground"}`}>{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
                {!available && (
                  <span className="text-[9px] font-bold text-muted-foreground bg-secondary px-2 py-0.5 rounded-full shrink-0">Bientôt</span>
                )}
                {selected && <CheckCircle2 size={16} className="text-primary shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* USDT: adresse affichée immédiatement si USDT sélectionné */}
        {isUsdtMode && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Coins size={12} />{activeUsdtLabel} — {activeUsdtNetwork}
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono break-all flex-1 text-foreground">{activeUsdtAddress}</code>
              <button type="button" onClick={() => { navigator.clipboard.writeText(activeUsdtAddress); toast.success("Adresse copiée"); }}
                className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors">
                <Copy size={12} />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">Réseau {activeUsdtNetwork} uniquement. Kobo détecte automatiquement le paiement sur la blockchain après l'envoi.</p>
          </div>
        )}
      </WizardShell>
    );
  }

  // ── Étape 3 : Montant & bénéficiaire ───────────────────────────────────────
  if (step === "amount") {
    const destLabel = isUsdtMode ? "Cameroun" : (COUNTRY_LABELS[destCountry] || destCountry);
    const payoutLabel = (isUsdtMode || payoutMethod === "mobile_money") ? "Mobile Money" : "Virement bancaire";
    const fundingLabel = isUsdtMode ? "USDT (TRC-20)" : "Virement bancaire";

    return (
      <WizardShell currentStep={step}
        title="Montant & bénéficiaire"
        subtitle="Indiquez le montant à envoyer et les coordonnées du destinataire."
        onBack={() => setStep("funding")}
        onNext={handleGetQuote}
        nextLabel={loading ? "Calcul…" : "Calculer le transfert"}
        nextLoading={loading}
        nextDisabled={!matchedCorridor && !isUsdtMode}
      >
        {/* Récap chips */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { icon: Globe, label: destLabel },
            { icon: Smartphone, label: payoutLabel },
            { icon: Landmark, label: fundingLabel },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-secondary text-muted-foreground px-2.5 py-1 rounded-full">
              <Icon size={11} />{label}
            </span>
          ))}
        </div>

        {/* Montant */}
        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Montant à envoyer ({isUsdtMode ? "USDT" : displaySourceCurrency})
          </Label>
          <Input type="text" inputMode="numeric" data-testid="intl-amount"
            value={amountInput.display} onChange={amountInput.onChange}
            placeholder="0" className="rounded-md mt-2 tabular-nums text-2xl font-bold h-12" />
          {matchedCorridor && !isUsdtMode && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Le destinataire recevra en <strong className="text-foreground">{displayTargetCurrency}</strong>
              {" · "}taux calculé au moment de la confirmation
            </p>
          )}
          {isUsdtMode && (
            <p className="text-xs text-muted-foreground mt-1.5">
              1 USDT ≈ 1 USD · Le destinataire recevra l'équivalent en FCFA (taux du jour)
            </p>
          )}
        </div>

        {/* Bénéficiaire */}
        <div>
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bénéficiaire</Label>
          <div className="mt-2 space-y-2">
            <Input placeholder="Nom complet" value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
              data-testid="intl-recipient-name" className="rounded-md" />
            {isUsdtMode || payoutMethod === "mobile_money" ? (
              /* Input CM fixe — pas de sélecteur de pays, toujours +237 */
              <div className="flex rounded-md overflow-hidden border border-border focus-within:ring-2 focus-within:ring-ring bg-background">
                <span className="flex items-center px-3 py-2.5 border-r border-border bg-secondary text-sm font-medium text-foreground shrink-0 select-none">
                  +237
                </span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  data-testid="intl-recipient-phone"
                  value={recipientPhone.replace(/^\+237/, "").replace(/\D/g, "")}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                    setRecipientPhone(digits ? `+237${digits}` : "");
                  }}
                  placeholder="6 XX XX XX XX"
                  className="border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 tabular-nums"
                />
              </div>
            ) : (
              <Input placeholder="IBAN du compte bénéficiaire" value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)} data-testid="intl-recipient-phone" className="rounded-md" />
            )}
          </div>
        </div>

        {!matchedCorridor && !isUsdtMode && (
          <p className="text-xs text-destructive">Aucun corridor disponible pour cette combinaison.</p>
        )}
      </WizardShell>
    );
  }

  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Transfer() {
  const { t } = useI18n();

  return (
    <div className="max-w-xl mx-auto space-y-6" data-testid="transfer-page">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("transfer.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">Kobo vers Kobo · International</p>
      </div>

      <Tabs defaultValue="p2p" className="w-full">
        <TabsList className="w-full grid grid-cols-2 bg-secondary rounded-md p-1">
          <TabsTrigger value="p2p" data-testid="tab-p2p" className="rounded-md data-[state=active]:bg-surface data-[state=active]:text-primary">
            <User size={14} className="mr-1.5" /> P2P (FCFA)
          </TabsTrigger>
          <TabsTrigger value="international" data-testid="tab-international" className="rounded-md data-[state=active]:bg-surface data-[state=active]:text-primary">
            <Globe size={14} className="mr-1.5" /> International
          </TabsTrigger>
        </TabsList>
        <TabsContent value="p2p" className="mt-5">
          <P2PTab t={t} />
        </TabsContent>
        <TabsContent value="international" className="mt-5">
          <IntlTab t={t} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
