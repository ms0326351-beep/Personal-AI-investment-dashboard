import type { ExposureDataset } from '../types/exposure';
import { validateExposureDataset } from '../utils/exposureValidation';

export interface ExposureRepository { getSnapshot(): Promise<ExposureDataset> }
/** Inject reviewed data. No built-in invented relationships, network, AI or private positions. */
export function createExposureRepository(dataset: ExposureDataset): ExposureRepository {
  validateExposureDataset(dataset);
  const snapshot=structuredClone(dataset);
  return {async getSnapshot() { return structuredClone(snapshot); }};
}
