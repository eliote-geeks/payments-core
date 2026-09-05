import React, { useState, useEffect } from "react";
import { Smartphone, Building2, Bitcoin, ArrowRight, CheckCircle, Clock, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { formatAmount } from "../lib/format";
import { useCurrencyInput } from "../hooks/useCurrencyInput";
import { useI18n } from "../context/I18nContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getFiatWithdrawalFeePreview, initFiatWithdrawal } from "../api/fiatWithdrawals";
import { getKycStatus } from "../api/kyc";
import { api } from "../api/client";

const PROVIDERS = [
  { id: "mtn",    icon: Smartphone, color: "#FFCC00", textColor: "#000" },
  { id: "orange", icon: Smartphone, color: "#FF6600", textColor: "#FFF" },
  { id: "bank",   icon: Building2,  color: "#1A4EF0", textColor: "#FFF" },
  { id: "crypto", icon: Bitcoin,    color: "#F7931A", textColor: "#FFF" },
];

const EMPTY_FORM = { recipientPhone: "", recipientName: "", iban: "", pin: "" };

export default function Withdraw() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [provider, setProvider] = useState("mtn");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPin, setShowPin] = useState(false);
  const amountInput = useCurrencyInput("");
  const [limit, setLimit] = useState({ dailyRemainingFCFA: 0 });
  const [done, setDone] = useState(null);
  const [loading, setLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState(null);
  const [feePreview, setFeePreview] = useState(null);

  useEffect(() => {
    api.get("/service-status").then((r) => setServiceStatus(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (provider === "crypto") navigate("/crypto-withdraw");
  }, [provider]);

  useEffect(() => {
    getKycStatus()
      .then((res) => { if (res?.limits) setLimit(res.limits); })
      .catch(() => {});
  }, []);

  const isMomo = provider === "mtn" || provider === "orange";
  const withdrawalMethod = isMomo ? "mobile_money" : "bank_transfer";
  const minAmountFcfa = Number(feePreview?.min_amount_fcfa || 500);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (provider === "crypto") return;
    let ignore = false;
    getFiatWithdrawalFeePreview({
      amount: Number(amountInput.numValue || 0),
      currency: "FCFA",
      method: withdrawalMethod,
    })
      .then((data) => { if (!ignore) setFeePreview(data); })
      .catch(() => {});
    return () => { ignore = true; };
  }, [amountInput.numValue, provider, withdrawalMethod]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(amountInput.numValue || 0);
    if (amount <= 0) { toast.error("Montant invalide"); return; }
    if (amount < minAmountFcfa) { toast.error(`Minimum ${minAmountFcfa.toLocaleString("fr-FR")} FCFA`); return; }

    setLoading(true);
    try {
      const payload = {
        amount,
        currency: "FCFA",
        method: withdrawalMethod,
        recipient_name: isMomo ? (form.recipientName || form.recipientPhone) : form.recipientName,
        recipient_phone: isMomo ? form.recipientPhone : undefined,
        recipient_iban: !isMomo ? form.iban.replace(/\s/g, "").toUpperCase() : undefined,
        provider: isMomo ? provider : undefined,
        pin: form.pin || undefined,
      };
      const res = await initFiatWithdrawal(payload);
      setDone({ ...res, _method: isMomo ? "momo" : "bank" });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("common.retry"));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setDone(null);
    amountInput.reset();
    setForm(EMPTY_FORM);
  };

  // ── Maintenance ──────────────────────────────────────────────────────────
  if (serviceStatus && !serviceStatus.withdrawals_enabled) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("withdraw.title")}</h1>
        <div className="rounded-2xl border border-orange-200 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30 p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto bg-orange-100 dark:bg-orange-900/40">
            <AlertTriangle size={28} className="text-orange-500" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-orange-700 dark:text-orange-400">Retraits temporairement indisponibles</h2>
            <p className="text-sm text-orange-600 dark:text-orange-300 mt-2">
              {serviceStatus.withdrawals_message || "Les retraits sont temporairement indisponibles. Nous travaillons à résoudre le problème au plus vite."}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Vos fonds sont en sécurité. Réessayez dans quelques instants.</p>
        </div>
      </div>
    );
  }

  // ── Écran de confirmation ────────────────────────────────────────────────
  if (done) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("withdraw.title")}</h1>
        <div className="rounded-2xl border border-border bg-surface p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto bg-primary/10">
            {done._method === "momo" ? <CheckCircle size={36} className="text-primary" /> : <Clock size={36} className="text-primary" />}
          </div>
          <div>
            <h2 className="font-display text-xl font-bold">
              {done._method === "momo" ? "Paiement en cours !" : "Demande enregistrée !"}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {done.message || (done._method === "momo"
                ? `Tu vas recevoir une notification ${provider.toUpperCase()} sous peu.`
                : "L'équipe Kobo traitera ta demande sous 2-3 jours ouvrés."
              )}
            </p>
          </div>
          {done.withdrawal_id && (
            <div className="bg-secondary rounded-xl p-3 text-xs text-left space-y-1">
              <p className="text-muted-foreground">Référence</p>
              <p className="font-mono font-medium">{done.withdrawal_id}</p>
            </div>
          )}
          <Button onClick={reset} variant="outline" className="w-full">
            Nouveau retrait
          </Button>
        </div>
      </div>
    );
  }

  // ── Formulaire ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto space-y-6" data-testid="withdraw-page">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("withdraw.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("withdraw.limitLeft")}: <span className="font-semibold text-foreground">{formatAmount(limit?.dailyRemainingFCFA || 0)}</span> / {t("kyc.daily").toLowerCase()}
        </p>
      </div>

      {/* Banner crypto */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Retrait crypto</p>
            <p className="text-xs text-muted-foreground mt-1">
              Pour retirer en USDT ou vers une adresse crypto, utilise l'espace dédié.
            </p>
          </div>
          <Button type="button" variant="outline" className="shrink-0"
            onClick={() => navigate("/crypto-withdraw")} data-testid="withdraw-crypto-link">
            Ouvrir
          </Button>
        </div>
      </div>

      {/* Sélection méthode */}
      <div>
        <Label className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">{t("withdraw.provider")}</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="withdraw-providers">
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            const active = provider === p.id;
            return (
              <button key={p.id} type="button" onClick={() => setProvider(p.id)}
                data-testid={`withdraw-provider-${p.id}`}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-colors ${
                  active ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border bg-surface hover:border-primary/40"
                }`}>
                <span className="h-9 w-9 rounded-full flex items-center justify-center" style={{ background: p.color, color: p.textColor }}>
                  <Icon size={16} />
                </span>
                <span className="text-xs font-medium">{t(`withdraw.${p.id}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Formulaire selon méthode */}
      <form onSubmit={handleSubmit} className="rounded-xl bg-surface border border-border p-5 sm:p-6 space-y-4" data-testid="withdraw-form">

        {/* Mobile Money (MTN / Orange) */}
        {isMomo && (
          <>
            <div>
              <Label>{t("withdraw.momoNumber")}</Label>
              <Input placeholder="+237 6 77 12 34 56" value={form.recipientPhone}
                onChange={set("recipientPhone")} className="rounded-md mt-1.5" required />
            </div>
            <div>
              <Label>Nom du bénéficiaire</Label>
              <Input placeholder="Jean Dupont" value={form.recipientName}
                onChange={set("recipientName")} className="rounded-md mt-1.5" />
              <p className="text-[11px] text-muted-foreground mt-1">Optionnel — laisse vide pour utiliser ton numéro comme référence</p>
            </div>
            <div>
              <Label>{t("transfer.amount")} (FCFA)</Label>
              <Input type="text" inputMode="numeric" value={amountInput.display}
                onChange={amountInput.onChange} placeholder="0"
                className="rounded-md mt-1.5 text-lg font-semibold tabular-nums" required />
            </div>
            <div className="p-3 rounded-lg bg-secondary text-xs text-muted-foreground flex gap-2">
              <CheckCircle size={14} className="text-green-500 shrink-0 mt-0.5" />
              <span>Minimum {minAmountFcfa.toLocaleString("fr-FR")} FCFA. Envoi direct sur ton numéro <strong>{provider.toUpperCase()}</strong>. Traitement en quelques secondes.</span>
            </div>
          </>
        )}

        {/* Virement bancaire */}
        {provider === "bank" && (
          <>
            <div>
              <Label>{t("withdraw.iban")}</Label>
              <Input value={form.iban} onChange={set("iban")}
                className="rounded-md mt-1.5" placeholder="CM21 1000 0100 0000 0000 0000 000" required />
            </div>
            <div>
              <Label>Nom du titulaire du compte</Label>
              <Input value={form.recipientName} onChange={set("recipientName")}
                className="rounded-md mt-1.5" placeholder="Jean Dupont" required />
            </div>
            <div>
              <Label>{t("transfer.amount")} (FCFA)</Label>
              <Input type="text" inputMode="numeric" value={amountInput.display}
                onChange={amountInput.onChange}
                className="rounded-md mt-1.5 text-lg font-semibold tabular-nums" required />
            </div>
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-700 dark:text-amber-300">
              Traitement manuel sous 2-3 jours ouvrés. L'équipe Kobo effectuera le virement depuis notre banque partenaire.
            </div>
          </>
        )}

        {/* PIN (toujours visible si méthode sélectionnée) */}
        {provider !== "crypto" && (
          <div>
            <Label>Code PIN de sécurité</Label>
            <div className="relative mt-1.5">
              <Input type={showPin ? "text" : "password"} inputMode="numeric"
                placeholder="••••" maxLength={8} value={form.pin}
                onChange={set("pin")}
                className="rounded-md pr-10 font-mono tracking-widest" />
              <button type="button" onClick={() => setShowPin((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Le PIN que tu as défini dans ton profil. Laisse vide si aucun PIN n'est configuré.</p>
          </div>
        )}

        {provider !== "crypto" && (
          <Button type="submit" disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 rounded-md h-11 text-primary-foreground font-semibold">
            {loading ? "Traitement…" : <>{t("common.confirm")} <ArrowRight size={16} className="ml-1" /></>}
          </Button>
        )}
      </form>
    </div>
  );
}
