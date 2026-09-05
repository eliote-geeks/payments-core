const FIAT_SYMBOLS = { EUR: "€", USD: "$", GBP: "£", CAD: "CA$", CHF: "CHF", MAD: "MAD" };

export const formatAmount = (amount, currency = "FCFA") => {
  const num = Number(amount) || 0;
  if (currency === "BTC") return `${num.toFixed(6)} BTC`;
  if (currency === "USDT") return `${num.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
  if (currency === "XAF" || currency === "FCFA") return `${Math.round(num).toLocaleString("fr-FR")} FCFA`;
  if (FIAT_SYMBOLS[currency]) {
    return `${FIAT_SYMBOLS[currency]} ${num.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${num.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
};

export const formatDate = (iso, locale = "fr-FR") => {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
};

export const formatTime = (iso, locale = "fr-FR") => {
  const d = new Date(iso);
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
};

export const truncateAddress = (addr, front = 6, back = 4) => {
  if (!addr) return "";
  if (addr.length <= front + back) return addr;
  return `${addr.slice(0, front)}...${addr.slice(-back)}`;
};
