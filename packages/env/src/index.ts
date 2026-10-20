/**
 * SOT: env, environment-variables, config, secrets
 * WHAT   Every environment variable the platform reads, in one place, read once.
 * WHY    Two reasons. A missing secret should fail at boot, not on a customer's request.
 *        And `noPropertyAccessFromIndexSignature` makes `process.env.FOO` a type error, so
 *        centralising the bracket access here keeps that strictness free everywhere else.
 * HOW    Adding a variable is one line here plus one in .env.example. Nothing else reads
 *        process.env - a lint rule enforces that. A variable the browser reads is spelled
 *        out literally instead of going through `required`; see `publicAppUrl`.
 * WHERE  every server package, plus @foodos/auth/client in the browser
 */
function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function required(name: string): string {
  return requireValue(name, process.env[name]);
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * The shortest secret worth calling one. 32 bytes of base64 is 44 characters; 32 is the
 * floor rather than the target, so a hand-typed passphrase is refused without rejecting a
 * legitimate key that happens to be encoded differently.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Values that have been published to a git repository and must never authenticate anything.
 * Every entry is a literal that has shipped in `.env.example`, plus the words people reach
 * for when they mean "fill this in later".
 *
 * Substring matching, not equality: `required()` already accepted
 * "generate-with-openssl-rand-base64-32" verbatim, and somebody appending "-prod" to it
 * should not buy their way past this check.
 *
 * Deliberately NOT on this list: "secret", "password", "key". They are generic enough to
 * occur inside a legitimate operator-chosen value, and every entry here hard-fails a
 * production boot - a deny-list that grounds a healthy deployment is worse than the hole it
 * closes. Low-quality-but-not-published values are caught by `distinctCharacters` below
 * instead, which measures the value rather than guessing at its wording.
 */
const PLACEHOLDER_FRAGMENTS: readonly string[] = [
  "generate-with-openssl",
  "changeme",
  "change-me",
  "replace-me",
  "placeholder",
  "insecure",
  "dev-only",
  "xxxx",
];

/**
 * How many different characters the value uses. 32 bytes from a CSPRNG, base64-encoded,
 * lands around 30-40 distinct characters; a repeated character, a keyboard walk or a short
 * phrase padded to length lands far below. Ten is chosen to sit clearly under any real key
 * and clearly over "aaaaaaaa..." - it is a floor against obviously-not-random input, not an
 * entropy estimate, and it is not doing security work on its own.
 */
function distinctCharacters(value: string): number {
  return new Set(value).size;
}

const MIN_DISTINCT_CHARACTERS = 10;

/**
 * A secret, not merely a value that is present.
 *
 * `required()` is the right check for a URL and the wrong one for a key: it accepted the
 * literal shipped in `.env.example`, so a deployment that copied the file and filled in
 * everything except this line booted with a published secret. For BETTER_AUTH_SECRET that
 * is remote session forgery needing no bus access at all; for ENVELOPE_SECRET it is the
 * ability to mint an envelope naming any org id and any role, which is every gate in the
 * platform at once.
 *
 * Enforced in production only. Failing this in development would refuse the very
 * `.env.example` the getting-started path tells you to copy, so it warns there instead -
 * loudly, and on every boot, because a warning nobody sees is the same as no check. The
 * pattern mirrors `natsNkeySeed` twelve lines below, which already treats production as the
 * environment where a missing credential is fatal.
 */
function requireSecret(name: string): string {
  const value = requireValue(name, process.env[name]);
  const lowered = value.toLowerCase();
  const matched = PLACEHOLDER_FRAGMENTS.find((fragment) => lowered.includes(fragment));
  const problem =
    matched !== undefined
      ? `it contains "${matched}", which means it came from .env.example rather than from a generator`
      : value.length < MIN_SECRET_LENGTH
        ? `it is ${String(value.length)} characters; a real key is at least ${String(MIN_SECRET_LENGTH)}`
        : distinctCharacters(value) < MIN_DISTINCT_CHARACTERS
          ? `it uses only ${String(distinctCharacters(value))} distinct characters, so it was typed rather than generated`
          : null;

  if (problem === null) return value;

  const advice = `${name} is not a usable secret: ${problem}. Generate one with \`openssl rand -base64 32\`.`;
  if (process.env["NODE_ENV"] === "production") throw new Error(advice);
  console.warn(`[env] ${advice}`);
  return value;
}

/**
 * The one variable that reaches the browser, and the only one whose key is written out in
 * full. Next substitutes `NEXT_PUBLIC_*` into the client bundle by matching the literal text
 * of the key - `getNextPublicEnvironmentVariables` in next/dist/lib/static-env.js emits one
 * define per key - and never defines `process.env` as an object. So `required(name)`, which
 * reads `process.env[name]` dynamically, yields undefined in the browser and throws on
 * import. Keep this key literal. Do not route it through `required`.
 *
 * biome.json turns complexity/useLiteralKeys off for THIS FILE, because its suggested
 * rewrite to `process.env.NEXT_PUBLIC_APP_URL` is TS4111 under
 * `noPropertyAccessFromIndexSignature` - `make fix` runs biome with --unsafe and would
 * otherwise apply it and break the build. biome.json takes neither comments nor unknown
 * keys, so the reason lives here.
 */
function publicAppUrl(): string {
  return requireValue("NEXT_PUBLIC_APP_URL", process.env["NEXT_PUBLIC_APP_URL"]);
}

/**
 * Whether the browser should open the live cart stream. Off unless asked for: the stream is a
 * long-lived server function holding a bus connection per open phone, which a small hosted
 * deployment cannot afford, and the cart already falls back to re-reading every few seconds.
 * Literal key, like `publicAppUrl`, because the browser reads it.
 */
function publicCartStream(): boolean {
  return process.env["NEXT_PUBLIC_CART_STREAM"] === "on";
}

export const env = {
  /** Same value in the gateway and every service, or services reject every envelope. */
  envelopeSecret: (): string => requireSecret("ENVELOPE_SECRET"),
  databaseUrl: (): string => required("DATABASE_URL"),
  natsUrl: (): string => {
    const url = optional("NATS_URL") ?? "nats://localhost:4222";
    // A URL with no port made the client dial "localhost" for the TLS name on some connects
    // (ERR_TLS_CERT_ALTNAME_INVALID against a hosted bus), so the default port is explicit.
    return /^[a-z]+:\/\/[^:/]+$/.test(url) ? `${url}:4222` : url;
  },
  /** Names the NATS credential this process holds. See infra/nats/auth.conf. */
  natsUser: (): string => optional("NATS_USER") ?? optional("SERVICE_NAME") ?? "gateway",
  /**
   * The private half of that credential. The bus refuses an unauthenticated connection, so
   * a deployment without one fails at boot rather than on a customer's request.
   */
  natsNkeySeed: (): string | null => {
    const seed = optional("NATS_NKEY_SEED");
    if (seed === null && optional("NATS_CREDS") === null && process.env["NODE_ENV"] === "production") {
      throw new Error(
        "Missing NATS_NKEY_SEED or NATS_CREDS. The bus authenticates; see infra/nats/RUNBOOK.md.",
      );
    }
    return seed;
  },
  /**
   * The contents of a `.creds` file, for a hosted NATS (Synadia Cloud) that authenticates
   * with a signed user JWT instead of a seed in a server-side config. Wins over a seed.
   */
  natsCreds: (): string | null => optional("NATS_CREDS"),
  /** Browser-safe. Anything shipped to the client must call this one. */
  publicAppUrl,
  /** Browser-safe. */
  cartStream: publicCartStream,
  /** The server-side name for the same read, so the two can never drift apart. */
  appUrl: publicAppUrl,
  betterAuthSecret: (): string => requireSecret("BETTER_AUTH_SECRET"),
  autumnSecretKey: (): string | null => optional("AUTUMN_SECRET_KEY"),
  upstash: (): { url: string; token: string } | null => {
    const url = optional("UPSTASH_REDIS_REST_URL");
    const token = optional("UPSTASH_REDIS_REST_TOKEN");
    return url === null || token === null ? null : { url, token };
  },
  /**
   * The payment provider's keys, or null when none are configured. Null is a real state, not
   * a misconfiguration: a restaurant taking cash at the counter needs no gateway at all, and
   * the orders service says so plainly rather than failing at the moment somebody pays.
   */
  razorpay: (): { keyId: string; keySecret: string } | null => {
    const keyId = optional("RAZORPAY_KEY_ID");
    const keySecret = optional("RAZORPAY_KEY_SECRET");
    return keyId === null || keySecret === null ? null : { keyId, keySecret };
  },
  /**
   * The secret a payment webhook is signed with. Separate from the API keys because it is
   * rotated separately, and because verifying a webhook must not need the ability to charge.
   */
  paymentWebhookSecret: (): string | null => optional("RAZORPAY_WEBHOOK_SECRET"),
  /**
   * The organisation that operates the SaaS itself, or null when nobody has been named.
   * Null means the platform console is closed, which is the right default: a cross-tenant
   * surface that opens because a variable was forgotten is the wrong kind of surprise.
   */
  platformOrgId: (): string | null => optional("PLATFORM_ORG_ID"),
  /** Base URL of the services host, only for waking it when it idles. Null where it never does. */
  servicesUrl: (): string | null => optional("SERVICES_URL"),
  /**
   * Where a request-serving process sends bus traffic over HTTPS instead of opening its own
   * NATS connection - for a hosted bus that caps connections account-wide while serverless
   * opens one per instance. Null means talk to the bus directly, which is the normal case.
   */
  busBridgeUrl: (): string | null => optional("BUS_BRIDGE_URL"),
  /** Shared secret between the bridge's two ends; the bridge refuses a call without it. */
  busBridgeToken: (): string | null => optional("BUS_BRIDGE_TOKEN"),
  serviceName: (): string => optional("SERVICE_NAME") ?? "gateway",
  isProduction: (): boolean => process.env["NODE_ENV"] === "production",
  rateLimitInDev: (): boolean => optional("RATE_LIMIT_DEV") === "on",
  /**
   * The plan a development machine names for itself, or null - the normal case - when the
   * answer comes from the billing vendor. Validated against the registry by the billing
   * adapter, which is the only file allowed to have an opinion about what a plan is.
   */
  devPlan: (): string | null => optional("DEV_PLAN"),
  /**
   * The same override for a hosted demo with no billing vendor, where DEV_PLAN is refused
   * because it is production. A separate name on purpose: setting it is a deliberate,
   * logged decision to run a demo, never an accident of copying a dev .env.
   */
  demoPlan: (): string | null => optional("DEMO_PLAN"),
  /** Opt-out for a genuine single-instance deploy with no Upstash. See `ratelimit.ts`. */
  rateLimitAllowInMemory: (): boolean => optional("RATE_LIMIT_ALLOW_IN_MEMORY") === "on",
} as const;
