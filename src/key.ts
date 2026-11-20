/**
 * Decide which REGISTRUM_API_KEY value to use, if any.
 *
 * Only a value shaped like a real key is used. Anything else - an unexpanded
 * "${REGISTRUM_API_KEY}" an installer wrote into the client config, a JS
 * "[object Object]", the README's "reg_live_..." - would be rejected by the
 * API on every call, so it is ignored and the server relays to the keyless
 * endpoint instead. Production saw exactly that placeholder on real tool
 * calls for three weeks, each one a user getting only "Invalid API key".
 */
const KEY_SHAPE = /^reg_[A-Za-z0-9_]+$/;

export interface ResolvedKey {
  /** The key to send, or "" for keyless. */
  key: string;
  /** The raw value that was set but discarded, so the caller can say why. */
  ignored: string | null;
}

export function resolveApiKey(raw: string | undefined): ResolvedKey {
  const value = (raw ?? "").trim();
  if (!value) return { key: "", ignored: null };
  if (KEY_SHAPE.test(value)) return { key: value, ignored: null };
  return { key: "", ignored: value };
}
