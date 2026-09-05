import React from "react";
import { Button } from "../ui/button";

export const EmptyState = ({ icon: Icon, title, description, ctaLabel, onCta, testId = "empty-state" }) => (
  <div className="flex flex-col items-center justify-center text-center py-10 px-6" data-testid={testId}>
    {Icon && (
      <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Icon size={24} />
      </div>
    )}
    <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
    {description && <p className="text-sm text-muted-foreground mt-1 max-w-xs">{description}</p>}
    {ctaLabel && (
      <Button
        onClick={onCta}
        data-testid={`${testId}-cta`}
        className="mt-5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md"
      >
        {ctaLabel}
      </Button>
    )}
  </div>
);
