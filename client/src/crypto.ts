// ECDH (P-256) + AES-GCM helpers for the MQTT transport.
// The message bus is a public broker, so private game data (role, dice,
// inspection results) is never sent in plaintext: at join time the client and
// host exchange ECDH public keys; a passive observer who sees both public
// keys still cannot derive the shared AES key (Diffie–Hellman), so private
// payloads stay readable only by that player and the host.
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export interface KeySet { pair: CryptoKeyPair; pubJwk: JsonWebKey; }

export async function generateKeys(): Promise<KeySet> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, pubJwk };
}

export async function deriveAesKey(myPrivate: CryptoKey, theirPubJwk: JsonWebKey): Promise<CryptoKey> {
  const theirPub = await crypto.subtle.importKey('jwk', theirPubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPub }, myPrivate,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(key: CryptoKey, obj: unknown): Promise<{ enc: 1; iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { enc: 1, iv: b64(iv), data: b64(ct) };
}

export async function decryptJson(key: CryptoKey, payload: { iv: string; data: string }): Promise<unknown> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) as BufferSource }, key, unb64(payload.data) as BufferSource);
  return JSON.parse(new TextDecoder().decode(pt));
}
