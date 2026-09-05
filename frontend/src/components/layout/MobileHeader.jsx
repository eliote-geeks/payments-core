import React from "react";
import { Moon, Sun, Languages } from "lucide-react";
import { useI18n } from "../../context/I18nContext";
import { useTheme } from "../../context/ThemeContext";
import { NotificationBell } from "../common/NotificationBell";

export const MobileHeader = ({ title, right }) => {
  const { lang, toggleLang } = useI18n();
  const { theme, toggle } = useTheme();

  return (
    <header
      data-testid="mobile-header"
      className="md:hidden sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border"
    >
      <div className="h-14 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
            <span className="font-display font-bold text-white text-sm">K</span>
          </div>
          <span className="font-display font-bold text-base">{title || "Kobo"}</span>
        </div>
        <div className="flex items-center gap-1">
          {right}
          <NotificationBell />
          <button
            type="button"
            onClick={toggleLang}
            data-testid="mobile-lang-toggle"
            className="h-9 px-2.5 rounded-md hover:bg-secondary transition-base flex items-center gap-1 text-xs font-semibold uppercase"
          >
            <Languages size={16} />
            {lang}
          </button>
          <button
            type="button"
            onClick={toggle}
            data-testid="mobile-theme-toggle"
            className="h-9 w-9 rounded-md hover:bg-secondary transition-base flex items-center justify-center"
            aria-label="toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
};
