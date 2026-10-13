/**
 * Feature flags for modules that aren't live yet (build-time: set VITE_FEATURE_<NAME>=true to show one).
 *
 * smartSwitch (audit F-17b): SmartSwitch rules are stored, but no engine evaluates them — a rule has
 * no threshold to act on — so the module is hidden by default rather than implying it optimizes
 * traffic. Its data and API are kept; turning the flag on shows the page (which says rules don't run).
 */
export const FEATURES = {
  smartSwitch: import.meta.env.VITE_FEATURE_SMARTSWITCH === 'true',
} as const;
