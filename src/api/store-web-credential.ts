// Chrome/Edge's native "save password?" prompt relies on detecting a successful form submission
// via navigation or a full page reload, neither of which happens in this single-page app - so it
// never fires on its own. The Credential Management API lets us trigger it explicitly instead.
// Safari and Firefox don't implement PasswordCredential, so this is a no-op there (autofill via
// the autoComplete attributes on the inputs still works everywhere it's supported).
//
// Both functions below log every branch to the console (not just failures) - this API is prone to
// invisible failure modes (the save prompt can appear and auto-dismiss without the user noticing,
// mediation:"silent" can decline for reasons that have nothing to do with whether something is
// actually stored) and the previous silent-everywhere version made a real "doesn't work" report
// impossible to diagnose. If this is still silently failing, check the browser console (not just
// whether a visible prompt appeared) for which of these lines actually printed.
export async function storeWebCredential(userId: string, clientSecret: string): Promise<void> {
  if (!("PasswordCredential" in window)) {
    console.log("[storeWebCredential] skipped - this browser doesn't implement PasswordCredential");
    return;
  }
  try {
    const PasswordCredentialCtor = (window as any).PasswordCredential;
    const credential = new PasswordCredentialCtor({ id: userId, password: clientSecret });
    await navigator.credentials.store(credential);
    console.log("[storeWebCredential] navigator.credentials.store() resolved - check chrome://settings/passwords to confirm it actually saved (a dismissed/ignored save prompt can resolve without saving anything)");
  } catch (error) {
    // Best-effort - the user can dismiss/block the prompt, and that should never affect the
    // actual data fetch that already happened - but logged (not swallowed silently) since this is
    // the only way to tell "the browser declined" apart from "this threw for an unrelated reason."
    console.warn("[storeWebCredential] navigator.credentials.store() failed", error);
  }
}

// The read-back half of storeWebCredential above, used by App.tsx on mount to silently auto-login
// a returning visitor. mediation: "silent" resolves to null (no browser UI at all) whenever
// there's nothing stored OR the browser simply declines to hand it back without a user gesture -
// both are normal, expected outcomes here, never an error; the caller's only job is to fall back
// to the manual login form when this returns null. Same Chrome/Edge-only limitation as
// storeWebCredential (Safari/Firefox don't implement PasswordCredential at all).
export async function retrieveWebCredential(): Promise<{ userId: string; clientSecret: string } | null> {
  if (!("PasswordCredential" in window)) {
    console.log("[retrieveWebCredential] skipped - this browser doesn't implement PasswordCredential");
    return null;
  }
  try {
    // TS's DOM lib types CredentialRequestOptions with only mediation/publicKey (no `password`),
    // and Credential's base interface has only id/type (no `password`) - same gap
    // storeWebCredential's constructor call already works around above, same `any` escape hatch.
    const credential = await navigator.credentials.get({ password: true, mediation: "silent" } as any);
    if (!credential) {
      console.log('[retrieveWebCredential] navigator.credentials.get() resolved null - either nothing is stored for this origin, or the browser declined to return it silently (check chrome://settings/passwords to tell which)');
      return null;
    }
    const { id, password } = credential as any;
    if (typeof id !== "string" || typeof password !== "string") {
      console.warn("[retrieveWebCredential] got a credential back but id/password weren't both strings - treating as nothing stored", credential);
      return null;
    }
    console.log("[retrieveWebCredential] found a stored credential, auto-login will be attempted");
    return { userId: id, clientSecret: password };
  } catch (error) {
    console.warn("[retrieveWebCredential] navigator.credentials.get() failed", error);
    return null;
  }
}
