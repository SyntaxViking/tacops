// Chrome/Edge's native "save password?" prompt relies on detecting a successful form submission
// via navigation or a full page reload, neither of which happens in this single-page app - so it
// never fires on its own. The Credential Management API lets us trigger it explicitly instead.
// Safari and Firefox don't implement PasswordCredential, so this is a no-op there (autofill via
// the autoComplete attributes on the inputs still works everywhere it's supported).
export async function storeWebCredential(userId: string, clientSecret: string): Promise<void> {
  if (!("PasswordCredential" in window)) return;
  try {
    const PasswordCredentialCtor = (window as any).PasswordCredential;
    const credential = new PasswordCredentialCtor({ id: userId, password: clientSecret });
    await navigator.credentials.store(credential);
  } catch {
    // Best-effort - the user can dismiss/block the prompt, and that should never affect the
    // actual data fetch that already happened.
  }
}

// The read-back half of storeWebCredential above, used by App.tsx on mount to silently auto-login
// a returning visitor. mediation: "silent" resolves to null (no browser UI at all) whenever
// there's nothing stored OR the browser simply declines to hand it back without a user gesture -
// both are normal, expected outcomes here, never an error; the caller's only job is to fall back
// to the manual login form when this returns null. Same Chrome/Edge-only limitation as
// storeWebCredential (Safari/Firefox don't implement PasswordCredential at all).
export async function retrieveWebCredential(): Promise<{ userId: string; clientSecret: string } | null> {
  if (!("PasswordCredential" in window)) return null;
  try {
    // TS's DOM lib types CredentialRequestOptions with only mediation/publicKey (no `password`),
    // and Credential's base interface has only id/type (no `password`) - same gap
    // storeWebCredential's constructor call already works around above, same `any` escape hatch.
    const credential = await navigator.credentials.get({ password: true, mediation: "silent" } as any);
    if (!credential) return null;
    const { id, password } = credential as any;
    if (typeof id !== "string" || typeof password !== "string") return null;
    return { userId: id, clientSecret: password };
  } catch {
    return null;
  }
}
