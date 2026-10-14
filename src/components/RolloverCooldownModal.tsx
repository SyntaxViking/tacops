interface RolloverCooldownModalProps {
  msRemaining: number;
}

// Always zero-padded mm:ss (not formatElapsedSeconds's "45s"-under-a-minute shorthand) - this is a
// countdown clock, not an elapsed-time label.
function formatMmSs(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Deliberately undismissable: no close button, no backdrop onClick - this is the thing that
// actually satisfies "refuse manual traffic" for click-driven actions (the login form, refresh
// buttons, etc. are all physically unreachable underneath a full-screen, high-z-index overlay with
// no way to dismiss it), not just a transport-layer check. See rollover-guard.ts/
// invoke-with-timeout.ts for the automatic-traffic half of the guarantee this pairs with.
export function RolloverCooldownModal({ msRemaining }: RolloverCooldownModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="max-w-md rounded-lg bg-white p-6 text-center shadow-lg dark:bg-neutral-900">
        <p className="text-lg">
          Game-server reset happens soon. To prevent issues with your account, TacOps will not send any traffic for the next{" "}
          <span className="font-mono font-bold">{formatMmSs(msRemaining)}</span>.
        </p>
      </div>
    </div>
  );
}
