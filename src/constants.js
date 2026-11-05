/**
 * Constants for the browser half.
 *
 * Every durable name the plugin owns lives here: routes, localStorage keys,
 * document attributes, slider bounds and the settings identifiers. The host
 * half's route table lives in `host/constants.js`; both halves must agree.
 */

/* ---- routes served by the host half ---- */

/** Lists the background folder's images as JSON. */
export const LIST_URL = '/chat-backgrounds/list'

/** Prefix serving one image's bytes; append the encoded file name. */
export const FILE_URL = '/chat-backgrounds/files/'

/** Reveals the background folder in the platform file manager (POST). */
export const FOLDER_URL = '/chat-backgrounds/folder'

/** All-sessions token aggregation (host caches the scan for ten seconds). */
export const TOKEN_URL = '/chat-backgrounds/token-total'

/**
 * Header the folder route requires; mirrors `FOLDER_HEADER` in
 * `host/constants.js`. It turns the route into a non-simple request, so a
 * cross-site page cannot trigger the file manager (`BG-10`).
 */
export const FOLDER_HEADER = 'x-dsh-chat-background'
export const FOLDER_HEADER_VALUE = '1'

/* ---- localStorage keys ---- */

/** Selected image file name; absent or empty means the plain theme. */
export const SELECTION_KEY = 'dsh-chat-background:selection'

/** `fixed` (one image) or `rotation` (automatic slideshow). */
export const MODE_KEY = 'dsh-chat-background:mode'

/** Seconds between two automatic background changes. */
export const ROTATION_INTERVAL_KEY = 'dsh-chat-background:rotation-interval'

/** Transition length in seconds for one rotation change (0–3s). */
export const ROTATION_DURATION_KEY = 'dsh-chat-background:rotation-duration'

/** `fade`, `fade-through` or `none`. */
export const ROTATION_EFFECT_KEY = 'dsh-chat-background:rotation-effect'

/** JSON array of image names the rotation is limited to. */
export const ROTATION_GROUP_KEY = 'dsh-chat-background:rotation-group'

/** JSON array with the user's explicit image order, independent of selection. */
export const ROTATION_ORDER_KEY = 'dsh-chat-background:rotation-order'
/* Legacy keys from 1.4.x; the per-region sliders read them as the initial
 * fallback so existing users keep their old density. */
export const SCRIM_KEY = 'dsh-chat-background:scrim'
export const VEIL_KEY = 'dsh-chat-background:veil'
export const SCRIM_LEFT_KEY = 'dsh-chat-background:scrim-left'
export const SCRIM_MAIN_KEY = 'dsh-chat-background:scrim-main'
export const SCRIM_RIGHT_KEY = 'dsh-chat-background:scrim-right'
/** Whole main-window veil; the text-card veil keeps SCRIM_MAIN_KEY. */
export const SCRIM_WINDOW_KEY = 'dsh-chat-background:scrim-window'
/** Opt-in switch: store scrim values separately for the light and dark themes. */
export const SCRIM_FOLLOW_THEME_KEY = 'dsh-chat-background:scrim-follow-theme'
export const STRIP_KEY = 'dsh-chat-background:strip'
export const STRIP_COLOR_KEY = 'dsh-chat-background:strip-color'
export const PROGRESS_KEY = 'dsh-chat-background:progress'
export const PROGRESS_COLOR_KEY = 'dsh-chat-background:progress-color'
export const TOKEN_KEY = 'dsh-chat-background:token'
export const TOKEN_SIZE_KEY = 'dsh-chat-background:token-size'

/* ---- document attributes ---- */

/** Present while a background image is applied; its value is the file name. */
export const ACTIVE_ATTRIBUTE = 'data-dsh-chat-background'

/** Marks a container whose opaque background was measured and cleared. */
export const LIFT_ATTRIBUTE = 'data-dsh-chat-background-lift'

/** Marks the sidebar layout column found through `[data-slot="sidebar"]`. */
export const SIDEBAR_COLUMN_ATTRIBUTE = 'data-dsh-chat-background-column'

/** Marks the main conversation column found through `[data-slot="main"]`. */
export const MAIN_COLUMN_ATTRIBUTE = 'data-dsh-chat-background-main'

/** Marks the right sidebar column found through `[data-slot="rightbar"]`. */
export const RIGHT_COLUMN_ATTRIBUTE = 'data-dsh-chat-background-right'

/** Marks the right sidebar panel that can expand to a full-window preview. */
export const RIGHT_PANEL_ATTRIBUTE = 'data-dsh-chat-background-right-panel'

/** Present only while that panel is expanded to the full-window preview. */
export const RIGHT_PANEL_FULL_ATTRIBUTE = 'data-dsh-chat-background-right-panel-full'

/** Marks the centered conversation reading column that owns the turn scrims. */
export const READ_COLUMN_ATTRIBUTE = 'data-dsh-chat-background-read-column'

/** Marks the layout frame whose grid columns shrink when the right sidebar toggles. */
export const LAYOUT_FRAME_ATTRIBUTE = 'data-dsh-chat-background-frame'

/** Present only for the duration of a right-sidebar open/collapse gesture. */
export const FRAME_ANIMATING_ATTRIBUTE = 'data-dsh-chat-background-frame-animating'

/** Present on <html> while the right sidebar is in its fullscreen preview. */
export const RIGHT_FULLSCREEN_ATTRIBUTE = 'data-dsh-chat-background-right-fullscreen'

/** Present briefly while switching fullscreen, to suppress the app's transitions. */
export const NO_ANIMATION_ATTRIBUTE = 'data-dsh-chat-background-no-animation'

/** Fixed full-window layer that paints the background image (animates GIF/WebP). */
export const BACKGROUND_LAYER_ATTRIBUTE = 'data-dsh-chat-background-layer'

/** The bar injected under the composer card. */
export const STRIP_ATTRIBUTE = 'data-dsh-chat-strip'

/** The injected sidebar footer line with the token total. */
export const TOKEN_NODE_ATTRIBUTE = 'data-dsh-token-total'

/* ---- generated stylesheet identities ---- */

/** Own style element carrying every static rule this plugin owns. */
export const CSS_TAG_ID = 'dsh-chat-background/background.css'

/** Own style element carrying the measured painter selectors. */
export const DYNAMIC_TAG_ID = 'dsh-chat-background/measured.css'

/* ---- inline custom properties written to <html> ---- */

/** Properties cleared together when the plugin disposes (`BG-08`). */
export const INLINE_PROPERTIES = [
  '--dsh-chat-background-image',
  '--dsh-chat-background-scrim-left',
  '--dsh-chat-background-scrim-main',
  '--dsh-chat-background-scrim-window',
  '--dsh-chat-background-scrim-right',
  '--dsh-chat-strip-bg',
  '--dsh-progress-color',
  '--dsh-token-size'
]

/* ---- slider bounds and defaults ---- */

/** Per-region scrim opacity, in percent; 0 means no darkening. */
export const SCRIM_MIN = 0
export const SCRIM_MAX = 100
/** The whole main-window veil starts transparent; the text-card veil keeps its
 * legacy default. */
export const SCRIM_WINDOW_DEFAULT = 0
/** Legacy 1.4.x sidebar veil bounds/default, kept as migration fallbacks. */
export const SCRIM_DEFAULT = 58
export const VEIL_MIN = 0
export const VEIL_MAX = 90
export const VEIL_DEFAULT = 45

/** Font size of the token line, in px; 14 matches the account row's label. */
export const TOKEN_SIZE_MIN = 10
export const TOKEN_SIZE_MAX = 20
export const TOKEN_SIZE_DEFAULT = 14

/** Colour defaults; both are only shown and used while nothing is stored. */
export const STRIP_DEFAULT_HEX = '#f2f3f5'
export const PROGRESS_DEFAULT_HEX = '#4176e6'

/** Rotation defaults and bounds. */
export const ROTATION_INTERVAL_MIN = 5
export const ROTATION_INTERVAL_MAX = 300
export const ROTATION_INTERVAL_DEFAULT = 30
export const ROTATION_DURATION_MIN = 0
export const ROTATION_DURATION_MAX = 3
export const ROTATION_DURATION_DEFAULT = 0.6
export const ROTATION_EFFECTS = ['fade', 'fade-through', 'none']
export const ROTATION_EFFECT_DEFAULT = 'fade'

/** Fired after the rotation manager changed the active image. */
export const ROTATION_EVENT = 'dsh-chat-background:selection-changed'

/** Marks the temporary layer used by the rotation transition. */
export const ROTATION_LAYER_ATTRIBUTE = 'data-dsh-chat-background-rotate-layer'

/** The design token the progress fill paints when no colour is stored. */
export const PROGRESS_DEFAULT_TOKEN = '--dsw-alias-brand-primary'

/* ---- polling ---- */

/** The token line refreshes once a minute; the host caches its scan for 10s. */
export const TOKEN_POLL_MS = 60_000

/* ---- settings section identity ---- */

/** The settings section this plugin owns (id also used by the shell). */
export const SECTION_ID = 'chat-background'
export const LOCALE_NS = 'chat-background'

/** Sits below General (0) and above Models (10) in the settings navigation. */
export const SECTION_ORDER = 5

/** The composer dock row; 12 avoids both the host GoalDock and the queue row. */
export const PROGRESS_DOCK_ORDER = 12

/* ---- accepted image extensions ---- */

/**
 * Mirrors `MEDIA_TYPES` in `host/media.js`. The settings value read back from
 * localStorage is only trusted when it names one of these types, so tampered
 * storage cannot turn a selection into an arbitrary URL/CSS fragment.
 */
export const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.apng', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg']
