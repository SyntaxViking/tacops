// Rejects a request from a too-old client, checked at the very top of every /api/fetch-* route
// (worker/index.ts), before any work at all (no D1 read, no outbound Loki call) - so an old
// client's call costs nothing beyond parsing its own request body, and works against a client
// that's *already* open right now, not just ones that reload after this ships.
//
// The client sends its own API_VERSION with every request (see src/api/fetch-with-timeout.ts) -
// imported here from the exact same src/api-version.ts constant, so client and server can never
// drift out of sync by accident. API_VERSION only changes on a deliberate breaking change (see its
// own comment, and AGENTS.md's "API version" section) - most deploys ship with it unchanged, which
// is exactly what keeps this gate from rejecting perfectly compatible older clients for no reason.
import { API_VERSION } from "../src/api-version";

export function isClientVersionAcceptable(clientApiVersion: unknown): boolean {
  return typeof clientApiVersion === "number" && clientApiVersion >= API_VERSION;
}

// Shown to the end user (surfaced via src/api/fetch-with-timeout.ts's 426 handling, which also
// triggers App.tsx's StaleVersionBanner) - plain English, not a stack trace, since this is the one
// error message an old-version user is actually meant to read and act on.
export const STALE_CLIENT_MESSAGE = "Server requires client to refresh the page";
