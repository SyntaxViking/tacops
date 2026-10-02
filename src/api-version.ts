// The client<->server API contract version - sent with every web client request
// (src/api/fetch-with-timeout.ts) and enforced as the worker's own minimum (worker/client-version.ts,
// which imports this exact same constant). Bumped ONLY for a breaking change that requires every
// client to update before it can talk to the backend again - NOT on every deploy. Most changes
// (new endpoints, new fields, behavior tweaks) are backwards compatible and should ship without
// touching this number at all.
//
// See AGENTS.md's "API version" section: an agent must never bump this without the developer
// explicitly, deliberately asking for that exact change in that exact request.
export const API_VERSION = 1;
