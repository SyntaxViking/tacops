import type { ReactNode } from "react";

export function IconRow({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <div className={`flex ${wrap ? "flex-wrap" : "flex-nowrap"} items-center gap-x-2 gap-y-0.5`}>{children}</div>;
}
