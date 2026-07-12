import type { WorkItem } from '@ecp/shared';
import type { EpicScope, Scenario } from '../lib/projection';

interface WorkItemListProps {
  scope: EpicScope;
  scenario: Scenario;
  onToggleCut: (key: string) => void;
  onToggleDone: (key: string) => void;
}

/**
 * The epic's backlog, grouped by story. Each row can be cut (removed from the
 * plan) or marked done — both re-run the projection live via the parent.
 */
export function WorkItemList({ scope, scenario, onToggleCut, onToggleDone }: WorkItemListProps) {
  const byStory = new Map<string, WorkItem[]>();
  for (const item of scope.workItems) {
    const list = byStory.get(item.storyKey) ?? [];
    list.push(item);
    byStory.set(item.storyKey, list);
  }

  return (
    <div data-testid="work-items">
      <div className="section-title">
        <h2>Backlog</h2>
        <span className="hint">Cut a ticket or mark it done to see the timeline move.</span>
      </div>

      {scope.stories.map((story) => {
        const items = byStory.get(story.key) ?? [];
        if (items.length === 0) return null;
        return (
          <div className="story-group" key={story.key}>
            <div className="story-head">{story.title}</div>
            {items.map((item) => {
              const isCut = scenario.cutItemKeys.has(item.key);
              const isDone = scenario.doneItemKeys.has(item.key) || item.status === 'Done';
              return (
                <div
                  className={`work-item${isCut ? ' cut' : ''}`}
                  key={item.key}
                  data-testid={`work-item-${item.key}`}
                >
                  <span>
                    <strong>{item.key}</strong> {item.title}
                  </span>
                  <span className="points">{item.points} pt</span>
                  <span className={`badge${isDone ? ' done' : ''}`}>
                    {isCut ? 'cut' : isDone ? 'Done' : item.status}
                  </span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="link-btn"
                      data-testid={`toggle-done-${item.key}`}
                      onClick={() => onToggleDone(item.key)}
                    >
                      {scenario.doneItemKeys.has(item.key) ? 'undo done' : 'mark done'}
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      data-testid={`toggle-cut-${item.key}`}
                      onClick={() => onToggleCut(item.key)}
                    >
                      {isCut ? 'restore' : 'cut'}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
