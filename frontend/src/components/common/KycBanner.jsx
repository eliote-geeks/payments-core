import React from "react";
import { ShieldCheck, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../context/I18nContext";

export const KycBanner = () => {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  if (!user) return null;
  const level = user.kycLevel ?? 0;
  const levels = t("kyc.levels");
  const label = Array.isArray(levels) ? levels[level] : "";
  const progress = ((level + 1) / 4) * 100;

  return (
    <button
      type="button"
      data-testid="kyc-banner"
      onClick={() => navigate("/kyc")}
      className="w-full flex items-center gap-3 p-4 rounded-xl bg-surface border border-border hover:border-primary/40 transition-base text-left"
    >
      <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <ShieldCheck size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {t("kyc.banner")} <span className="text-primary">{level}</span> · {label}
          </p>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </button>
  );
};
