import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Building2, Smartphone, CheckCircle2, Clock,
  ShieldAlert, Loader2, AlertTriangle
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { PinInput } from "../components/common/PinInput";
import { toast } from "sonner";
import { getFiatWithdrawalFeePreview, initFiatWithdrawal } from "../api/fiatWithdrawals";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

const PROVIDERS = [
  { id: "mtn",    label: "MTN Mobile Money", color: "bg-yellow-400 text-black", ring: "ring-yellow-400" },
  { id: "orange", label: "Orange Money",      color: "bg-orange-500 text-white", ring: "ring-orange-500" },
];

export default function FiatWithdraw() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const initCurrency = params.get("currency") || "FCFA";

  const [currency, setCurrency] = useState(initCurrency);
  const [method, setMethod]     = useState("bank_transfer");
  const [amount, setAmount]     = useState("");
  const [recipientName, setRecipientName] = useState(user?.fullName || "");
  const [iban, setIban]         = useState("");
  const [phone, setPhone]       = useState("");
  const [provider, setProvider] = useState("mtn");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [serviceStatus, setServiceStatus] = useState(null);
  const [feePreview, setFeePreview] = useState(null);

  useEffect(() => {
    api.get("/service-status").then((r) => setServiceStatus(r.data)).catch(() => {});
  }, []);

  const kycLevel = user?.kycLevel ?? 0;
  const kycBlocked = kycLevel < 1;
  const effectiveMethod = currency === "FCFA" ? method : "bank_transfer";
  const minAmountFcfa = Number(feePreview?.min_amount_fcfa || 500);

  const amountNumber = parseFloat(amount || "0");
  const feeFcfa = amountNumber > 0 ? Number(feePreview?.fee_fcfa || 0) : 0;
  const totalDebited = amountNumber + feeFcfa;

  useEffect(() => {
    let ignore = false;
    getFiatWithdrawalFeePreview({
      amount: amountNumber || 0,
      currency,
      method: effectiveMethod,
    })
      .then((data) => { if (!ignore) setFeePreview(data); })
      .catch(() => {});
    return () => { ignore = true; };
  }, [amountNumber, currency, effectiveMethod]);

  const formatAmount = (val) => {
    if (!val) return "";
    return parseInt(val, 10).toLocaleString("fr-FR");
  };

  const handleAmountChange = (e) => setAmount(e.target.value.replace(/\D/g, ""));

  const handleSubmit = async () => {
    const num = parseFloat(amount);
    if (!num || num < minAmountFcfa) { toast.error(`Minimum ${minAmountFcfa.toLocaleString("fr-FR")} FCFA`); return; }
    if (!recipientName.trim()) { toast.error("Nom du bénéficiaire requis"); return; }
    if (effectiveMethod === "bank_transfer" && !iban.trim()) { toast.error("IBAN requis"); return; }
    if (effectiveMethod === "mobile_money" && !phone.trim()) { toast.error("Numéro de téléphone requis"); return; }
    if (!user?.hasPin) {
      toast.error("Définis d'abord ton code PIN dans Profil avant de faire un retrait.");
      return;
    }

    setPendingPayload({
      amount: num,
      currency,
      method: effectiveMethod,
      recipient_name: recipientName.trim(),
      ...(effectiveMethod === "bank_transfer" ? { recipient_iban: iban.replace(/\s/g, "").toUpperCase() } : {}),
      ...(effectiveMethod === "mobile_money"  ? { recipient_phone: phone.trim(), provider } : {}),
    });
    setConfirmOpen(true);
  };

  const handlePinComplete = async (pin) => {
    if (!pendingPayload) return;
    setPinOpen(false);
    setLoading(true);
    try {
      const res = await initFiatWithdrawal({ ...pendingPayload, pin });
      setResult(res);
      setPendingPayload(null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  // ── SUCCESS ─────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-6 text-center space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
          </div>
          <h2 className="text-xl font-bold">Demande envoyée</h2>
          <p className="text-gray-400 text-sm">{result.message}</p>
          <div className="bg-gray-800 rounded-xl p-4 text-left space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Référence</span>
              <span className="font-mono text-xs">{result.reference}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Statut</span>
              <span className="flex items-center gap-1 text-yellow-400">
                <Clock className="w-3 h-3" /> En attente
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Vos fonds sont réservés et seront envoyés après validation par notre équipe.
          </p>
          <Button className="w-full" onClick={() => navigate("/dashboard")}>
            Retour au dashboard
          </Button>
        </div>
      </div>
    );
  }

  // ── KYC BLOCKED ─────────────────────────────────────────────────────────────
  if (kycBlocked) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-6 text-center space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/10 mx-auto">
            <ShieldAlert className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold">Vérification requise</h2>
          <p className="text-gray-400 text-sm">
            Pour effectuer un retrait, vous devez compléter votre vérification d'identité (KYC niveau 1 minimum).
          </p>
          <Button className="w-full" onClick={() => navigate("/kyc")}>
            Compléter mon KYC
          </Button>
          <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-white transition">
            Retour
          </button>
        </div>
      </div>
    );
  }

  // ── MAINTENANCE ──────────────────────────────────────────────────────────────
  if (serviceStatus && !serviceStatus.withdrawals_enabled) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm space-y-5">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold">Retrait</h1>
          </div>
          <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto bg-orange-500/20">
              <AlertTriangle className="w-7 h-7 text-orange-400" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-orange-400">Retraits temporairement indisponibles</h2>
              <p className="text-sm text-orange-300/80 mt-2 leading-relaxed">
                {serviceStatus.withdrawals_message || "Les retraits sont temporairement indisponibles. Nous travaillons à résoudre le problème au plus vite."}
              </p>
            </div>
            <p className="text-xs text-gray-500">Vos fonds sont en sécurité. Réessayez dans quelques instants.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── FORM ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Retirer des fonds</h1>
        </div>

        {/* Security badge */}
        <div className="flex items-center gap-2 bg-green-500/10 text-green-400 rounded-xl px-4 py-2 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          KYC niveau {kycLevel} — retraits autorisés
        </div>

        {/* Currency tabs */}
        <div className="flex gap-2 bg-gray-900 p-1 rounded-xl">
          {["FCFA", "EUR", "USD"].map((c) => (
            <button key={c} onClick={() => setCurrency(c)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${currency === c ? "bg-white text-black shadow" : "text-gray-400 hover:text-white"}`}>
              {c}
            </button>
          ))}
        </div>

        {/* Method (FCFA only supports mobile money too) */}
        {currency === "FCFA" && (
          <div className="flex gap-2 bg-gray-900 p-1 rounded-xl">
            {[
              { id: "mobile_money", label: "Mobile Money", icon: <Smartphone className="w-4 h-4" /> },
              { id: "bank_transfer", label: "Virement", icon: <Building2 className="w-4 h-4" /> },
            ].map(({ id, label, icon }) => (
              <button key={id} onClick={() => setMethod(id)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all ${method === id ? "bg-white text-black shadow" : "text-gray-400 hover:text-white"}`}>
                {icon}{label}
              </button>
            ))}
          </div>
        )}

        {/* Amount */}
        <div className="space-y-1.5">
          <label className="text-sm text-gray-400">Montant ({currency})</label>
          <div className="relative">
            <Input type="text" inputMode="numeric" placeholder="Ex: 50 000"
              value={formatAmount(amount)} onChange={handleAmountChange}
              className="bg-gray-900 border-gray-700 text-white text-lg pr-16" />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{currency}</span>
          </div>
          <p className="text-xs text-gray-500">Minimum {minAmountFcfa.toLocaleString("fr-FR")} FCFA</p>
        </div>

        {/* Recipient name — always required */}
        <div className="space-y-1.5">
          <label className="text-sm text-gray-400">Nom du bénéficiaire</label>
          <Input placeholder="Prénom NOM (exactement comme sur le compte)"
            value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
            className="bg-gray-900 border-gray-700 text-white" />
          <p className="text-xs text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Doit correspondre à votre identité KYC
          </p>
        </div>

        {/* Bank transfer fields */}
        {(effectiveMethod === "bank_transfer") && (
          <div className="space-y-1.5">
            <label className="text-sm text-gray-400">IBAN</label>
            <Input placeholder="CM21 0001 0000 0000 0000 0001 123"
              value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())}
              className="bg-gray-900 border-gray-700 text-white font-mono text-sm" />
            <p className="text-xs text-gray-500">
              Le nom du titulaire doit correspondre au champ ci-dessus.
            </p>
          </div>
        )}

        {/* Mobile money fields */}
        {effectiveMethod === "mobile_money" && (
          <>
            <div className="flex gap-3">
              {PROVIDERS.map((p) => (
                <button key={p.id} onClick={() => setProvider(p.id)}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ring-2 ${provider === p.id ? `${p.color} ${p.ring}` : "bg-gray-800 text-gray-300 ring-transparent"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-gray-400">Numéro de réception</label>
              <Input type="tel" placeholder="+237 6XX XXX XXX"
                value={phone} onChange={(e) => setPhone(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white" />
            </div>
          </>
        )}

        {/* Info box */}
        <div className="bg-gray-900 rounded-xl p-4 text-xs text-gray-400 space-y-1">
          <p>• Vos fonds sont débités immédiatement et réservés</p>
          {effectiveMethod === "mobile_money"
            ? <p>• Envoi automatique vers votre compte Mobile Money (quelques minutes)</p>
            : <p>• Traitement sous 1–3 jours ouvrés après validation</p>}
          <p>• Un récapitulatif et votre code PIN seront demandés avant validation</p>
          <p>• En cas d'échec, les fonds sont remboursés automatiquement</p>
        </div>

        <Button className="w-full py-3 text-base" onClick={handleSubmit} disabled={loading}>
          {loading
            ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Traitement...</span>
            : "Continuer"}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Confirmer le retrait</DialogTitle>
            <DialogDescription>Vérifie les informations avant de lancer la demande.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl bg-secondary/60 p-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Méthode</span>
                <span className="font-medium">{effectiveMethod === "mobile_money" ? "Mobile Money" : "Virement bancaire"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-medium">{formatAmount(amountNumber)} {currency}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Frais estimés</span>
                <span className="font-medium">{feeFcfa.toLocaleString("fr-FR")} FCFA</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Bénéficiaire</span>
                <span className="font-medium text-right">{recipientName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{effectiveMethod === "mobile_money" ? "Numéro" : "IBAN"}</span>
                <span className="font-medium text-right break-all">{effectiveMethod === "mobile_money" ? phone : iban}</span>
              </div>
              <div className="border-t border-border pt-3 flex justify-between gap-4 font-bold">
                <span>Total débité</span>
                <span>{totalDebited.toLocaleString("fr-FR")} FCFA</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)}>
                Annuler
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={() => {
                  setConfirmOpen(false);
                  setPinOpen(true);
                }}
              >
                Confirmer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Entre ton code PIN</DialogTitle>
            <DialogDescription>
              {totalDebited.toLocaleString("fr-FR")} FCFA seront réservés pour ce retrait.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <PinInput length={6} onComplete={handlePinComplete} testId="withdraw-pin" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
