import React, { useState } from "react";
import { COUNTRIES } from "../../data/countries";
import { ChevronDown } from "lucide-react";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/**
 * PhoneInput — country code selector + local number field.
 * Props:
 *   value        string  full E.164 value (e.g. "+237677123456")
 *   onChange     fn(e164: string) => void
 *   placeholder  string  local number placeholder
 *   disabled     bool
 *   suffix       ReactNode  right-side icon/slot (spinner, checkmark, etc.)
 *   onBlur       fn
 */
export function PhoneInput({
  value = "",
  onChange,
  placeholder = "6 XX XX XX XX",
  disabled = false,
  suffix = null,
  onBlur,
  testId = "phone-input",
}) {
  const [countryCode, setCountryCode] = useState("CM");
  const country = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];

  // Strip dial prefix from value to show local digits only
  const localValue = value.startsWith(country.dial)
    ? value.slice(country.dial.length)
    : value.startsWith("+")
    ? value.slice(country.dial.length) // best effort
    : value;

  const handleLocalChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "");
    onChange?.(digits ? `${country.dial}${digits}` : "");
  };

  const handleCountryChange = (code) => {
    const newCountry = COUNTRIES.find((c) => c.code === code);
    if (!newCountry) return;
    const digits = localValue.replace(/\D/g, "");
    setCountryCode(code);
    onChange?.(digits ? `${newCountry.dial}${digits}` : "");
  };

  return (
    <div className="flex rounded-md overflow-hidden border border-border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0 bg-background">
      {/* Country picker */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            data-testid={`${testId}-country`}
            className="flex items-center gap-1.5 px-3 py-2.5 border-r border-border bg-secondary hover:bg-muted transition-colors shrink-0"
          >
            <span className="text-base leading-none">{country.flag}</span>
            <span className="text-sm font-medium text-foreground">{country.dial}</span>
            <ChevronDown size={12} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
          {COUNTRIES.map((c) => (
            <DropdownMenuItem
              key={c.code}
              onClick={() => handleCountryChange(c.code)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <span className="text-base">{c.flag}</span>
              <span className="flex-1 text-sm">{c.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{c.dial}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Local number */}
      <div className="relative flex-1">
        <Input
          type="tel"
          inputMode="numeric"
          data-testid={testId}
          value={localValue.replace(/\D/g, "")}
          onChange={handleLocalChange}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          className="border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 pr-8 tabular-nums"
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
}
