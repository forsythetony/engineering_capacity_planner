import type { WorkItem } from '@ecp/shared';
import type { EpicScope, Scenario } from '../lib/projection';
import { JiraLink } from './JiraLink';

interface WorkItemListProps {
  scope: EpicScope;
  scenario: Scenario;
}

/** The epic's backlog, grouped by story. */
export function WorkItemList({ scope, scenario }: WorkItemListProps) {
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
        <span className="hint">The epic's remaining work, grouped by story.</span>
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
                    <strong>{item.key}</strong>
                    <JiraLink jiraKey={item.key} />
                    {' '}
                    {item.title}
                  </span>
                  <span className="points">{item.points} pt</span>
                  <span className={`badge${isDone ? ' done' : ''}`}>
                    {isCut ? 'cut' : isDone ? 'Done' : item.status}
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
