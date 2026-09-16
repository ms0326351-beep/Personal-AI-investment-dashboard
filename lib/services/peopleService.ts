import { peopleRegistry as people } from '@/lib/data/peopleRegistry';
import { personEvents, peopleDate, peopleTime } from '@/lib/mock/people';
import type { KeyPerson, PersonEvent, PeopleSnapshot } from '@/lib/types/people';
export interface PeopleService {
  getPeople(): Promise<KeyPerson[]>;
  getPersonEvents(id: string): Promise<PersonEvent[]>;
  getSnapshot(): Promise<PeopleSnapshot>;
}
const eventsFor = (id: string) => personEvents.filter(e => e.personId === id).sort((a,b) => Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
export const mockPeopleService: PeopleService = {
  async getPeople() { return people.map(p => ({...p, currentImpactLevel: eventsFor(p.id)[0]?.impactLevel ?? 'low'})); },
  async getPersonEvents(id) { return eventsFor(id); },
  async getSnapshot() { const all = await this.getPeople(); return {date:peopleDate,time:peopleTime,summaries:all.map(person=>({person,latestEvent:eventsFor(person.id)[0] ?? null}))}; },
};
export const peopleService: PeopleService = mockPeopleService;
