import type { TeamMember } from '@ecp/shared';

/**
 * Per-member identity colors, reusable across the app (availability calendar,
 * member list, and — in future — graph/backlog assignees).
 *
 * The palette is the data-viz skill's validated categorical set, stepped for a
 * dark surface (worst adjacent CVD ΔE 10.3 — the floor band, which is why every
 * use pairs the color with a secondary encoding: initials on the avatar, the
 * member's name in the list). Colors are assigned by a stable sort of member
 * ids, so the same member always gets the same hue everywhere and the first
 * eight members are guaranteed distinct.
 */
export const MEMBER_PALETTE = [
  '#3987e5', // blue
  '#199e70', // aqua
  '#c98500', // yellow
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
  '#d55181', // magenta
  '#d95926', // orange
] as const;

/** Map of member id → hex color, distinct and stable across renders. */
export function memberColorMap(members: readonly Pick<TeamMember, 'id'>[]): Map<string, string> {
  const ids = members.map((m) => m.id).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const map = new Map<string, string>();
  ids.forEach((id, i) => map.set(id, MEMBER_PALETTE[i % MEMBER_PALETTE.length]!));
  return map;
}

/** Look up one member's color, falling back to a neutral gray for unknowns. */
export function colorFor(colors: Map<string, string>, memberId: string | null): string {
  return (memberId && colors.get(memberId)) || '#6b7280';
}

/**
 * Up to two initials for an avatar: first + last word initials for a full name,
 * else the first two letters. Always uppercase.
 */
export function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  return words[0]!.slice(0, 2).toUpperCase();
}
