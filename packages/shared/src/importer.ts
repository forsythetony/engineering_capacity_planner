import type { DomainDataset } from './domain.js';

/**
 * The single contract every data source implements (project plan §7).
 *
 * The {@link SyntheticImporter} implements it today; a `JiraImporter` will
 * implement the same interface later using the field-mapping settings, with
 * zero changes required in the engine, timeline, or graph.
 *
 * `fetch()` is async so real network-backed importers (Jira) fit the same
 * shape; the synthetic importer simply resolves immediately.
 */
export interface Importer {
  /** Stable identifier for the source, e.g. `"synthetic"` or `"jira"`. */
  readonly name: string;
  /** Produce a complete, self-consistent {@link DomainDataset}. */
  fetch(): Promise<DomainDataset>;
}
