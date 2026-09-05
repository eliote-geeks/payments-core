import React from "react";

export const Skeleton = ({ className = "" }) => (
  <div className={`shimmer rounded-md ${className}`} />
);

export const SkeletonCard = () => (
  <div className="p-5 rounded-xl border border-border bg-surface">
    <Skeleton className="h-4 w-1/3 mb-3" />
    <Skeleton className="h-8 w-2/3" />
  </div>
);

export const SkeletonRow = () => (
  <div className="flex items-center gap-3 p-3">
    <Skeleton className="h-10 w-10 rounded-full" />
    <div className="flex-1">
      <Skeleton className="h-3 w-1/2 mb-2" />
      <Skeleton className="h-3 w-1/3" />
    </div>
    <Skeleton className="h-4 w-16" />
  </div>
);
