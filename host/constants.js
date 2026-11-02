/**
 * Route paths, security policy and cache limits shared by the host half.
 *
 * The browser half mirrors the route strings in `src/constants.js`; keep both
 * halves in sync when a route changes.
 */

/** Route namespace owned by this plugin. */
export const ROUTE_ROOT = '/chat-backgrounds'

/** Lists the background folder's images as JSON. */
export const LIST_PATH = `${ROUTE_ROOT}/list`

/** Prefix serving one image's bytes. */
export const FILE_PREFIX = `${ROUTE_ROOT}/files`

/** Reveals the background folder in the platform file manager. */
export const FOLDER_PATH = `${ROUTE_ROOT}/folder`

/**
 * Custom header the folder route requires. The route is public and its side
 * effect opens a window, so requiring a header a cross-site request cannot send
 * without a CORS preflight keeps a random web page from triggering it (`BG-10`).
 * It is one layer of the request fence, not the fence itself (`SEC-02`).
 */
export const FOLDER_HEADER = 'x-dsh-chat-background'
export const FOLDER_HEADER_VALUE = '1'

/** Aggregated token usage over every cached session projection. */
export const TOKEN_PATH = `${ROUTE_ROOT}/token-total`

/** Read-only self-report: version, limits, data source and fence mode. */
export const HEALTH_PATH = `${ROUTE_ROOT}/health`

/**
 * Comma-separated extra request hostnames accepted by the request fence; `*`
 * disables the host check. Loopback names plus the Web server's own origin are
 * always accepted. Set this only for a remote-access proxy that rewrites Host.
 */
export const TRUSTED_HOSTS_ENV = 'DSH_CHAT_BACKGROUND_ALLOWED_HOSTS'

/**
 * Cache policy for image bytes.
 *
 * The URL carries no content revision, and a user may overwrite one image with
 * another of the same name (the folder is theirs), so the response must
 * revalidate: an `immutable` one-year cache would keep painting the old picture
 * until a manual browser cache clear. `private` keeps the user's own pictures
 * out of shared caches (`SEC-06`).
 */
export const IMAGE_CACHE_CONTROL = 'private, max-age=0, must-revalidate'

/** How long the token aggregation may be reused while the browser polls. */
export const TOKEN_CACHE_MS = 10_000

/** How long one directory listing may be reused by `list` and `files`. */
export const MANIFEST_CACHE_MS = 1_000

/**
 * Resource limits. A background folder is a user-owned local directory, but the
 * routes are reachable from the browser, so both scanning and serving are
 * bounded (`SEC-08`).
 */
export const MAX_MANIFEST_ENTRIES = 500
export const MAX_MANIFEST_SCAN = 5_000
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024
export const MAX_TOKEN_FILES = 5_000

/**
 * Headers applied to every response. The routes are same-origin resources; they
 * must never be sniffed into another type, embedded by another origin, or leak
 * the application URL through `Referer` (`SEC-06`).
 */
export const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer'
})

/**
 * Response policy for images that browsers may also open as a top-level
 * document (SVG is the only accepted active format). `sandbox` gives the
 * document a unique opaque origin and `default-src 'none'` blocks subresources;
 * scripts therefore cannot run in the DSH origin (`SEC-01`). As an image
 * subresource (CSS background / `<img>`) the document policy is not applied.
 */
export const IMAGE_DOCUMENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
