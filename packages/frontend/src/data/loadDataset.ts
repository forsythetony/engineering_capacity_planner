import type { DomainDataset } from '@ecp/shared';
import fixture from '../fixtures/dataset.json';

/** Where the dataset came from, surfaced in the UI so the wiring is visible. */
export type DatasetSource = 'api' | 'bundled';

export interface LoadedDataset {
  dataset: DomainDataset;
  source: DatasetSource;
}

/** The API path the UI fetches. In dev, Vite proxies `/api` to the backend. */
const DATASET_URL = `${import.meta.env.VITE_API_BASE ?? ''}/api/dataset`;

/** The bundled synthetic fixture — used as an offline fallback and in tests. */
export function loadBundledDataset(): DomainDataset {
  return fixture as DomainDataset;
}

function looksLikeDataset(value: unknown): value is DomainDataset {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as DomainDataset).epics) &&
    (value as DomainDataset).epics.length > 0
  );
}

/**
 * Load the dataset the UI operates on: prefer the live backend API, and fall
 * back to the bundled synthetic fixture when the API isn't reachable (so the
 * app still runs — and e2e still passes — with no backend).
 */
export async function loadDataset(): Promise<LoadedDataset> {
  try {
    const res = await fetch(DATASET_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data: unknown = await res.json();
      if (looksLikeDataset(data)) return { dataset: data, source: 'api' };
    }
  } catch {
    // Backend not running / unreachable — fall through to the bundled sample.
  }
  return { dataset: loadBundledDataset(), source: 'bundled' };
}
