import type { DomainDataset } from '@ecp/shared';
import fixture from '../fixtures/dataset.json';

/**
 * Load the dataset the UI operates on.
 *
 * Today this returns a bundled synthetic fixture so the app runs with zero
 * setup (and is e2e-testable without a backend). This function is the single
 * seam to swap in a live API fetch (`GET /api/dataset`) later — the rest of the
 * UI only depends on the returned {@link DomainDataset}.
 */
export function loadDataset(): DomainDataset {
  return fixture as DomainDataset;
}
