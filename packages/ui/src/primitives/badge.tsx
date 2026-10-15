import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/10 bg-white/[0.045] px-2 py-0.5 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-slate-400",
        className,
      )}
      {...props}
    />
  );
}
