import type { Currency } from './index';
export type FxSnapshot = Record<Currency,number> & {source:'yahoo'|'mock';updatedAt:string|null;stale:boolean;fallbackReason?:string};
