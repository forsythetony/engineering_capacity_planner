import { describe, expect, it } from 'vitest';
import { colorFor, MEMBER_PALETTE, memberColorMap, memberInitials } from '../src/lib/memberColors';

const members = (ids: string[]) => ids.map((id) => ({ id }));

describe('memberColorMap', () => {
  it('gives the first eight members distinct palette colors', () => {
    const map = memberColorMap(members(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']));
    const colors = [...map.values()];
    expect(new Set(colors).size).toBe(8);
    expect(colors.every((c) => (MEMBER_PALETTE as readonly string[]).includes(c))).toBe(true);
  });

  it('is stable regardless of input order', () => {
    const a = memberColorMap(members(['M1', 'M2', 'M3']));
    const b = memberColorMap(members(['M3', 'M1', 'M2']));
    expect(a.get('M2')).toBe(b.get('M2'));
    expect(a.get('M1')).toBe(b.get('M1'));
  });

  it('sorts ids numerically so M10 follows M9', () => {
    const map = memberColorMap(members(['M9', 'M10']));
    // M9 sorts before M10 → gets slot 0.
    expect(map.get('M9')).toBe(MEMBER_PALETTE[0]);
    expect(map.get('M10')).toBe(MEMBER_PALETTE[1]);
  });

  it('cycles the palette past eight members', () => {
    const map = memberColorMap(members(Array.from({ length: 9 }, (_, i) => `M${i + 1}`)));
    expect(map.get('M9')).toBe(MEMBER_PALETTE[8 % MEMBER_PALETTE.length]);
  });
});

describe('colorFor', () => {
  it('returns the mapped color or a neutral fallback', () => {
    const map = memberColorMap(members(['M1']));
    expect(colorFor(map, 'M1')).toBe(MEMBER_PALETTE[0]);
    expect(colorFor(map, null)).toBe('#6b7280');
    expect(colorFor(map, 'ghost')).toBe('#6b7280');
  });
});

describe('memberInitials', () => {
  it('uses first + last initials for multi-word names', () => {
    expect(memberInitials('Alfie Zhang')).toBe('AZ');
    expect(memberInitials('Mary Jane Watson')).toBe('MW');
  });

  it('uses the first two letters for a single name', () => {
    expect(memberInitials('Ada')).toBe('AD');
    expect(memberInitials('Bo')).toBe('BO');
  });

  it('handles extra whitespace and empties', () => {
    expect(memberInitials('  Chen  ')).toBe('CH');
    expect(memberInitials('')).toBe('?');
  });
});
