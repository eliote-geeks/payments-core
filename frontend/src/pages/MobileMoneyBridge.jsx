import React from "react";
import { MobileMoneyTab } from "./Transfer";

export default function MobileMoneyBridge() {
  return (
    <div className="max-w-xl mx-auto space-y-6" data-testid="mobile-money-bridge-page">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Orange ↔ MTN</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Envoyez de l'argent entre Orange Money et MTN Mobile Money, sans frais Kobo.
        </p>
      </div>
      <MobileMoneyTab standalone />
    </div>
  );
}
