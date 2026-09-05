import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Check, ExternalLink, ArrowLeft, Bitcoin, HelpCircle, ShieldCheck, Clock, AlertCircle, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { initCryptoDeposit, submitTxHash, getAvailableWallets, getCryptoDeposit } from "../api/crypto";

const STEPS = ["amount", "send", "confirm", "done"];

export default function CryptoDeposit() {
  const navigate = useNavigate();
  const [step, setStep] = useState("amount");
  const [amountXaf, setAmountXaf] = useState("");
  const [displayAmount, setDisplayAmount] = useState("");
  const [deposit, setDeposit] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // {status, message, confirmations, explorer_url}
  const [copied, setCopied] = useState(false);
  const [wallets, setWallets] = useState([]);
  const [selectedNetwork, setSelectedNetwork] = useState("TRC20");
  const [walletsLoading, setWalletsLoading] = useState(true);

  useEffect(() => {
    getAvailableWallets()
      .then((items) => {
        setWallets(items);
        if (items.length > 0) setSelectedNetwork(items[0].network);
      })
      .catch(() => {
        // Fallback si l'API échoue
        setWallets([{ network: "TRC20", label: "USDT TRC20", address: "" }]);
      })
      .finally(() => setWalletsLoading(false));
  }, []);

  useEffect(() => {
    if (!deposit?.deposit_id || step === "amount" || step === "done") return;
    let active = true;
    const poll = async () => {
      try {
        const status = await getCryptoDeposit(deposit.deposit_id);
        if (!active) return;
        if (["auto_confirmed", "confirmed"].includes(status.status)) {
          setVerifyResult({
            status: "auto_confirmed",
            message: "Paiement détecté sur la blockchain et crédité automatiquement.",
            explorer_url: status.explorer_url,
          });
          setStep("done");
        }
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [deposit?.deposit_id, step]);

  const handleAmountChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "");
    setAmountXaf(raw);
    setDisplayAmount(raw ? parseInt(raw, 10).toLocaleString("fr-FR") : "");
  };

  const handleCopy = (text) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    toast.success("Copié !");
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInitDeposit = async () => {
    const amount = parseFloat(amountXaf);
    if (!amount || amount < 100) {
      toast.error("Montant minimum : 100 FCFA");
      return;
    }
    setLoading(true);
    try {
      const data = await initCryptoDeposit(amount, selectedNetwork);
      setDeposit(data);
      setStep("send");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Erreur lors de l'initialisation";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitHash = async () => {
    if (!txHash || txHash.length < 10) {
      toast.error("Hash de transaction invalide");
      return;
    }
    setLoading(true);
    setVerifyResult(null);
    try {
      const res = await submitTxHash(deposit.deposit_id, txHash.trim());
      setVerifyResult(res);
      setStep("done");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Erreur lors de la soumission";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const selectedWallet = wallets.find((w) => w.network === selectedNetwork);

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => step === "amount" ? navigate("/wallet") : setStep(STEPS[STEPS.indexOf(step) - 1])}
          className="p-2 rounded-full hover:bg-secondary transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="font-display text-xl font-bold">Dépôt Crypto</h1>
          <p className="text-xs text-muted-foreground">
            {selectedWallet?.label || selectedNetwork} · USDT
          </p>
        </div>
        <button
          onClick={() => navigate("/crypto-help")}
          className="p-2 rounded-full hover:bg-secondary transition-colors text-muted-foreground"
          title="Aide"
        >
          <HelpCircle size={18} />
        </button>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {[
          { key: "amount", label: "Montant" },
          { key: "send", label: "Envoyer" },
          { key: "confirm", label: "Auto" },
          { key: "done", label: "Terminé" },
        ].map((s, i) => {
          const idx = STEPS.indexOf(step);
          const sIdx = STEPS.indexOf(s.key);
          return (
            <React.Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  sIdx < idx ? "bg-success text-white" :
                  sIdx === idx ? "bg-primary text-primary-foreground" :
                  "bg-secondary text-muted-foreground"
                }`}>
                  {sIdx < idx ? <Check size={14} /> : i + 1}
                </div>
                <span className="text-[10px] text-muted-foreground hidden sm:block">{s.label}</span>
              </div>
              {i < 3 && <div className={`flex-1 h-0.5 mb-4 ${sIdx < idx ? "bg-success" : "bg-secondary"}`} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Step 1 — Montant + Réseau */}
      {step === "amount" && (
        <div className="rounded-xl bg-surface border border-border p-6 space-y-5">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
            <Bitcoin size={20} className="text-amber-500 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Paiement en <strong>USDT</strong> — Kobo surveille la blockchain et crédite après confirmations.
            </p>
          </div>

          {/* Sélection réseau */}
          {walletsLoading ? (
            <div className="text-sm text-muted-foreground text-center py-2">Chargement des réseaux...</div>
          ) : wallets.length > 1 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Réseau</label>
              <div className="grid grid-cols-3 gap-2">
                {wallets.map((w) => (
                  <button
                    key={w.network}
                    type="button"
                    onClick={() => setSelectedNetwork(w.network)}
                    className={`p-2.5 rounded-md border text-sm font-medium transition-base ${
                      selectedNetwork === w.network
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {w.label || w.network}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Montant à créditer (FCFA)</label>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="Ex: 5 000"
              value={displayAmount}
              onChange={handleAmountChange}
              className="text-lg font-mono"
            />
            {amountXaf && parseFloat(amountXaf) >= 100 && (
              <p className="text-xs text-muted-foreground">
                ≈ <strong>{(parseInt(amountXaf, 10) / 550).toFixed(2)} USDT</strong> (taux : 1 USDT = 550 FCFA)
              </p>
            )}
          </div>
          <Button
            onClick={handleInitDeposit}
            disabled={loading || !amountXaf || parseInt(amountXaf, 10) < 100}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {loading ? "Préparation..." : "Continuer"}
          </Button>
        </div>
      )}

      {/* Step 2 — Envoyer */}
      {step === "send" && deposit && (
        <div className="rounded-xl bg-surface border border-border p-6 space-y-5">
          <div className="text-center space-y-1">
            <p className="text-sm text-muted-foreground">Envoie exactement</p>
            <p className="font-display text-4xl font-bold text-primary tabular-nums">
              {deposit.amount_usdt} USDT
            </p>
            <p className="text-xs text-muted-foreground">≈ {deposit.amount_xaf?.toLocaleString()} FCFA · crédit automatique</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
              Adresse de dépôt · {deposit.network}
            </p>
            <button
              onClick={() => handleCopy(deposit.wallet_address)}
              className="w-full flex items-center justify-between gap-3 p-4 rounded-lg bg-secondary hover:bg-muted transition-colors border border-border"
            >
              <code className="text-sm font-mono truncate text-left">{deposit.wallet_address}</code>
              {copied ? <Check size={16} className="text-success shrink-0" /> : <Copy size={16} className="shrink-0 text-muted-foreground" />}
            </button>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
              <AlertTriangle size={11} className="shrink-0" /> Utilise uniquement le réseau {deposit.network}. Autre réseau = fonds perdus.
            </p>
          </div>

          <Button
            onClick={() => setStep("confirm")}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Démarrer le suivi automatique →
          </Button>
        </div>
      )}

      {/* Step 3 — Suivi automatique */}
      {step === "confirm" && deposit && (
        <div className="rounded-xl bg-surface border border-border p-6 space-y-5">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
            <Loader2 size={24} className="mx-auto text-blue-600 animate-spin" />
            <h2 className="font-semibold text-blue-950 mt-2">Détection automatique en cours</h2>
            <p className="text-sm text-blue-800 mt-1">
              Tu n'as rien d'autre à faire. Kobo surveille TronScan et créditera ton solde dès que le paiement USDT TRC20 est confirmé.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-secondary text-xs text-muted-foreground space-y-1">
            <p><strong>Dépôt ID :</strong> {deposit.deposit_id}</p>
            <p><strong>Montant attendu :</strong> {deposit.amount_usdt} USDT</p>
            <p><strong>Contrôle :</strong> adresse Kobo + montant exact + confirmations blockchain</p>
          </div>

          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              Paiement non détecté ? Ajouter le hash en secours
            </summary>
            <div className="mt-3 space-y-3">
              <Input
                placeholder="Hash TronScan"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Le hash n'est pas obligatoire. Il sert seulement si la détection automatique tarde.
              </p>
            </div>
          </details>

          <Button
            onClick={handleSubmitHash}
            disabled={loading || txHash.length < 10}
            variant="outline"
            className="w-full"
          >
            {loading ? "Vérification..." : "Vérifier ce hash"}
          </Button>
        </div>
      )}

      {/* Step 4 — Résultat vérification */}
      {step === "done" && (() => {
        const vStatus = verifyResult?.status;
        const isAutoConfirmed = vStatus === "auto_confirmed";
        const isVerified = vStatus === "hash_verified";
        const isManual = vStatus === "submitted" || !vStatus;

        const icon = isAutoConfirmed
          ? <ShieldCheck size={32} className="text-green-600" />
          : isVerified
            ? <Clock size={32} className="text-blue-500" />
            : <Check size={32} className="text-amber-500" />;

        const iconBg = isAutoConfirmed
          ? "bg-green-500/10"
          : isVerified ? "bg-blue-500/10" : "bg-amber-500/10";

        const title = isAutoConfirmed
          ? "Dépôt confirmé"
          : isVerified
            ? "Transaction vérifiée"
            : "Transaction soumise";

        const subtitle = isAutoConfirmed
          ? `Votre compte a été crédité de ${deposit?.amount_xaf?.toLocaleString() || ""} FCFA automatiquement.`
          : isVerified
            ? `Transaction valide (${verifyResult?.confirmations || 0}/20 confirmations). Crédit automatique dès confirmation complète.`
            : "La détection automatique continue. Un administrateur interviendra seulement si Kobo ne peut pas rapprocher le paiement.";

        return (
          <div className="rounded-xl bg-surface border border-border p-6 space-y-5 text-center">
            <div className={`w-16 h-16 rounded-full ${iconBg} flex items-center justify-center mx-auto`}>
              {icon}
            </div>
            <div>
              <h2 className="font-display text-xl font-bold">{title}</h2>
              <p className="text-sm text-muted-foreground mt-2">{subtitle}</p>
            </div>

            {/* Verification badge */}
            {isAutoConfirmed && (
              <div className="flex items-center gap-2 justify-center px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                <ShieldCheck size={14} className="text-green-600" />
                <span className="text-xs font-medium text-green-700 dark:text-green-400">
                  Vérifié automatiquement · {verifyResult?.confirmations} confirmations blockchain
                </span>
              </div>
            )}
            {isVerified && (
              <div className="flex items-center gap-2 justify-center px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Clock size={14} className="text-blue-500" />
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  Hash valide · en attente de {20 - (verifyResult?.confirmations || 0)} confirmations
                </span>
              </div>
            )}
            {isManual && (
              <div className="flex items-center gap-2 justify-center px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertCircle size={14} className="text-amber-600" />
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  En attente de vérification manuelle (réseau {deposit?.network})
                </span>
              </div>
            )}

            {deposit && (
              <div className="p-3 rounded-lg bg-secondary text-xs text-left space-y-1">
                <p><strong>Montant :</strong> {deposit.amount_usdt} USDT → {deposit.amount_xaf?.toLocaleString()} FCFA</p>
                {(verifyResult?.explorer_url || txHash) && (
                  <a
                    href={verifyResult?.explorer_url || `https://tronscan.org/#/transaction/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline inline-flex items-center gap-1 mt-1"
                  >
                    Voir sur l'explorateur <ExternalLink size={11} />
                  </a>
                )}
              </div>
            )}

            <Button
              onClick={() => navigate("/wallet")}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Retour au portefeuille
            </Button>
          </div>
        );
      })()}
    </div>
  );
}
