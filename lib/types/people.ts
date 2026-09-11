export type ImpactDirection = 'bullish' | 'bearish' | 'neutral';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type PersonCategory = 'us_politics' | 'central_bank' | 'tw_politics' | 'regulator' | 'corporate_leader';
export interface KeyPerson {
  id: string;
  name: string;
  title: string;
  organization: string;
  category: PersonCategory;
  relatedSymbols: string[];
  currentImpactLevel: ImpactLevel;
}
export interface PersonEvent {
  id: string;
  personId: string;
  occurredAt: string;
  headline: string;
  impactDirection: ImpactDirection;
  impactLevel: ImpactLevel;
  affectedMarkets: string[];
  affectedSymbols: string[];
}
export interface DayTimelineEntry {
  id: string;
  time: string;
  label: string;
  category: 'market_open' | 'economic_data' | 'fed_speech' | 'earnings' | 'policy';
  importance: ImpactLevel;
  relatedPersonIds: string[];
  relatedSymbols: string[];
  impactReason: string;
}
export interface PersonSummary { person: KeyPerson; latestEvent: PersonEvent | null }
export interface PeopleSnapshot { date: string; time: string; summaries: PersonSummary[] }
