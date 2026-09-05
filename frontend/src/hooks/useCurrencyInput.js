import { useState } from "react";

export function useCurrencyInput(initial = "") {
  const [raw, setRaw] = useState(initial ? String(initial) : "");
  const [display, setDisplay] = useState(
    initial ? parseInt(String(initial), 10).toLocaleString("fr-FR") : ""
  );

  const onChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "");
    setRaw(digits);
    setDisplay(digits ? parseInt(digits, 10).toLocaleString("fr-FR") : "");
  };

  const reset = () => { setRaw(""); setDisplay(""); };

  return { raw, display, onChange, reset, numValue: raw ? parseInt(raw, 10) : 0 };
}
