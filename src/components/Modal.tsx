import { useEffect, type ReactNode } from "react";

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  // Nearly full-width instead of max-w-4xl, for content that scrolls horizontally.
  wide?: boolean;
}

export function Modal({ onClose, children, wide = false }: ModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`max-h-[80vh] w-full overflow-x-auto overflow-y-auto ${wide ? "max-w-[95vw]" : "max-w-4xl"} rounded-lg bg-white p-4 text-left shadow-lg dark:bg-neutral-900`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
