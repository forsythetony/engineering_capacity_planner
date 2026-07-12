import { useState } from 'react';
import type { WorkItem } from '@ecp/shared';
import { MemberAvatar } from './MemberAvatar';

export interface CardAssignee {
  name: string;
  color: string;
}

interface WorkCardProps {
  item: WorkItem;
  assignee: CardAssignee | null;
  /** `cell` cards fill their column; `bag` cards are fixed-width and wrap. */
  variant: 'cell' | 'bag';
  testId: string;
  onDragStart: (e: React.DragEvent) => void;
}

interface TipPos {
  x: number;
  y: number;
  /** Render below the card (used near the top of the viewport). */
  below: boolean;
}

/**
 * A draggable work-item card for the Gantt board: assignee avatar, key, and
 * points on top; the title truncated to one line below. The full title and
 * metadata surface in a clean custom tooltip on hover — positioned `fixed` off
 * the card's rect so the grid's overflow can't clip it.
 */
export function WorkCard({ item, assignee, variant, testId, onDragStart }: WorkCardProps) {
  const [tip, setTip] = useState<TipPos | null>(null);
  const done = item.status === 'Done';

  const show = (e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect();
    // Flip below the card when it sits too near the top to fit the tooltip.
    const below = r.top < 140;
    setTip({ x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = (): void => setTip(null);

  return (
    <span
      className={`work-card ${variant}${done ? ' done' : ''}`}
      data-testid={testId}
      draggable
      // Set the drag payload only; do NOT mutate state here — hiding the tooltip
      // (a re-render) during `dragstart` makes Chromium cancel the drag. The
      // tooltip is cleared on `dragend` instead.
      onDragStart={onDragStart}
      onDragEnd={hide}
      onMouseEnter={show}
      onMouseLeave={hide}
      aria-label={`${item.key} ${item.title}`}
    >
      <span className="work-card-top">
        {assignee ? (
          <MemberAvatar name={assignee.name} color={assignee.color} size={16} />
        ) : (
          <span className="work-card-unassigned" title="Unassigned" />
        )}
        <strong className="work-card-key">{item.key}</strong>
        <span className="work-card-pts">{item.points}p</span>
      </span>
      <span className="work-card-title">{item.title}</span>

      {tip && (
        <span
          className={`work-tooltip${tip.below ? ' below' : ''}`}
          data-testid="work-card-tooltip"
          style={{ left: tip.x, top: tip.y }}
          role="tooltip"
        >
          <span className="work-tooltip-title">{item.title}</span>
          <span className="work-tooltip-meta">
            {item.key} · {item.points} pts · {item.status}
          </span>
          <span className="work-tooltip-meta">
            {assignee ? `Assignee: ${assignee.name}` : 'Unassigned'}
          </span>
        </span>
      )}
    </span>
  );
}
