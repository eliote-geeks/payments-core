import React, { useEffect, useRef, useState } from "react";

export const PinInput = ({ length = 6, onComplete, value, onChange, autoFocus = true, disabled = false, testId = "pin-input" }) => {
  const [digits, setDigits] = useState(value ? value.split("") : Array(length).fill(""));
  const [revealIndex, setRevealIndex] = useState(-1);
  const refs = useRef([]);

  useEffect(() => {
    if (autoFocus && !disabled && refs.current[0]) refs.current[0].focus();
  }, [autoFocus, disabled]);

  useEffect(() => {
    const joined = digits.join("");
    onChange?.(joined);
    if (!disabled && joined.length === length && !digits.includes("")) {
      onComplete?.(joined);
    }
  }, [digits]); // eslint-disable-line

  const handleChange = (i, v) => {
    if (disabled) return;
    const clean = v.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean) {
      setRevealIndex(i);
      setTimeout(() => setRevealIndex((r) => (r === i ? -1 : r)), 450);
      if (i < length - 1) refs.current[i + 1]?.focus();
    }
  };

  const handleKey = (i, e) => {
    if (disabled) return;
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  return (
    <div className="flex items-center gap-2.5 justify-center" data-testid={testId}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          value={revealIndex === i ? d : d ? "•" : ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          data-testid={`${testId}-box-${i}`}
          className="w-11 h-12 sm:w-12 sm:h-14 text-center text-xl font-semibold rounded-md border border-border bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-base tabular-nums disabled:opacity-45 disabled:cursor-not-allowed disabled:bg-muted/40"
        />
      ))}
    </div>
  );
};
