import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import fr from "../i18n/fr";
import en from "../i18n/en";

const dictionaries = { fr, en };
const I18nContext = createContext(null);

const getByPath = (obj, path) => path.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);

export const I18nProvider = ({ children }) => {
  const [lang, setLang] = useState(() => {
    if (typeof window === "undefined") return "fr";
    return localStorage.getItem("kobo:lang") || "fr";
  });

  useEffect(() => {
    localStorage.setItem("kobo:lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key, fallback = "") => {
      const v = getByPath(dictionaries[lang], key);
      if (v === undefined) return fallback || key;
      return v;
    },
    [lang]
  );

  const toggleLang = () => setLang((l) => (l === "fr" ? "en" : "fr"));

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
