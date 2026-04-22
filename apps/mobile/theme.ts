export type ThemeColors = {
  bg: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentSurface: string;
  accentBorder: string;
  /** Pill background for header / toolbar icon buttons (matches dashboard). */
  headerIconCircleBg: string;
  success: string;
  softFilter: {
    triggerBg: string;
    triggerBorder: string;
    triggerText: string;
    triggerPlaceholder: string;
    panelBg: string;
    panelBorder: string;
    accent: string;
    accentLight: string;
    itemText: string;
    itemMuted: string;
    selectedBg: string;
    selectedText: string;
    backdrop: string;
    shadow: string;
  };
};

export const lightColors: ThemeColors = {
  bg: "#f8fafc",
  card: "#ffffff",
  textPrimary: "#111111",
  textSecondary: "#8a8a8e",
  border: "#ececec",
  /** Primary actions, links, tab bar active, checkmarks, primary buttons. */
  accent: "#2563eb",
  /** Selected row / chip backgrounds paired with `accent` borders. */
  accentSurface: "#eff6ff",
  /** Softer border on accent-tinted surfaces (e.g. filter chips). */
  accentBorder: "#bfdbfe",
  headerIconCircleBg: "#f1f5f9",
  success: "#16a34a",
  /**
   * Search + filter dropdowns (blue-aligned with app accent).
   */
  softFilter: {
    triggerBg: "#eff6ff",
    triggerBorder: "#bfdbfe",
    triggerText: "#1e3a8a",
    triggerPlaceholder: "#9ca3af",
    panelBg: "#ffffff",
    panelBorder: "#dbeafe",
    accent: "#2563eb",
    accentLight: "#3b82f6",
    itemText: "#1e293b",
    itemMuted: "#64748b",
    selectedBg: "#dbeafe",
    selectedText: "#1d4ed8",
    backdrop: "rgba(15, 23, 42, 0.18)",
    shadow: "rgba(37, 99, 235, 0.12)",
  },
} as const;

export const darkColors: ThemeColors = {
  bg: "#0b1220",
  card: "#111827",
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  border: "#1f2937",
  accent: "#60a5fa",
  accentSurface: "#0f172a",
  accentBorder: "#1e3a8a",
  headerIconCircleBg: "#1e293b",
  success: "#4ade80",
  softFilter: {
    triggerBg: "#172554",
    triggerBorder: "#1d4ed8",
    triggerText: "#dbeafe",
    triggerPlaceholder: "#94a3b8",
    panelBg: "#111827",
    panelBorder: "#1f2937",
    accent: "#60a5fa",
    accentLight: "#93c5fd",
    itemText: "#e2e8f0",
    itemMuted: "#94a3b8",
    selectedBg: "#1e3a8a",
    selectedText: "#dbeafe",
    backdrop: "rgba(15, 23, 42, 0.5)",
    shadow: "rgba(0, 0, 0, 0.4)",
  },
} as const;

/** Backward-compatible default for existing screens not yet theme-context-aware. */
export const colors = lightColors;

/**
 * Corner radius scale.
 * Prefer `card` / `sm` for cards, tiles, and list surfaces; reserve `lg` / `xl` for large heroes or modals.
 */
export const radius = {
  /** Chips, tags, tight inner controls. */
  xs: 4,
  /** Search fields, compact inputs (dashboard + toolbars). */
  input: 14,
  /** Horizontal tag chips on dashboard home. */
  chip: 9,
  /** Filter trigger buttons beside search. */
  filterTrigger: 12,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
  /** Default for standard cards and bordered blocks (subtle corners). */
  card: 6,
  /** Soft dropdown triggers and floating panels. */
  softDropdown: 14,
  softDropdownLg: 16,
} as const;

// Mobile typography scale (aligned with iOS HIG + Material baseline).
export const type = {
  display: { size: 36, lineHeight: 42, weight: "700" as const, letterSpacing: -0.8 },
  /**
   * Tab roots and primary list headers — icon tap targets use `sizes.headerIconButton`.
   */
  pageTitle: { size: 28, lineHeight: 32, weight: "700" as const, letterSpacing: -0.3 },
  /** Section titles, compact nav (e.g. member detail top bar), card titles on grids. */
  h1: { size: 18, lineHeight: 24, weight: "700" as const, letterSpacing: -0.2 },
  h2: { size: 18, lineHeight: 24, weight: "700" as const, letterSpacing: -0.2 },
  title: { size: 18, lineHeight: 24, weight: "700" as const, letterSpacing: -0.2 },
  subtitle: { size: 18, lineHeight: 24, weight: "600" as const, letterSpacing: 0 },
  body: { size: 16, lineHeight: 22, weight: "400" as const, letterSpacing: 0 },
  bodyStrong: { size: 16, lineHeight: 22, weight: "600" as const, letterSpacing: 0 },
  caption: { size: 14, lineHeight: 18, weight: "500" as const, letterSpacing: 0 },
  overline: { size: 13, lineHeight: 16, weight: "600" as const, letterSpacing: 0.2 },
  tabLabel: { size: 13, lineHeight: 16, weight: "600" as const, letterSpacing: 0 },
} as const;

export const sizes = {
  headerAvatar: 34,
  /** Minimum touch area for header / toolbar icon buttons (≈48pt). */
  headerIconButton: 48,
  /** Top bars, stack headers, modal title rows — 24×24 dp icon glyphs inside 48pt tap targets. */
  headerIcon: 24,
  /** Bottom tab bar icons (slightly larger than `headerIcon` for legibility). */
  tabBarIcon: 17,
  headerBadge: 15,
  tabBarHeight: 72,
} as const;
