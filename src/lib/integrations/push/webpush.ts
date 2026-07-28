/**
 * REAL IMPLEMENTATION — WRITTEN, NEVER RUN.
 *
 * Web Push, written from RFC 8030 (Generic Event Delivery Using HTTP Push),
 * RFC 8291 (Message Encryption for Web Push) and RFC 8292 (VAPID). There is no
 * outbound network in the environment Orbit is built in, so not one line of
 * this has been executed against a real push service. Do not describe it as
 * working, and do not let `FakePushProvider` stand in for it in a claim that it
 * does.
 *
 * Selected with PUSH_PROVIDER=webpush.
 *
 * What it needs, and why each is a credential rather than a setting:
 *  - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — the application server key
 *    pair (RFC 8292 §2). The public key is what the browser bound the
 *    subscription to; the private key signs the JWT that proves this server is
 *    the one that key belongs to. A push service rejects an unsigned request.
 *  - `VAPID_SUBJECT` — a `mailto:` or `https:` the push service operator can
 *    reach the sender at (RFC 8292 §2.1). Not decorative: it is how a service
 *    tells an operator their endpoint is misbehaving instead of silently
 *    blocking it.
 *
 * All three are read when this provider is **called**, never when it is
 * constructed — the app has to boot and render with zero credentials whatever
 * the env says.
 *
 * The subscription itself is opaque here. `subscriptionRef` is the JSON a
 * browser's `PushSubscription.toJSON()` produces: an endpoint URL plus the
 * `p256dh` and `auth` keys the payload is encrypted to. Orbit stores it and
 * never inspects it beyond this.
 *
 * Two deliberate absences, both decisions rather than omissions:
 *  - **No retry ladder.** A failed delivery is recorded as failed and the
 *    delivery row is the record. A notification that arrives three times
 *    because a retry could not tell "delivered" from "timed out" is worse than
 *    one that did not arrive, and there is no escalation ladder anywhere in
 *    Orbit by standing rule.
 *  - **No payload for a locked item.** Nothing routes one here — the evaluator
 *    refuses a locked fact before an action is ever built — but a body that
 *    reached a push service would be plaintext leaving the device, which is
 *    precisely what `is_locked` means it must not do.
 */

import { IntegrationError, type PushMessage, type PushProvider } from '../types';

/** RFC 8030 §5.3 — how long the push service should hold an undelivered message. */
const TTL_SECONDS = 60 * 60 * 12;

/** RFC 8292 §2 — a VAPID JWT must not be valid for more than 24 hours. */
const JWT_LIFETIME_SECONDS = 60 * 60 * 12;

type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export class WebPushProvider implements PushProvider {
  readonly name = 'push:webpush';
  readonly isFake = false;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env as Record<
      string,
      string | undefined
    >,
    private readonly timeoutMs = 10_000,
  ) {}

  private credentials(): { publicKey: string; privateKey: string; subject: string } {
    const publicKey = this.env.VAPID_PUBLIC_KEY;
    const privateKey = this.env.VAPID_PRIVATE_KEY;
    const subject = this.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      throw new IntegrationError(
        'push:webpush',
        'missing_credential',
        'set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: or https: ' +
          'the push service operator can reach you at), or leave PUSH_PROVIDER=fake',
      );
    }
    return { publicKey, privateKey, subject };
  }

  /**
   * Parse what the browser gave us.
   *
   * A malformed subscription is reported as malformed rather than as a
   * transport failure: the two need different fixes, and a delivery row that
   * says "transport" about a typo sends somebody looking at the network.
   */
  private parse(subscriptionRef: string): BrowserSubscription {
    let raw: unknown;
    try {
      raw = JSON.parse(subscriptionRef);
    } catch {
      throw new IntegrationError(
        'push:webpush',
        'malformed',
        'a subscription must be the JSON from PushSubscription.toJSON()',
      );
    }
    const sub = raw as Partial<BrowserSubscription>;
    if (
      typeof sub?.endpoint !== 'string' ||
      !sub.endpoint.startsWith('https://') ||
      typeof sub.keys?.p256dh !== 'string' ||
      typeof sub.keys?.auth !== 'string'
    ) {
      throw new IntegrationError(
        'push:webpush',
        'malformed',
        'a subscription needs an https endpoint and both the p256dh and auth keys',
      );
    }
    return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  }

  /**
   * The VAPID Authorization header (RFC 8292 §3).
   *
   * `aud` is the *origin* of the endpoint and not the endpoint itself — a JWT
   * scoped to one subscription would be a different token per device and every
   * push service would reject it.
   */
  private async authorization(endpoint: string): Promise<string> {
    const { publicKey, privateKey, subject } = this.credentials();
    const audience = new URL(endpoint).origin;
    const now = Math.floor(Date.now() / 1000);

    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64url(
      JSON.stringify({ aud: audience, exp: now + JWT_LIFETIME_SECONDS, sub: subject }),
    );
    const signature = await signEs256(`${header}.${claims}`, privateKey);
    return `vapid t=${header}.${claims}.${signature}, k=${publicKey}`;
  }

  async send(subscriptionRef: string, message: PushMessage): Promise<{ delivered: boolean }> {
    const subscription = this.parse(subscriptionRef);

    // `href` is an in-app path by the type's contract; enforced rather than
    // trusted, because a push payload is the one place an external URL would
    // become a link somebody taps from a lock screen.
    if (message.href && !message.href.startsWith('/')) {
      throw new IntegrationError(
        'push:webpush',
        'malformed',
        'a push message links to an in-app path, never to an external URL',
      );
    }

    const authorization = await this.authorization(subscription.endpoint);
    const body = await encryptPayload(
      JSON.stringify({ title: message.title, body: message.body, href: message.href ?? null }),
      subscription.keys,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(TTL_SECONDS),
          Urgency: 'normal',
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      throw new IntegrationError(
        'push:webpush',
        'transport',
        `the push service could not be reached: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    // 404 and 410 mean the subscription is dead — the browser dropped it or
    // the user cleared their site data. That is not a failure to report to the
    // user; it is a subscription to stop using, and the caller records it as
    // such rather than retrying forever.
    if (response.status === 404 || response.status === 410) {
      throw new IntegrationError(
        'push:webpush',
        'not_found',
        'the subscription is gone; this device has to subscribe again',
      );
    }
    if (!response.ok) {
      throw new IntegrationError(
        'push:webpush',
        'transport',
        `the push service refused the message (HTTP ${response.status})`,
      );
    }
    return { delivered: true };
  }
}

// ---------------------------------------------------------------------------
// Crypto
//
// Deliberately at the bottom and deliberately small. RFC 8291 message
// encryption is a real piece of cryptography — ECDH against the subscription's
// p256dh key, HKDF, then AES-128-GCM — and writing a half version of it that
// looks plausible is worse than not writing one, because a push payload is
// somebody's task title leaving their machine.
//
// So: the two functions below are the seam. `signEs256` is complete and uses
// WebCrypto. `encryptPayload` is the one piece that needs a reviewed
// implementation before PUSH_PROVIDER=webpush is offered to anybody, and it
// says so by throwing rather than by sending something unencrypted.
// ---------------------------------------------------------------------------

/**
 * A byte buffer TypeScript is happy to hand to WebCrypto and to fetch.
 *
 * `new Uint8Array(n)` is typed over `ArrayBufferLike`, which since TS 5.7
 * includes SharedArrayBuffer and is therefore not a `BufferSource`. Allocating
 * the ArrayBuffer explicitly is the fix, and doing it in one place keeps the
 * cast out of every call site.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function bytes(length: number): Bytes {
  return new Uint8Array(new ArrayBuffer(length));
}

function byte(value: number): Bytes {
  const b = bytes(1);
  b[0] = value;
  return b;
}

function b64url(input: string | Bytes): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): Bytes {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = bytes(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** ES256 over the VAPID header and claims, per RFC 8292 §3. */
async function signEs256(input: string, privateKeyB64Url: string): Promise<string> {
  const d = b64urlDecode(privateKeyB64Url);
  if (d.length !== 32) {
    throw new IntegrationError(
      'push:webpush',
      'malformed',
      'VAPID_PRIVATE_KEY must be the 32-byte P-256 private scalar, base64url encoded',
    );
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8FromP256Scalar(d),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(input),
  );
  return b64url(new Uint8Array(signature));
}

/**
 * A PKCS#8 wrapper around a raw P-256 scalar.
 *
 * WebCrypto will not import a bare scalar, and the alternative is asking every
 * operator to convert their VAPID key by hand — which is how a private key
 * ends up in somebody's shell history. The prefix is the fixed DER header for
 * an EC private key on prime256v1 with no public-key component.
 */
function pkcs8FromP256Scalar(d: Bytes): Bytes {
  const prefix = Uint8Array.from([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);
  const out = bytes(prefix.length + d.length);
  out.set(prefix, 0);
  out.set(d, prefix.length);
  return out;
}

/**
 * RFC 8291 message encryption, in the aes128gcm content coding of RFC 8188.
 *
 * Written from the two RFCs and never executed against a push service. The
 * steps, in the order the specs give them:
 *
 *   1. a fresh P-256 key pair for this one message (RFC 8291 §3.1)
 *   2. ecdh_secret = ECDH(our private, the subscription's p256dh)
 *   3. PRK_key  = HMAC(auth_secret, ecdh_secret)                    §3.3
 *      IKM      = HMAC(PRK_key, "WebPush: info" ‖ 0 ‖ ua ‖ as ‖ 1)
 *   4. PRK      = HMAC(salt, IKM)                              RFC 8188 §2.2
 *      CEK      = HMAC(PRK, "Content-Encoding: aes128gcm" ‖ 0 ‖ 1)[0..16]
 *      NONCE    = HMAC(PRK, "Content-Encoding: nonce" ‖ 0 ‖ 1)[0..12]
 *   5. one record: plaintext ‖ 0x02, AES-128-GCM under CEK/NONCE
 *   6. body = salt ‖ rs ‖ idlen ‖ our public key ‖ ciphertext
 *
 * The ephemeral key pair is per message and never stored: it is what makes two
 * notifications to the same device share no key material.
 */

const RECORD_SIZE = 4096;

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

function concat(...parts: Bytes[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = bytes(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function utf8(s: string): Bytes {
  const encoded = new TextEncoder().encode(s);
  const out = bytes(encoded.length);
  out.set(encoded, 0);
  return out;
}

async function encryptPayload(
  plaintext: string,
  keys: { p256dh: string; auth: string },
): Promise<Bytes> {
  const uaPublicBytes = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 0x04) {
    throw new IntegrationError(
      'push:webpush',
      'malformed',
      'p256dh must be an uncompressed P-256 point, 65 bytes starting 0x04',
    );
  }
  if (authSecret.length !== 16) {
    throw new IntegrationError('push:webpush', 'malformed', 'the auth secret must be 16 bytes');
  }

  const uaPublic = await crypto.subtle.importKey(
    'raw',
    uaPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const asPublicBytes: Bytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey),
  );
  const ecdhSecret: Bytes = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, ephemeral.privateKey, 256),
  );

  // RFC 8291 §3.3 — the auth secret is the HKDF *key*, not the salt, at this
  // step. Getting these two the wrong way round produces a ciphertext that is
  // perfectly well-formed and that no browser can open.
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(
    prkKey,
    concat(utf8('WebPush: info'), byte(0), uaPublicBytes, asPublicBytes, byte(1)),
  );

  const salt = crypto.getRandomValues(bytes(16));
  const prk = await hmac(salt, ikm);
  const cek = (
    await hmac(prk, concat(utf8('Content-Encoding: aes128gcm'), byte(0), byte(1)))
  ).slice(0, 16);
  const nonce = (
    await hmac(prk, concat(utf8('Content-Encoding: nonce'), byte(0), byte(1)))
  ).slice(0, 12);

  // 0x02 is the delimiter for the last (and here only) record. A body long
  // enough to need two records would be a notification nobody could read on a
  // lock screen, so one record is the whole implementation.
  const record = concat(utf8(plaintext), byte(2));
  if (record.length + 16 > RECORD_SIZE) {
    throw new IntegrationError(
      'push:webpush',
      'malformed',
      'the message is too long for one record; shorten it rather than splitting it',
    );
  }

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext: Bytes = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record),
  );

  const header = bytes(16 + 4 + 1 + asPublicBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublicBytes.length;
  header.set(asPublicBytes, 21);

  return concat(header, ciphertext);
}
