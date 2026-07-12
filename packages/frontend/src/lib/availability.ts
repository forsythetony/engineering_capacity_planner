import type { DomainDataset, IsoDate, TeamMember } from '@ecp/shared';
import { colorFor } from './memberColors';

/** The three kinds of availability the config edits. */
export type AvailabilityKind = 'pto' | 'oncall' | 'velocity';

export const KIND_LABEL: Record<AvailabilityKind, string> = {
  pto: 'PTO',
  oncall: 'On-call',
  velocity: 'Velocity',
};

/** A single availability item, normalised across the three underlying tables. */
export interface AvailabilityEntry {
  id: string;
  kind: AvailabilityKind;
  memberId: string;
  memberName: string;
  color: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Present for velocity overrides only. */
  multiplier?: number;
}

/**
 * Flatten PTO, on-call, and velocity overrides for one team's members into a
 * single, color-tagged list sorted by start date — the shape the calendar and
 * list views both consume.
 */
export function buildAvailabilityEntries(
  dataset: DomainDataset,
  members: readonly TeamMember[],
  colors: Map<string, string>,
): AvailabilityEntry[] {
  const memberIds = new Set(members.map((m) => m.id));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? '—';

  const entries: AvailabilityEntry[] = [];
  for (const p of dataset.pto) {
    if (!memberIds.has(p.memberId)) continue;
    entries.push({
      id: p.id,
      kind: 'pto',
      memberId: p.memberId,
      memberName: nameOf(p.memberId),
      color: colorFor(colors, p.memberId),
      startDate: p.startDate,
      endDate: p.endDate,
    });
  }
  for (const o of dataset.oncall) {
    if (!memberIds.has(o.memberId)) continue;
    entries.push({
      id: o.id,
      kind: 'oncall',
      memberId: o.memberId,
      memberName: nameOf(o.memberId),
      color: colorFor(colors, o.memberId),
      startDate: o.startDate,
      endDate: o.endDate,
    });
  }
  for (const v of dataset.velocityOverrides) {
    if (!memberIds.has(v.memberId)) continue;
    entries.push({
      id: v.id,
      kind: 'velocity',
      memberId: v.memberId,
      memberName: nameOf(v.memberId),
      color: colorFor(colors, v.memberId),
      startDate: v.startDate,
      endDate: v.endDate,
      multiplier: v.multiplier,
    });
  }

  return entries.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.memberName.localeCompare(b.memberName));
}
