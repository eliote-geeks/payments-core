import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, Smartphone, LogOut, ShieldCheck, ChevronRight, Moon, Sun, Languages } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { useI18n } from "../context/I18nContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { patchMe } from "../api/user";

export default function Profile() {
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: user?.fullName || "",
  });

  const handleSave = async () => {
    try {
      const updated = await patchMe({ fullName: form.fullName });
      updateUser(updated);
      toast.success(lang === "fr" ? "Enregistré" : "Saved");
    } catch {
      toast.error(lang === "fr" ? "Impossible d'enregistrer" : "Failed to save");
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto" data-testid="profile-page">
      <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("profile.title")}</h1>

      {/* Avatar card */}
      <div className="rounded-xl bg-surface border border-border p-5 flex items-center gap-4" data-testid="profile-header">
        <div className="relative">
          <img
            src={user?.avatar}
            alt={user?.fullName}
            className="h-16 w-16 rounded-full object-cover border-2 border-border"
          />
          {user?.kycLevel >= 1 && (
            <span className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center border-2 border-surface">
              <BadgeCheck size={12} />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-bold truncate">{user?.fullName}</h3>
          <p className="text-sm text-muted-foreground truncate">{user?.phone}</p>
          {user?.kycLevel >= 1 && (
            <span className="inline-flex items-center gap-1 mt-1 text-xs text-primary font-medium">
              <ShieldCheck size={12} /> {t("profile.verified")} · Niveau {user.kycLevel}
            </span>
          )}
        </div>
      </div>

      {/* Personal */}
      <section>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">{t("profile.personal")}</p>
        <div className="rounded-xl bg-surface border border-border p-5 space-y-4" data-testid="profile-personal">
          <div>
            <Label>{t("auth.fullName")}</Label>
            <Input
              data-testid="profile-name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="rounded-md mt-1.5"
            />
          </div>
          <div>
            <Label>{t("auth.phoneLabel")}</Label>
            <Input
              data-testid="profile-phone"
              value={user?.phone || ""}
              disabled
              className="rounded-md mt-1.5"
            />
          </div>
          <Button onClick={handleSave} data-testid="profile-save" className="w-full bg-primary hover:bg-primary/90 rounded-md text-primary-foreground">
            {t("common.save")}
          </Button>
        </div>
      </section>

      {/* Mobile Money */}
      <section>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">{t("profile.momoNumbers")}</p>
        <div className="rounded-xl bg-surface border border-border divide-y divide-border overflow-hidden" data-testid="profile-momo">
          {(user?.registeredMomo || []).map((m, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold ${
                m.provider === "MTN" ? "bg-[#FFCC00] text-black" : "bg-[#FF6600] text-white"
              }`}>
                {m.provider === "MTN" ? "MTN" : "OM"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{m.number}</p>
                <p className="text-xs text-success flex items-center gap-1"><BadgeCheck size={10} /> verified</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Preferences */}
      <section>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">Préférences</p>
        <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border">
          <div className="flex items-center gap-3 p-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Languages size={18} />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">{t("profile.language")}</p>
              <p className="text-xs text-muted-foreground">{lang === "fr" ? "Français" : "English"}</p>
            </div>
            <Button variant="outline" onClick={toggleLang} data-testid="profile-lang-toggle" className="rounded-md border-border">
              {lang === "fr" ? "EN" : "FR"}
            </Button>
          </div>
          <div className="flex items-center gap-3 p-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">{t("profile.darkMode")}</p>
              <p className="text-xs text-muted-foreground">{theme === "dark" ? "On" : "Off"}</p>
            </div>
            <Switch checked={theme === "dark"} onCheckedChange={toggle} data-testid="profile-theme-toggle" />
          </div>
        </div>
      </section>

      {/* Security */}
      <section>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">{t("profile.security")}</p>
        <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border">
          <button type="button" data-testid="profile-change-pin" className="w-full flex items-center gap-3 p-4 hover:bg-secondary transition-base text-left">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck size={18} />
            </div>
            <span className="flex-1 font-medium text-sm">{t("profile.changePin")}</span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
          <button type="button" data-testid="profile-trusted-devices" className="w-full flex items-center gap-3 p-4 hover:bg-secondary transition-base text-left">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Smartphone size={18} />
            </div>
            <span className="flex-1 font-medium text-sm">{t("profile.trustedDevices")}</span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
        </div>
      </section>

      <Button
        onClick={handleLogout}
        data-testid="profile-logout"
        variant="outline"
        className="w-full rounded-md border-destructive/30 text-destructive hover:bg-destructive/10"
      >
        <LogOut size={16} className="mr-1.5" /> {t("common.logout")}
      </Button>
    </div>
  );
}
