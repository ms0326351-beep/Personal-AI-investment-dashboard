import type { PublicIntelligenceDataset, TrackedEntity, Provenance } from '../types/publicIntelligence';
import { validatePublicDataset } from '../utils/publicIntelligenceValidation';
import { peopleRegistry } from '../data/peopleRegistry';

/** These are catalog labels, not externally verified affiliations or holdings. */
export const legacyProvenance = ():Provenance => ({source:'既有人物目錄（lib/data/peopleRegistry.ts）',sourceType:'legacy_registry',sourceUrl:null,filingReference:null,reportedAt:null,filedAt:null,asOfDate:null,knownAt:null,lastVerifiedAt:null,evidence:[],confidence:'unknown',coverage:'UNKNOWN',verification:'unverified',freshness:'unknown',origin:'legacy'});
// Stable, reversible organization IDs; no inference based on similar names.
const organizationId=(name:string)=>`org-${Array.from(name).map(c=>c.codePointAt(0)!.toString(16)).join('-')}`;
export function adaptPeopleRegistry(registry:typeof peopleRegistry):PublicIntelligenceDataset {
  const data:PublicIntelligenceDataset={version:1,entities:[],relationships:[],activities:[]};
  const organizations=new Set<string>();
  for(const p of registry) {
    const person:TrackedEntity={id:p.id,name:p.name,entityType:p.aliases.length?'person':'unresolved',roles:p.aliases.length?[p.category==='corporate_leader'?'executive':'policy_official']:[],avatar:null,description:'沿用既有目錄；職務、所屬與關聯標的尚未在本模組獨立驗證，不代表任何持倉。',roleLabel:p.title,organizationLabel:p.organization,externalIds:[],lastUpdated:null,provenance:legacyProvenance()};
    data.entities.push(person);
    if(p.organization) {
      const orgId=organizationId(p.organization);
      if(!organizations.has(orgId)) {
        organizations.add(orgId);
        data.entities.push({id:orgId,name:p.organization,entityType:'institution',roles:[],avatar:null,description:'由既有目錄的機構名稱建立追蹤入口；不代表已確認法人身分、申報人或投資機構。',roleLabel:'機構目錄項目（待核對）',organizationLabel:null,externalIds:[],lastUpdated:null,provenance:legacyProvenance()});
      }
      data.relationships.push({id:`affiliation:${p.id}`,sourceId:p.id,target:{kind:'entity',id:orgId},type:'affiliation',validFrom:null,validTo:null,provenance:legacyProvenance()});
    }
    for(const ticker of p.relatedSymbols) data.relationships.push({id:`legacy:${p.id}:${ticker}`,sourceId:p.id,target:{kind:'security',id:`legacy-symbol:${ticker}`,ticker,market:null},type:'legacy_association',validFrom:null,validTo:null,provenance:legacyProvenance()});
  }
  return data;
}
export function createPublicIntelligenceRepository(input:PublicIntelligenceDataset) {
  validatePublicDataset(input);const data=structuredClone(input);
  return {
    async getSnapshot() {return structuredClone(data);},
    async getEntity(id:string) {return structuredClone(data.entities.find(e=>e.id===id) ?? null);},
    /** Only explicit participants; never inherit employer/manager activity. */
    async getActivities(id:string) {return structuredClone(data.activities.filter(a=>a.participants.some(p=>p.entityId===id)));},
  };
}
export const publicIntelligenceRepository=createPublicIntelligenceRepository(adaptPeopleRegistry(peopleRegistry));
