import type { DataStatus } from './exposure';

/** Presentation DTO only. The server engine remains the authority for all calculations. */
export interface IntelligenceMetric { label: string; value: string }
export interface IntelligenceStep {
  from: string; to: string; relationship: string; basis: string; confidence: string;
  date: string; evidence: string[]; sources: { title: string; url: string; date: string }[];
  conditions: string[];
}
export interface IntelligencePath {
  id: string; order: string; confidence: string; coverage: string; scenario: string[];
  steps: IntelligenceStep[];
}
export interface IntelligenceCard {
  id: string; title: string; symbol: string; status: DataStatus; badges: string[];
  metrics: IntelligenceMetric[]; paths: IntelligencePath[];
}
export interface IntelligenceGroup {
  title: string; status: DataStatus; note: string; metrics: IntelligenceMetric[];
}
export interface PortfolioIntelligenceView {
  version: 1; newsId: string | null; status: DataStatus; asOf: string;
  notes: string[]; holdings: IntelligenceCard[]; higherOrder: IntelligencePath[];
  groups: IntelligenceGroup[];
}
