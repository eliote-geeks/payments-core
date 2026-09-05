import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, CheckCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { PinInput } from "../components/common/PinInput";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { useCurrencyInput } from "../hooks/useCurrencyInput";
import { api } from "../api/client";
import { getAvailableWallets } from "../api/crypto";

const RATE = 550;
const MIN_XAF = 5500;

async function initWithdrawal(amount_xaf, destination_address, network = "TRC20", note = "", pin = "") {
  const { data } = await api.post("/crypto/withdraw/init", { amount_xaf, destination_address, network, note, pin });
  return data;
}

export default function CryptoWithdraw() {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const { user } = useAuth();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("TRC20");
  const [wallets, setWallets] = useState([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [pinOpen, setPinOpen] = useState(false);
  const amountInput = useCurrencyInput("");

  const amountXaf = amountInput.numValue;
  const amountUsdt = amountXaf > 0 ? (amountXaf / RATE).toFixed(2) : "0.00";

  useEffect(() => {
    getAvailableWallets()
      .then((items) => {
        setWallets(items);
        if (items.length > 0) setNetwork(items[0].network);
      })
      .catch(() => {
        setWallets([
          { network: "TRC20", label: "TRC20 (TRON)" },
          { network: "BEP20", label: "BEP20 (BSC)" },
          { network: "ERC20", label: "ERC20 (Ethereum)" },
        ]);
      })
      .finally(() => setWalletsLoading(false));
  }, []);

  const handleNext = (e) => {
    e.preventDefault();
    if (amountXaf < MIN_XAF) {
      toast.error(`Montant minimum : ${MIN_XAF.toLocaleString("fr-FR")} FCFA (10 USDT)`);
      return;
    }
    if (!address || address.length < 20) {
      toast.error("Adresse de destination invalide");
      return;
    }
    if (!user?.hasPin) {
      toast.error("Définis d'abord ton code PIN dans Profil avant de faire un retrait.");
      return;
    }
    setStep(2);
  };

  const handleConfirm = async (pin) => {
    setLoading(true);
    try {
      const res = await initWithdrawal(amountXaf, address, network, "", pin);
      setResult(res);
      setStep(3);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Erreur lors du retrait";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const selectedWallet = wallets.find((w) => w.network === network);

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => (step > 1 && step < 3 ? setStep(step - 1) : navigate(-1))}
          className="h-9 w-9 rounded-full hover:bg-secondary flex items-center justify-center transition-base"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-display text-2xl font-bold">Retrait Crypto</h1>
        <button
          onClick={() => navigate("/crypto-help")}
          className="p-2 rounded-full hover:bg-secondary transition-colors text-muted-foreground ml-auto"
          title="Aide"
        >
          <HelpCircle size={18} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <React.Fragment key={s}>
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                s < step
                  ? "bg-primary text-white"
                  : s === step
                  ? "bg-primary text-white ring-4 ring-primary/20"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {s < step ? "✓" : s}
            </div>
            {s < 3 && <div className={`flex-1 h-0.5 ${s < step ? "bg-primary" : "bg-border"}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Form */}
      {step === 1 && (
        <form onSubmit={handleNext} className="space-y-5 slide-up-enter">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex gap-3">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Ton solde FCFA sera <strong>débité immédiatement</strong>. L'envoi des USDT sera effectué manuellement par l'équipe Kobo sous 24h.
            </p>
          </div>

          <div>
            <Label>Montant à retirer (FCFA)</Label>
            <Input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={amountInput.display}
              onChange={amountInput.onChange}
              className="mt-1.5 rounded-md text-lg font-semibold"
            />
            {amountXaf > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                ≈ <strong>{amountUsdt} USDT</strong> · Taux : 1 USDT = {RATE.toLocaleString("fr-FR")} FCFA
              </p>
            )}
          </div>

          <div>
            <Label>Réseau</Label>
            {walletsLoading ? (
              <div className="mt-1.5 text-sm text-muted-foreground">Chargement des réseaux...</div>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                {wallets.map((w) => (
                  <button
                    key={w.network}
                    type="button"
                    onClick={() => setNetwork(w.network)}
                    className={`p-2.5 rounded-md border text-sm font-medium transition-base ${
                      network === w.network
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {w.label || w.network}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Adresse {network} de destination</Label>
            <Input
              type="text"
              placeholder={network === "TRC20" ? "TXxxx..." : "0x..."}
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              className="mt-1.5 rounded-md font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <AlertTriangle size={11} className="shrink-0 text-amber-500" /> Vérifie l'adresse soigneusement — les transactions crypto sont irréversibles.
            </p>
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-primary hover:bg-primary/90 rounded-md"
            disabled={amountXaf < MIN_XAF || !address || walletsLoading}
          >
            Continuer <Send size={16} className="ml-1" />
          </Button>
        </form>
      )}

      {/* Step 2: Confirm */}
      {step === 2 && (
        <div className="space-y-5 slide-up-enter">
          <div className="bg-secondary rounded-xl p-5 space-y-4">
            <h3 className="font-display font-semibold text-lg">Récapitulatif</h3>
            <div className="space-y-3 divide-y divide-border">
              {[
                { label: "Tu envoies", value: `${amountInput.display} FCFA` },
                { label: "Tu reçois (environ)", value: `${amountUsdt} USDT` },
                { label: "Réseau", value: selectedWallet?.label || network },
                { label: "Adresse destination", value: address, mono: true },
                { label: "Délai", value: "< 24h (traitement manuel)" },
              ].map(({ label, value, mono }) => (
                <div key={label} className="flex justify-between items-start gap-4 pt-3 first:pt-0">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className={`text-sm font-medium text-right break-all ${mono ? "font-mono text-xs" : ""}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
            <p className="text-sm text-destructive font-medium">
              En confirmant, ton solde FCFA sera débité de{" "}
              <strong>{amountInput.display} FCFA</strong> immédiatement.
            </p>
          </div>

          <Button
            onClick={() => setPinOpen(true)}
            disabled={loading}
            className="w-full h-11 bg-primary hover:bg-primary/90 rounded-md"
          >
            {loading ? "Traitement..." : "Continuer avec le PIN"}
          </Button>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && result && (
        <div className="text-center space-y-6 slide-up-enter">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle size={44} className="text-primary" />
            </div>
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold">Retrait initié !</h2>
            <p className="text-muted-foreground mt-2">
              Ton solde a été débité. L'équipe Kobo va envoyer{" "}
              <strong>{result.amount_usdt} USDT</strong> sur ton adresse sous 24h.
            </p>
          </div>

          <div className="bg-secondary rounded-xl p-4 text-left space-y-2">
            <p className="text-xs text-muted-foreground">Référence</p>
            <p className="font-mono text-sm font-medium">{result.withdrawal_id}</p>
            <p className="text-xs text-muted-foreground mt-2">Adresse</p>
            <p className="font-mono text-xs break-all">{result.destination_address}</p>
          </div>

          <Button
            onClick={() => navigate("/wallet")}
            className="w-full h-11 bg-primary hover:bg-primary/90 rounded-md"
          >
            Retour au portefeuille
          </Button>
        </div>
      )}

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Entre ton code PIN</DialogTitle>
            <DialogDescription>
              {amountInput.display} FCFA seront débités pour envoyer environ {amountUsdt} USDT.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <PinInput
              length={6}
              onComplete={(pin) => {
                setPinOpen(false);
                handleConfirm(pin);
              }}
              testId="crypto-withdraw-pin"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
