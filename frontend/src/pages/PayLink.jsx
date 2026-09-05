import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  AlertCircle, ArrowRight, Bitcoin, CheckCircle2, Clock,
  Copy, Loader2, Lock, Phone, RefreshCw, Shield,
  ShieldCheck, Smartphone, Wallet, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  getLinkPublic, getTxStatus, payLink,
  getLinkCryptoInfo, startWalletOtp, verifyWalletOtp, payWithWallet,
  submitCryptoTx, startCryptoPayment, getCryptoPaymentStatus,
} from "../api/paymentLinks";

function fmt(n) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(n));
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).then(() => toast.success("Copié !")).catch(() => {});
}

function GoogleField({
  label,
  optional,
  left,
  className = "",
  inputClassName = "",
  ...props
}) {
  return (
    <div className={`relative group ${className}`}>
      <label className="absolute -top-2 left-3 z-10 bg-white px-1 text-xs font-medium text-slate-600 group-focus-within:text-blue-600 transition-colors">
        {label}
        {optional && <span className="font-normal text-slate-400"> ({optional})</span>}
      </label>
      <div className="min-h-[56px] rounded-md border border-slate-300 bg-white flex items-center transition-colors group-focus-within:border-blue-600 group-focus-within:ring-1 group-focus-within:ring-blue-600">
        {left && (
          <>
            <div className="flex items-center gap-2 pl-4 pr-3 text-slate-700 shrink-0">
              {left}
            </div>
            <div className="h-6 w-px bg-slate-200" />
          </>
        )}
        <input
          {...props}
          className={`flex-1 h-14 min-w-0 px-3 bg-transparent text-slate-900 placeholder:text-slate-400 text-base outline-none ${inputClassName}`}
        />
      </div>
    </div>
  );
}

/* ── QR Code Canvas ──────────────────────────────────────────────────────── */
function QRCanvas({ value, size = 180 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !value) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size, margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  }, [value, size]);
  return <canvas ref={canvasRef} style={{ borderRadius: 12 }} />;
}

/* ── États plein écran ───────────────────────────────────────────────────── */
function StatusScreen({ icon: Icon, iconBg, iconColor, title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PageHeader />
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm text-center">
          <div className={`inline-flex w-16 h-16 rounded-2xl ${iconBg} items-center justify-center mb-5 shadow-sm`}>
            <Icon className={`w-7 h-7 ${iconColor}`} />
          </div>
          <h2 className="text-slate-900 font-bold text-xl mb-2">{title}</h2>
          {subtitle && <p className="text-slate-700 text-sm leading-relaxed max-w-xs mx-auto">{subtitle}</p>}
          {children}
        </div>
      </div>
      <PageFooter />
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */
function PageHeader() {
  return (
    <header className="w-full bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-extrabold text-sm">K</span>
          </div>
          <span className="font-bold text-slate-900 text-sm">Kobo</span>
          <span className="hidden sm:inline text-slate-600 text-xs font-medium ml-1">· Paiement marchand</span>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md px-3 py-1">
          <Lock className="w-3 h-3 text-slate-600" />
          <span className="text-[11px] text-slate-700 font-medium">Paiement sécurisé</span>
        </div>
      </div>
    </header>
  );
}

/* ── Footer ─────────────────────────────────────────────────────────────── */
function PageFooter() {
  return (
    <footer className="w-full bg-slate-50 py-4">
      <div className="max-w-5xl mx-auto px-5 flex items-center justify-center gap-2 text-slate-500 text-[11px]">
        <Lock className="w-3.5 h-3.5" />
        <span>Paiement sécurisé par Kobo</span>
      </div>
    </footer>
  );
}

function MerchantAvatar({ link, size = "lg" }) {
  const cls = size === "lg" ? "h-16 w-16 text-xl rounded-2xl" : "h-10 w-10 text-sm rounded-xl";
  const name = link?.creator_name || "Kobo";
  if (link?.creator_avatar_url) {
    return (
      <img
        src={link.creator_avatar_url}
        alt={name}
        className={`${cls} object-cover border border-slate-200 bg-slate-100 shadow-sm`}
      />
    );
  }
  return (
    <div className={`${cls} bg-blue-600 text-white flex items-center justify-center font-black shadow-sm`}>
      {name.trim().slice(0, 1).toUpperCase()}
    </div>
  );
}

/* ── Onglets méthode de paiement ─────────────────────────────────────────── */
const METHODS = [
  { id: "momo",   icon: Smartphone, label: "Mobile Money",  sub: "MTN MoMo · Orange Money" },
  { id: "wallet", icon: Wallet,     label: "Kobo Wallet",   sub: "Solde Kobo" },
  { id: "crypto", icon: Bitcoin,    label: "Crypto",         sub: "USDT TRC20" },
];

function MethodTabs({ active, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-xl">
      {METHODS.map(({ id, icon: Icon, label, sub }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg text-center transition-all duration-150 ${
            active === id
              ? "bg-white shadow-sm text-blue-700"
              : "text-slate-700 hover:text-slate-700"
          }`}
        >
          <Icon className={`w-4 h-4 ${active === id ? "text-blue-600" : "text-slate-600"}`} />
          <span className="font-semibold text-xs leading-tight">{label}</span>
          <span className={`text-[10px] leading-tight ${active === id ? "text-blue-600" : "text-slate-600"}`}>{sub}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Section Mobile Money ────────────────────────────────────────────────── */
function MomoSection({ link, linkId, onSuccess }) {
  const [operator, setOp] = useState(null);
  const [phone, setPhone]  = useState("");
  const [paying, setPaying] = useState(false);

  const OPS = [
    { id: "mtn", logo: "/brands/mtn-momo.svg", label: "MTN MoMo", sub: "Mobile Money MTN Cameroun" },
    { id: "orange", logo: "/brands/orange-money.svg", label: "Orange Money", sub: "Paiement Orange Money Cameroun" },
  ];

  const handlePay = async () => {
    if (!operator) { toast.error("Sélectionnez un opérateur."); return; }
    setPaying(true);
    try {
      const res = await payLink(linkId, { phone: phone.trim() || undefined, provider: operator });
      if (res.authorization_url) { window.location.href = res.authorization_url; return; }
      onSuccess("pending_ussd");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erreur de paiement. Réessayez.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Choisir l'opérateur</p>
          <span className="text-[11px] text-slate-500">Cameroun</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {OPS.map((op) => (
            <button
              key={op.id}
              onClick={() => setOp(op.id)}
              className={`w-full flex flex-col items-start gap-3 p-4 rounded-xl border text-left transition-all
                ${operator === op.id ? "border-blue-600 bg-blue-50 shadow-sm ring-1 ring-blue-600/10" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
            >
              <div className="w-full flex items-center justify-between gap-3">
                <img src={op.logo} alt={op.label} className="h-10 max-w-[132px] object-contain" />
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0
                  ${operator === op.id ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"}`}>
                  {operator === op.id && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </div>
              <div>
                <p className={`font-semibold text-sm ${operator === op.id ? "text-blue-800" : "text-slate-900"}`}>{op.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{op.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <GoogleField
          label="Numero Mobile Money"
          optional="optionnel"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="6XX XXX XXX"
          left={<><Phone className="w-4 h-4 text-slate-500 group-focus-within:text-blue-600 transition-colors" /><span className="text-sm font-medium">+237</span></>}
        />
        <p className="mt-1.5 text-[11px] text-slate-500">Laissez vide si le numéro du paiement sera saisi chez l'opérateur.</p>
      </div>

      <PayButton onClick={handlePay} loading={paying} disabled={!operator} amount={link.amount} />
      {operator && !paying && (
        <p className="text-center text-xs text-slate-600">
          Vous recevrez une demande de confirmation sur votre téléphone.
        </p>
      )}
    </div>
  );
}

/* ── Section Kobo Wallet ─────────────────────────────────────────────────── */
function WalletSection({ link, linkId, onSuccess }) {
  const [step, setStep]               = useState("ident"); // ident | otp | confirm
  const [identifier, setIdentifier]   = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp]                 = useState("");
  const [payToken, setPayToken]       = useState("");
  const [balance, setBalance]         = useState(0);
  const [name, setName]               = useState("");
  const [loading, setLoading]         = useState(false);

  const handleSendOtp = async () => {
    if (!identifier.trim()) { toast.error("Entrez votre numéro ou email Kobo."); return; }
    setLoading(true);
    try {
      const res = await startWalletOtp(linkId, identifier.trim());
      setChallengeId(res.challenge_id);
      setStep("otp");
      toast.success("Code envoyé !");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Identifiant introuvable.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { toast.error("Entrez le code à 6 chiffres."); return; }
    setLoading(true);
    try {
      const res = await verifyWalletOtp(linkId, { challenge_id: challengeId, code: otp });
      setPayToken(res.payment_token);
      setBalance(res.balance_fcfa);
      setName(res.display_name);
      setStep("confirm");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Code incorrect.");
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async () => {
    setLoading(true);
    try {
      await payWithWallet(linkId, payToken);
      onSuccess("wallet_confirmed");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Erreur de paiement.");
    } finally {
      setLoading(false);
    }
  };

  const enough = balance >= link.amount;

  return (
    <div className="space-y-5">
      {/* Step 1 — Identification */}
      {step === "ident" && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-3 items-start">
            <Wallet className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-blue-900 text-xs leading-relaxed font-medium">
              Entrez l'email de votre compte Kobo — vous recevrez un code de confirmation par mail.
            </p>
          </div>
          <GoogleField
            label="Email Kobo"
            type="email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
            placeholder="votre@email.com"
            inputClassName="font-medium"
          />
          <button
            onClick={handleSendOtp} disabled={loading}
            className="w-full h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200
              disabled:text-slate-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Recevoir le code <ArrowRight className="w-4 h-4" /></>}
          </button>
        </>
      )}

      {/* Step 2 — OTP */}
      {step === "otp" && (
        <>
          <div className="text-center py-2">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
              <Smartphone className="w-5 h-5 text-blue-600" />
            </div>
            <p className="font-semibold text-slate-900 text-sm">Code envoyé</p>
            <p className="text-slate-600 text-xs mt-1">
              Entrez le code à 6 chiffres reçu sur <strong>{identifier}</strong>
            </p>
          </div>
          <GoogleField
            label="Code de verification"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
            placeholder="000000"
            inputClassName="text-center text-2xl font-bold tracking-[0.35em] placeholder:text-slate-300"
          />
          <div className="flex gap-3">
            <button onClick={() => { setStep("ident"); setOtp(""); }}
              className="flex-1 h-12 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all">
              Retour
            </button>
            <button onClick={handleVerifyOtp} disabled={loading || otp.length !== 6}
              className="flex-1 h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-600
                text-white font-bold text-sm flex items-center justify-center gap-2 transition-all">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Vérifier"}
            </button>
          </div>
        </>
      )}

      {/* Step 3 — Confirmation */}
      {step === "confirm" && (
        <>
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
                {(name || "?")[0].toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{name}</p>
                <p className="text-xs text-slate-600">Votre compte Kobo</p>
              </div>
            </div>
            <div className="border-t border-slate-200 pt-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">Solde disponible</span>
                <span className={`font-bold ${enough ? "text-emerald-600" : "text-red-500"}`}>
                  {fmt(balance)} FCFA
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">À payer</span>
                <span className="font-bold text-slate-900">{fmt(link.amount)} FCFA</span>
              </div>
              {enough && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-700">Après paiement</span>
                  <span className="font-medium text-slate-600">{fmt(balance - link.amount)} FCFA</span>
                </div>
              )}
            </div>
          </div>

          {!enough && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-red-600 text-xs font-medium flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              Solde insuffisant. Rechargez votre compte Kobo d'abord.
            </div>
          )}

          {enough && (
            <button onClick={handlePay} disabled={loading}
              className="w-full h-[52px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all
                disabled:bg-slate-200 disabled:text-slate-600"
              style={{ background: loading ? undefined : "linear-gradient(135deg,#2563eb,#1d4ed8)", color: loading ? undefined : "white", boxShadow: loading ? undefined : "0 4px 14px rgba(37,99,235,.35)" }}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Lock className="w-4 h-4" /> Payer {fmt(link.amount)} FCFA <ArrowRight className="w-4 h-4" /></>}
            </button>
          )}
          <button onClick={() => setStep("ident")} className="w-full text-center text-xs text-slate-600 hover:text-slate-600 transition-colors">
            Changer de compte
          </button>
        </>
      )}
    </div>
  );
}

/* ── Section Crypto ──────────────────────────────────────────────────────── */
function CryptoSection({ link, linkId }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [txHash, setTxHash] = useState("");
  const [submitting, setSubmit] = useState(false);
  const [result, setResult] = useState(null);
  const [step, setStep] = useState(1);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      try {
        const base = await getLinkCryptoInfo(linkId);
        const started = await startCryptoPayment(linkId);
        if (!cancelled) setInfo({ ...base, ...started });
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    boot();
    return () => { cancelled = true; };
  }, [linkId]);

  useEffect(() => {
    if (!info?.tx_id || result?.status === "confirmed") return;
    let active = true;
    let attempts = 0;
    const poll = async () => {
      try {
        const res = await getCryptoPaymentStatus(linkId, info.tx_id);
        if (!active) return;
        if (res.status === "completed") {
          setResult({ status: "confirmed", message: "Paiement détecté sur la blockchain et crédité au bénéficiaire.", ...res });
          setPolling(false);
          return;
        }
        if (res.status === "pending" && res.tx_hash) {
          setResult({ status: "pending", message: "Transaction trouvée. Kobo attend les confirmations blockchain ou une revue admin.", ...res });
        }
      } catch {}
      attempts += 1;
      if (attempts > 120) setPolling(false);
    };
    setPolling(true);
    poll();
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [info?.tx_id, linkId, result?.status]);

  const handleSubmit = async () => {
    if (txHash.trim().length < 10) return;
    setSubmit(true);
    try {
      const res = await submitCryptoTx(linkId, txHash.trim());
      setResult(res);
      if (res.status === "confirmed") toast.success("Paiement crypto confirmé");
    } catch (e) {
      const msg = e.response?.data?.detail || "Erreur lors de la vérification.";
      toast.error(msg);
    } finally {
      setSubmit(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
    </div>
  );

  if (!info) return (
    <div className="text-center py-6 text-slate-600 text-sm font-medium">
      Paiement crypto temporairement indisponible.
    </div>
  );

  const confirmed = result?.status === "confirmed" || result?.status === "completed";
  const pending = result?.status === "pending" || info.status === "pending";
  const steps = [
    { id: 1, title: "Montant", desc: "Montant exact et réseau." },
    { id: 2, title: "Envoyer", desc: "QR code et adresse Kobo." },
    { id: 3, title: "Suivi", desc: "Détection automatique." },
  ];
  const canSubmit = txHash.trim().length >= 10 && !submitting;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {steps.map((s) => {
          const active = step === s.id;
          const done = step > s.id || confirmed;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                active ? "border-blue-500 bg-blue-50" : done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
              }`}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                done ? "bg-emerald-600 text-white" : active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
              }`}>
                {done ? <CheckCircle2 className="h-3 w-3" /> : s.id}
              </span>
              <span className="block mt-1 text-xs font-bold text-slate-900">{s.title}</span>
              <span className="hidden sm:block text-[11px] leading-snug text-slate-600">{s.desc}</span>
            </button>
          );
        })}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">À envoyer depuis votre wallet</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-extrabold text-slate-900">{info.usdt_amount}</span>
              <span className="text-sm font-bold text-slate-700 pb-1">USDT</span>
              <span className="ml-auto text-xs text-slate-600 font-medium pb-1">≈ {fmt(info.fcfa_amount)} FCFA</span>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <span className="text-xs font-semibold text-slate-700">Réseau obligatoire</span>
              <span className="text-xs font-bold text-blue-700">TRON TRC20</span>
            </div>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              Envoyez exactement ce montant en USDT TRC20. Après l'envoi, Kobo détecte automatiquement la transaction sur TronScan et finalise le paiement.
            </p>
            <p className="mt-2 text-[11px] text-slate-500 font-mono">Référence Kobo : {info.reference}</p>
          </div>
          <button type="button" onClick={() => setStep(2)} className="w-full h-[48px] rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2">
            Continuer <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Scanner avec votre wallet crypto</p>
            <div className="p-3 bg-white rounded-2xl border border-slate-200">
              <QRCanvas value={info.address} size={176} />
            </div>
            <p className="text-xs text-slate-600 font-semibold">Wallet compatible USDT TRC20</p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">Adresse Kobo USDT TRC20</p>
            <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-2.5">
              <span className="flex-1 font-mono text-xs text-slate-800 font-semibold break-all select-all">{info.address}</span>
              <button onClick={() => copyToClipboard(info.address)} className="shrink-0 p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                <Copy className="w-3.5 h-3.5 text-slate-600" />
              </button>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-xs leading-relaxed font-medium">
            N'utilisez pas ERC20, BEP20 ou TRX. Un mauvais réseau peut rendre les fonds irrécupérables.
          </div>
          <button type="button" onClick={() => setStep(3)} className="w-full h-[48px] rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2">
            Démarrer le suivi automatique <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className={`rounded-2xl overflow-hidden border ${confirmed ? "border-emerald-200" : pending ? "border-amber-200" : "border-blue-200"}`}>
            <div className={`px-5 py-5 text-center ${confirmed ? "bg-emerald-50" : pending ? "bg-amber-50" : "bg-blue-50"}`}>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${confirmed ? "bg-emerald-100" : pending ? "bg-amber-100" : "bg-blue-100"}`}>
                {confirmed ? <CheckCircle2 className="w-7 h-7 text-emerald-600" /> : polling ? <Loader2 className="w-7 h-7 text-blue-600 animate-spin" /> : <Clock className="w-7 h-7 text-amber-600" />}
              </div>
              <p className={`font-bold text-base ${confirmed ? "text-emerald-800" : pending ? "text-amber-800" : "text-blue-800"}`}>
                {confirmed ? "Paiement confirmé" : polling ? "Recherche du paiement" : "En attente blockchain"}
              </p>
              <p className={`text-sm mt-1 leading-relaxed ${confirmed ? "text-emerald-700" : pending ? "text-amber-700" : "text-blue-700"}`}>
                {result?.message || info.message || "Kobo vérifie automatiquement les transferts USDT TRC20 reçus sur l'adresse affichée."}
              </p>
            </div>
            <div className="bg-white px-5 py-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">Référence</span><span className="font-mono font-semibold text-slate-900">{info.reference}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Montant attendu</span><span className="font-bold text-slate-900">{info.usdt_amount} USDT</span></div>
              {result?.explorer_url && <a href={result.explorer_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">Voir sur TronScan →</a>}
            </div>
          </div>

          {!confirmed && (
            <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <summary className="cursor-pointer text-sm font-bold text-slate-900">
                Paiement non détecté ? Ajouter le hash en secours
              </summary>
              <div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Le hash n'est pas l'étape normale. Collez-le seulement si le paiement tarde à apparaître dans la détection automatique.
                </p>
              </div>
              <GoogleField
                label="Hash TronScan"
                optional="secours"
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="Collez le hash si nécessaire"
                inputClassName="font-mono text-sm font-semibold"
              />
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full h-[48px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:bg-slate-200 disabled:text-slate-600 bg-blue-600 text-white"
              >
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Vérification...</> : <><ShieldCheck className="w-4 h-4" /> Vérifier en secours</>}
              </button>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Bouton payer générique ──────────────────────────────────────────────── */
function PayButton({ onClick, loading, disabled, amount }) {
  const inactive = loading || disabled;
  return (
    <button type="button" onClick={onClick} disabled={inactive}
      className="w-full h-[52px] rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all
        active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      style={{
        background: inactive ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#1d4ed8)",
        color: inactive ? "#94a3b8" : "white",
        boxShadow: inactive ? "none" : "0 4px 14px rgba(37,99,235,.35)",
      }}>
      {loading
        ? <><Loader2 className="w-4 h-4 animate-spin" /> En cours…</>
        : <><Lock className="w-4 h-4" /> Payer {fmt(amount)} FCFA <ArrowRight className="w-4 h-4" /></>}
    </button>
  );
}

/* ── Page principale ─────────────────────────────────────────────────────── */
export default function PayLink() {
  const { linkId } = useParams();
  const [searchParams] = useSearchParams();
  const returnStatus = searchParams.get("status");
  const returnRef    = searchParams.get("ref");

  const [link, setLink]         = useState(null);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [method, setMethod]     = useState("momo");
  const [payState, setPayState] = useState(
    returnStatus === "success" && returnRef ? "verifying" : "idle"
  );
  const pollRef = useRef(null);

  useEffect(() => {
    getLinkPublic(linkId)
      .then(setLink)
      .catch((e) => setError(e.response?.data?.detail || "Lien introuvable ou expiré"))
      .finally(() => setLoading(false));
  }, [linkId]);

  useEffect(() => {
    if (payState !== "verifying" || !returnRef) return;
    let attempts = 0;
    const poll = async () => {
      try {
        const res = await getTxStatus(returnRef);
        if (res.status === "completed") { clearInterval(pollRef.current); setPayState("confirmed"); return; }
        if (res.status === "failed")    { clearInterval(pollRef.current); setPayState("idle"); toast.error("Le paiement a échoué. Réessayez."); return; }
      } catch {}
      if (++attempts >= 20) { clearInterval(pollRef.current); setPayState("timeout"); }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [payState, returnRef]);

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PageHeader />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
          <p className="text-sm text-slate-600">Chargement…</p>
        </div>
      </div>
      <PageFooter />
    </div>
  );

  if (error) return (
    <StatusScreen icon={AlertCircle} iconBg="bg-red-50" iconColor="text-red-500"
      title="Lien invalide" subtitle={error} />
  );

  if (payState === "verifying") return (
    <StatusScreen icon={Loader2} iconBg="bg-blue-50" iconColor="text-blue-600 animate-spin"
      title="Vérification en cours…" subtitle="Votre paiement est en cours de confirmation." />
  );

  if (payState === "confirmed" || payState === "wallet_confirmed") return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PageHeader />
      <style>{`
        @keyframes pop-in {
          0%   { transform: scale(0.4); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); }
        }
        @keyframes slide-up {
          from { transform: translateY(24px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes confetti-fall {
          0%   { transform: translateY(-10px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(60px)  rotate(360deg); opacity: 0; }
        }
        .pop-in     { animation: pop-in  0.45s cubic-bezier(.34,1.56,.64,1) forwards; }
        .slide-up-1 { animation: slide-up 0.4s 0.3s ease both; }
        .slide-up-2 { animation: slide-up 0.4s 0.45s ease both; }
        .slide-up-3 { animation: slide-up 0.4s 0.6s ease both; }
        .confetti-1 { animation: confetti-fall 1.2s 0.1s ease-in both; }
        .confetti-2 { animation: confetti-fall 1.4s 0.2s ease-in both; }
        .confetti-3 { animation: confetti-fall 1.0s 0.3s ease-in both; }
        .confetti-4 { animation: confetti-fall 1.3s 0.05s ease-in both; }
        .confetti-5 { animation: confetti-fall 1.1s 0.25s ease-in both; }
        .confetti-6 { animation: confetti-fall 1.5s 0.15s ease-in both; }
      `}</style>
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden text-center">
            {/* Header animé */}
            <div className="relative bg-gradient-to-br from-emerald-500 to-emerald-600 px-6 py-10 overflow-hidden">
              {/* Confettis */}
              <span className="confetti-1 absolute top-2 left-8  w-2 h-2 rounded-full bg-yellow-300 block" />
              <span className="confetti-2 absolute top-2 left-16 w-1.5 h-1.5 rounded-sm  bg-white/70 block" />
              <span className="confetti-3 absolute top-2 right-8  w-2 h-2 rounded-full bg-blue-200 block" />
              <span className="confetti-4 absolute top-2 right-16 w-1.5 h-1.5 rounded-sm  bg-yellow-200 block" />
              <span className="confetti-5 absolute top-2 left-1/3 w-2 h-2 rounded-full bg-pink-200 block" />
              <span className="confetti-6 absolute top-2 right-1/3 w-1.5 h-1.5 rounded-sm bg-white/60 block" />

              <div className="pop-in w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <CheckCircle2 className="w-10 h-10 text-white drop-shadow" />
              </div>
              <p className="slide-up-1 text-emerald-100 text-sm font-medium mb-1">Paiement confirmé</p>
              <p className="slide-up-2 text-white font-bold text-3xl tracking-tight">{fmt(link?.amount ?? 0)} FCFA</p>
            </div>

            {/* Corps */}
            <div className="px-6 py-5 space-y-4">
              <p className="slide-up-2 text-slate-700 text-sm">
                <span className="font-semibold text-slate-900">{link?.creator_name}</span> a bien reçu votre paiement.
              </p>
              <div className="slide-up-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-700 font-medium">
                Transaction enregistrée avec succès.
              </div>

              {/* CTA : payer à nouveau */}
              <button
                onClick={() => setPayState("idle")}
                className="slide-up-3 w-full h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Effectuer un autre paiement
              </button>
            </div>
          </div>
        </div>
      </div>
      <PageFooter />
    </div>
  );

  if (payState === "pending_ussd") return (
    <StatusScreen icon={Smartphone} iconBg="bg-blue-50" iconColor="text-blue-600"
      title="Confirmez sur votre téléphone"
      subtitle="Un message Mobile Money a été envoyé. Saisissez votre code PIN pour valider.">
      <div className="mt-6 flex items-center gap-2 justify-center bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
        <Clock className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-amber-700 text-xs font-medium">En attente de votre confirmation…</span>
      </div>
    </StatusScreen>
  );

  if (payState === "timeout") return (
    <StatusScreen icon={Clock} iconBg="bg-amber-50" iconColor="text-amber-500"
      title="Traitement en cours"
      subtitle="Votre paiement est en cours. Si le montant a été débité, il sera crédité automatiquement." />
  );

  if (returnStatus === "cancelled") return (
    <StatusScreen icon={XCircle} iconBg="bg-red-50" iconColor="text-red-500"
      title="Paiement annulé" subtitle="Vous avez annulé. Vous pouvez relancer à tout moment.">
      <button onClick={() => window.location.href = `/pay/${linkId}`}
        className="mt-6 inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold transition-colors">
        <RefreshCw className="w-4 h-4" /> Réessayer
      </button>
    </StatusScreen>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PageHeader />

      <div className="flex-1 flex items-start justify-center px-4 py-6 lg:py-8">
        <div className="w-full max-w-3xl">
          <div className="grid gap-4">

            {/* ── Colonne gauche : résumé ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5">
              <div className="flex items-center gap-4">
                <MerchantAvatar link={link} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">Vous payez</p>
                  <h1 className="text-slate-950 font-bold text-lg truncate">{link.creator_name}</h1>
                  <p className="text-sm text-slate-600 truncate">{link.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-black text-slate-950 tabular-nums">{fmt(link.amount)}</p>
                  <p className="text-xs font-semibold text-slate-500">{link.currency}</p>
                </div>
              </div>
            </div>

            {/* ── Colonne droite : formulaire ── */}
            <div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">

                <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-slate-900 text-base">Mode de paiement</h2>
                    <p className="text-slate-500 text-xs mt-0.5">Choisissez une option</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(`https://koboonline.com/pay/${linkId}`)}
                    className="h-8 px-2.5 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5" /> Lien
                  </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                  <MethodTabs active={method} onChange={setMethod} />

                  <div className="border-t border-slate-100 pt-5">
                    {method === "momo" && (
                      <MomoSection link={link} linkId={linkId} onSuccess={setPayState} />
                    )}
                    {method === "wallet" && (
                      <WalletSection link={link} linkId={linkId} onSuccess={setPayState} />
                    )}
                    {method === "crypto" && (
                      <CryptoSection link={link} linkId={linkId} />
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
                <div className="shrink-0">
                  <QRCanvas value={`https://koboonline.com/pay/${linkId}`} size={76} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">QR code du paiement</p>
                  <p className="text-xs text-slate-500 mt-0.5">Scannez ou partagez ce lien pour payer depuis un autre appareil.</p>
                  <button
                    onClick={() => copyToClipboard(`https://koboonline.com/pay/${linkId}`)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700">
                    <Copy className="w-3.5 h-3.5" /> Copier le lien
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <PageFooter />
    </div>
  );
}
