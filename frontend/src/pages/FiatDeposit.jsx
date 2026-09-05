import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Smartphone, Building2, CheckCircle2,
  Copy, Check, Loader2, XCircle, ExternalLink, AlertTriangle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { initMobileMoney, initBankTransfer } from "../api/deposits";
import { api } from "../api/client";

// Pour SharePay : l'opérateur déduit ses frais avant de verser à Kobo → net = gross - opFee - koboFee
// Pour NotchPay : charge:'customer' → les frais opérateur sont ajoutés EN PLUS sur le téléphone,
//   Kobo reçoit le gross complet → net = gross - koboFee seulement
function calcFees(amount, operatorRate, koboRate, isNotchPay = false) {
  const gross = parseInt(amount, 10) || 0;
  if (gross <= 0) return null;
  if (isNotchPay) {
    const opFee   = Math.ceil(gross * operatorRate / 100);
    const koboFee = Math.ceil(gross * koboRate / 100);
    return { gross, opFee, koboFee, net: gross - koboFee };
  }
  const opFee   = Math.ceil(gross * operatorRate / 100);
  const afterOp = gross - opFee;
  const koboFee = Math.ceil(afterOp * koboRate / 100);
  return { gross, opFee, koboFee, net: afterOp - koboFee };
}

export default function FiatDeposit() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initCurrency = params.get("currency") || "FCFA";

  const [currency, setCurrency]     = useState(initCurrency);
  const [amount, setAmount]         = useState("");
  const [senderIban, setSenderIban] = useState("");
  const [senderName, setSenderName] = useState("");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState(null);
  const [copied, setCopied]         = useState(false);

  const [config, setConfig] = useState({ active_provider: "sharepay", operator_fee_rate: 1.6, kobo_fee_rate: 0 });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [serviceStatus, setServiceStatus] = useState(null);

  const isMobileMoney  = currency === "FCFA";
  const isBankTransfer = currency === "EUR" || currency === "USD";
  const paymentPageLabel = "page de paiement sécurisée";

  useEffect(() => {
    api.get("/deposits/config")
      .then(({ data }) => setConfig(data))
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
    api.get("/service-status").then((r) => setServiceStatus(r.data)).catch(() => {});
  }, []);

  const handleAmountChange = (e) => setAmount(e.target.value.replace(/\D/g, ""));
  const formatAmount = (val) => (!val ? "" : parseInt(val, 10).toLocaleString("fr-FR"));

  const handleSubmit = async () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) { toast.error("Entrez un montant valide"); return; }
    if (isMobileMoney && num < 100) { toast.error("Minimum 100 FCFA"); return; }
    setLoading(true);
    try {
      if (isMobileMoney) {
        const res = await initMobileMoney({ amount: num, currency: "FCFA" });
        if (res.authorization_url) {
          window.location.href = res.authorization_url;
          return;
        }
        toast.info(res.message || "Paiement initié…");
      } else {
        const res = await initBankTransfer({
          amount: num,
          currency,
          sender_iban: senderIban.replace(/\s/g, "").toUpperCase() || undefined,
          sender_name: senderName.trim() || undefined,
        });
        setResult(res);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("Copié !");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── BANK TRANSFER SUCCESS ─────────────────────────────────────────────────
  if (result && isBankTransfer) {
    const bd = result.bank_details || {};
    const fields = [
      { label: "Banque",               value: bd.bank_name },
      { label: "Bénéficiaire",         value: bd.account_name },
      { label: "IBAN",                 value: bd.iban },
      { label: "BIC / SWIFT",          value: bd.bic },
      { label: "Montant",              value: `${bd.amount} ${bd.currency}` },
      { label: "Référence obligatoire",value: bd.reference, highlight: true },
    ];
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10 mx-auto">
            <Building2 className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-xl font-bold text-center">Virement bancaire</h2>
          <p className="text-gray-400 text-sm text-center">{result.message}</p>
          <div className="bg-gray-800 rounded-xl divide-y divide-gray-700">
            {fields.map((f) => (
              <div key={f.label} className="flex justify-between items-center px-4 py-3 text-sm">
                <span className="text-gray-400 shrink-0 mr-2">{f.label}</span>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-xs text-right ${f.highlight ? "text-yellow-300 font-bold" : "text-white"}`}>
                    {f.value}
                  </span>
                  {f.value && (
                    <button onClick={() => copyText(f.value)} className="text-gray-500 hover:text-white transition">
                      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg p-3">
            Mentionnez impérativement la référence <strong>{bd.reference}</strong> dans le libellé du virement.
          </p>
          <Button className="w-full" onClick={() => navigate("/dashboard")}>Retour au dashboard</Button>
        </div>
      </div>
    );
  }

  // ── FORMULAIRE ────────────────────────────────────────────────────────────
  const isNotchPay = config.active_provider === "notchpay";
  const fees = isMobileMoney ? calcFees(amount, config.operator_fee_rate, config.kobo_fee_rate, isNotchPay) : null;

  if (serviceStatus && !serviceStatus.deposits_enabled) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold">Déposer des fonds</h1>
          </div>
          <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto bg-orange-500/20">
              <AlertTriangle size={28} className="text-orange-400" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-orange-400">Dépôts temporairement indisponibles</h2>
              <p className="text-sm text-orange-300/80 mt-2">
                {serviceStatus.deposits_message || "Les dépôts sont temporairement indisponibles. Nous travaillons à résoudre le problème au plus vite."}
              </p>
            </div>
            <p className="text-xs text-gray-500">Vos fonds sont en sécurité. Réessayez dans quelques instants.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Déposer des fonds</h1>
        </div>

        {/* Tabs devise */}
        <div className="flex gap-2 bg-gray-900 p-1 rounded-xl">
          {["FCFA", "EUR", "USD"].map((c) => (
            <button
              key={c}
              onClick={() => { setCurrency(c); setResult(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                currency === c ? "bg-white text-black shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Badge type */}
        <div className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${
          isMobileMoney ? "bg-yellow-400/10 text-yellow-400" : "bg-blue-500/10 text-blue-400"
        }`}>
          {isMobileMoney ? <Smartphone className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
          {isMobileMoney ? "Mobile Money (MTN / Orange)" : "Virement bancaire (SEPA)"}
        </div>

        {/* Montant */}
        <div className="space-y-2">
          <label className="text-sm text-gray-400">Montant ({currency})</label>
          <div className="relative">
            <Input
              type="text"
              inputMode="numeric"
              placeholder={isMobileMoney ? "Ex: 5 000" : "Ex: 50"}
              value={formatAmount(amount)}
              onChange={handleAmountChange}
              className="bg-gray-900 border-gray-700 text-white text-lg pr-16"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{currency}</span>
          </div>
          {isMobileMoney && <p className="text-xs text-gray-500">Minimum 100 FCFA</p>}
        </div>

        {/* ── MOBILE MONEY ── */}
        {isMobileMoney && (
          <>
            {/* Info redirection */}
            <div className="flex items-start gap-2 rounded-xl bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
              <ExternalLink className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Vous serez redirigé vers une <strong>{paymentPageLabel}</strong> pour saisir votre numéro et finaliser le dépôt.
              </span>
            </div>

            {/* Récap frais */}
            {fees && (
              <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/10 text-sm overflow-hidden">
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-gray-400">Vous déposez</span>
                  <span className="text-white font-medium">{fees.gross.toLocaleString("fr-FR")} FCFA</span>
                </div>
                {fees.opFee > 0 && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-gray-400">
                      Frais de traitement Mobile Money ({config.operator_fee_rate}%)
                      {isNotchPay && <span className="text-gray-500 ml-1 text-xs">(débités en +)</span>}
                      {!configLoaded && <span className="text-gray-600 ml-1">…</span>}
                    </span>
                    <span className="text-orange-400 font-medium">
                      {isNotchPay ? "+" : "−"}{fees.opFee.toLocaleString("fr-FR")} FCFA
                    </span>
                  </div>
                )}
                {fees.koboFee > 0 && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-gray-400">Frais Kobo ({config.kobo_fee_rate}%)</span>
                    <span className="text-orange-400 font-medium">−{fees.koboFee.toLocaleString("fr-FR")} FCFA</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-3 bg-white/5">
                  <span className="text-white font-semibold">Vous recevrez</span>
                  <span className="text-green-400 font-bold">{fees.net.toLocaleString("fr-FR")} FCFA</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── VIREMENT BANCAIRE ── */}
        {isBankTransfer && (
          <div className="space-y-4">
            <div className="bg-gray-900 rounded-xl p-4 text-sm text-gray-400 space-y-1">
              <p>Après validation, vous recevrez l'IBAN Kobo et une référence unique à mentionner dans le virement.</p>
              <p className="text-xs mt-1 text-gray-500">Crédit sous 1–3 jours ouvrés.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-gray-400">Votre nom (titulaire du compte expéditeur)</label>
              <Input placeholder="Prénom NOM" value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-gray-400">Votre IBAN expéditeur <span className="text-gray-500">(recommandé)</span></label>
              <Input placeholder="FR76 3000 6000 0112 3456 7890 189"
                value={senderIban}
                onChange={(e) => setSenderIban(e.target.value.toUpperCase())}
                className="bg-gray-900 border-gray-700 text-white font-mono text-sm" />
            </div>
          </div>
        )}

        <Button className="w-full py-3 text-base" onClick={handleSubmit} disabled={loading || !configLoaded}>
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Préparation…
            </span>
          ) : isMobileMoney
            ? "Continuer vers le paiement sécurisé →"
            : "Voir les instructions de virement"}
        </Button>
      </div>
    </div>
  );
}
