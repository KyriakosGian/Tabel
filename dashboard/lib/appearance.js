export const APPEARANCE_DEFAULTS = Object.freeze({
  theme: 'system',
  density: 'comfortable',
  defaultGroupWidth: 50,
  tabUrlMode: 'hidden',
  fontScale: 100,
  faviconSize: 16,
  customCardOpacity: 75
});

const VALID_THEMES = new Set(['system', 'dark', 'light']);
const VALID_DENSITIES = new Set(['comfortable', 'compact', 'ultraCompact']);
const VALID_URL_MODES = new Set(['hidden', 'domain', 'full']);
const VALID_GROUP_WIDTHS = new Set([33, 50, 100]);

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function normalizeAppearance(settings = {}) {
  const normalized = {
    ...APPEARANCE_DEFAULTS,
    ...settings
  };

  if (!VALID_THEMES.has(normalized.theme)) {
    normalized.theme = APPEARANCE_DEFAULTS.theme;
  }
  if (!VALID_DENSITIES.has(normalized.density)) {
    normalized.density = APPEARANCE_DEFAULTS.density;
  }
  if (!VALID_URL_MODES.has(normalized.tabUrlMode)) {
    normalized.tabUrlMode = APPEARANCE_DEFAULTS.tabUrlMode;
  }

  normalized.defaultGroupWidth = Number(normalized.defaultGroupWidth);
  if (!VALID_GROUP_WIDTHS.has(normalized.defaultGroupWidth)) {
    normalized.defaultGroupWidth = APPEARANCE_DEFAULTS.defaultGroupWidth;
  }

  normalized.fontScale = clampNumber(
    normalized.fontScale,
    85,
    125,
    APPEARANCE_DEFAULTS.fontScale
  );
  normalized.faviconSize = clampNumber(
    normalized.faviconSize,
    12,
    28,
    APPEARANCE_DEFAULTS.faviconSize
  );
  normalized.customCardOpacity = clampNumber(
    normalized.customCardOpacity,
    10,
    100,
    APPEARANCE_DEFAULTS.customCardOpacity
  );

  return normalized;
}

export function resolveTheme(theme, prefersLight = false) {
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';
  return prefersLight ? 'light' : 'dark';
}

export function applyAppearance(root, settings, prefersLight = false) {
  if (!root) return normalizeAppearance(settings);

  const appearance = normalizeAppearance(settings);
  const resolvedTheme = resolveTheme(appearance.theme, prefersLight);

  root.classList.toggle('theme-light', resolvedTheme === 'light');
  root.classList.toggle('theme-dark', resolvedTheme === 'dark');
  root.dataset.theme = appearance.theme;
  root.dataset.density = appearance.density;
  root.dataset.tabUrlMode = appearance.tabUrlMode;

  root.style.setProperty('--font-scale', (appearance.fontScale / 100).toFixed(2));
  root.style.setProperty('--favicon-size', `${appearance.faviconSize}px`);
  const scale = appearance.fontScale / 100;
  const fontSizes = {
    xs: 11,
    sm: 13,
    md: 14,
    lg: 16,
    xl: 20,
    '2xl': 28,
    '3xl': 36
  };
  for (const [name, pixels] of Object.entries(fontSizes)) {
    root.style.setProperty(`--font-size-${name}`, `${(pixels * scale).toFixed(2)}px`);
  }

  const opacity = appearance.customCardOpacity / 100;
  root.style.setProperty('--custom-card-opacity', opacity.toFixed(2));
  root.style.setProperty('--custom-glass-opacity', Math.max(0.1, opacity - 0.1).toFixed(2));

  return appearance;
}
