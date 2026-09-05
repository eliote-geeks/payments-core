import React, { useState } from "react";
import { COUNTRIES } from "../../countries";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export const CountrySelector = ({ value, onChange, testId = "country-selector" }) => {
  const current = COUNTRIES.find((c) => c.code === value) || COUNTRIES[0];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? COUNTRIES.filter((c) => [
        c.name,
        c.code,
        c.dial,
        ...(c.tags || []),
      ].join(" ").toLowerCase().includes(q))
    : COUNTRIES;

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-border bg-surface hover:bg-secondary transition-base min-w-[110px]"
        >
          <span className="text-lg leading-none">{current.flag}</span>
          <span className="text-sm font-medium">{current.dial}</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 overflow-hidden p-0">
        <div className="border-b border-border p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Rechercher un pays..."
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="max-h-72 overflow-auto p-1">
        {filtered.map((c) => (
          <DropdownMenuItem
            key={c.code}
            data-testid={`${testId}-option-${c.code}`}
            onClick={() => { onChange?.(c.code); setQuery(""); }}
            className="flex items-center gap-2 cursor-pointer"
          >
            <span className="text-lg">{c.flag}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm truncate">{c.name}</span>
              {!!c.tags?.length && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {c.tags.map((tag) => (
                    <span key={tag} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{c.dial}</span>
          </DropdownMenuItem>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Aucun pays trouvé
          </div>
        )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
