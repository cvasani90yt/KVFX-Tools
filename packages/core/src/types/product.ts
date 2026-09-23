/**
 * Product-wide identity and compatibility constants.
 *
 * Nothing in the codebase may hard-code these values inline; magic strings for
 * the bundle id in particular would break packaging and the dev-link tooling.
 */

export const PRODUCT_NAME = "KVFX Tools";

/** CEP ExtensionBundleId. Must match cep/CSXS/manifest.xml. */
export const EXTENSION_BUNDLE_ID = "com.kvfx.tools";

/** CEP Extension Id of the main panel. Must match cep/CSXS/manifest.xml. */
export const PANEL_EXTENSION_ID = "com.kvfx.tools.panel";

/** Directory name used under the platform application-data root. */
export const USER_DATA_DIRNAME = "KVFXTools";

/** Product version. Single source of truth; packaging reads this. */
export const PRODUCT_VERSION = "0.1.0-dev";

/**
 * Minimum After Effects version the product supports at all.
 *
 * AE 22.0 introduced `Layer.id` and `Project.layerByID()`, which ADR-0004 makes
 * the basis of every object reference crossing the bridge. Below that version
 * the architecture has no safe way to address objects, so we do not degrade —
 * we decline to run.
 */
export const MIN_AE_VERSION = "22.0";

/** The release this product is actively developed and tested against. */
export const TARGET_AE_VERSION = "26.0";
