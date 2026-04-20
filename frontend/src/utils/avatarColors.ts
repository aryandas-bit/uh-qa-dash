// Deterministic pastel colors for letter avatars.
// Each letter A-Z maps to a distinct hue around the color wheel, so
// "Aditi" always gets the same soft color and "Shrishty" gets a different one.

const HUE_STEPS = 26; // A-Z
const TOTAL_HUES = 360;

function hueForLetter(letter: string): number {
  const ch = (letter || '?').toUpperCase().charCodeAt(0);
  // Clamp to A-Z range, fall back to a neutral slot for non-letters
  const idx = ch >= 65 && ch <= 90 ? ch - 65 : 25;
  // Slight phase offset so "A" isn't pure red — start at 210 (blue-ish) and wrap
  return (210 + idx * (TOTAL_HUES / HUE_STEPS)) % TOTAL_HUES;
}

export function getAvatarColor(name: string): { bg: string; fg: string } {
  const firstChar = (name || '').trim().charAt(0);
  const hue = hueForLetter(firstChar);
  return {
    bg: `hsl(${hue}, 70%, 88%)`,
    fg: `hsl(${hue}, 55%, 32%)`,
  };
}

export function getAvatarInitial(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}
