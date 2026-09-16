import type { NewsItem } from '@/lib/types';

/** Keep the existing whole-pool fallback decision independently testable. */
export function selectNewsPool(items: NewsItem[], mockPool: NewsItem[]): NewsItem[] {
  return items.length ? items : mockPool;
}
