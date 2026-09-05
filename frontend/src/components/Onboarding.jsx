import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ShieldCheck, Wallet, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useAuth } from "../context/AuthContext";

const STEPS = [
  {
    icon: CheckCircle2,
    color: "text-primary",
    bg: "bg-primary/10",
    title: "Bienvenue sur Kobo !",
    body: "Envoyez et recevez de l'argent facilement — en FCFA ou en devises internationales.",
    cta: "Commencer",
  },
  {
    icon: ShieldCheck,
    color: "text-warning",
    bg: "bg-warning/10",
    title: "Vérifiez votre identité",
    body: "La vérification KYC vous permet d'augmenter vos limites de transfert et d'accéder à toutes les fonctionnalités.",
    cta: "Vérifier maintenant",
    route: "/kyc",
  },
  {
    icon: Wallet,
    color: "text-success",
    bg: "bg-success/10",
    title: "Alimentez votre portefeuille",
    body: "Déposez des fonds pour commencer à envoyer de l'argent. Votre premier dépôt est gratuit.",
    cta: "Déposer des fonds",
    route: "/wallet",
  },
];

const STORAGE_KEY = "kobo:onboarded";

export function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user) return;
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) setOpen(true);
  }, [user]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  const handleCta = () => {
    const current = STEPS[step];
    if (current.route) {
      dismiss();
      navigate(current.route);
      return;
    }
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="sm:max-w-sm rounded-2xl p-0 overflow-hidden gap-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Guide de démarrage Kobo</DialogTitle>
          <DialogDescription>
            Présentation rapide des principales fonctionnalités avant de commencer.
          </DialogDescription>
        </DialogHeader>
        {/* Progress dots */}
        <div className="flex items-center px-5 pt-5 pr-12">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i <= step ? "w-6 bg-primary" : "w-3 bg-border"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-8 space-y-5 text-center">
          <div className={`mx-auto h-20 w-20 rounded-2xl ${current.bg} ${current.color} flex items-center justify-center`}>
            <Icon size={36} />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-xl font-bold">{current.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-2">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => s - 1)}
              className="rounded-xl border-border"
            >
              Retour
            </Button>
          )}
          <Button
            type="button"
            onClick={handleCta}
            className="flex-1 bg-primary hover:bg-primary/90 rounded-xl text-primary-foreground h-11"
          >
            {current.cta}
            <ArrowRight size={16} className="ml-1.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
