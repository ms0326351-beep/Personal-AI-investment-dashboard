import type { ExposureDataset } from '../types/exposure';
import { DEMAND_KINDS, NEWS_RELATION_TYPES, type NewsExposureCatalog, type NewsExposureEvent } from '../types/newsExposure';
import { validDate, validateExposureDataset } from './exposureValidation';

const check=(ok:boolean,field:string)=>{if(!ok) throw new Error(`Invalid news exposure: ${field}`);};
const nonempty=(s:string)=>typeof s==='string' && s.trim().length>0;
export function validateNewsExposureCatalog(catalog:NewsExposureCatalog,foundation:ExposureDataset) {
  validateExposureDataset(foundation);
  check(nonempty(catalog.version),'version');
  const ids=new Set(foundation.entities.map(e=>e.id)), bindings=new Set<string>();
  const aliasOwners=new Map<string,string>();
  const edges=new Map(foundation.relationships.map(e=>[e.id,e]));
  const sources=new Set(foundation.sources.map(s=>s.id)), evidence=new Map(foundation.evidence.map(e=>[e.id,e]));
  for(const b of catalog.bindings) {
    check(ids.has(b.entityId) && !bindings.has(b.entityId) && b.aliases.length>0 && b.aliases.every(nonempty),'entity binding'); bindings.add(b.entityId);
    for(const alias of b.aliases) {
      const key=alias.trim().toLowerCase();
      check(!aliasOwners.has(key) || aliasOwners.get(key)===b.entityId,'ambiguous alias');aliasOwners.set(key,b.entityId);
    }
  }
  for(const r of catalog.rules) {
    check(edges.has(r.relationshipId),'relationship reference');
    check(['forward','reverse'].includes(r.traversal) && NEWS_RELATION_TYPES.includes(r.relationshipType),'traversal/type');
    if(['supplier_to_customer','customer_to_supplier'].includes(r.relationshipType)) {
      const edge=edges.get(r.relationshipId)!;
      const supplierToCustomer=(edge.type==='SUPPLIES' && r.traversal==='forward') || (edge.type==='CUSTOMER_OF' && r.traversal==='reverse');
      check(['SUPPLIES','CUSTOMER_OF'].includes(edge.type) && (r.relationshipType==='supplier_to_customer')===supplierToCustomer,'supplier direction mismatch');
    }
    check(!['ETF_holding','portfolio_holding'].includes(r.relationshipType),'ownership must use look-through');
    check(['same','opposite','mixed','unknown'].includes(r.sensitivity),'sensitivity');
    check(['high','medium','low','unknown'].includes(r.confidence),'confidence');
    check(nonempty(r.rationale) && validDate(r.asOf) && r.invalidationConditions.length>0 && r.invalidationConditions.every(nonempty),'rule metadata');
    check(r.sourceIds.every(id=>sources.has(id)) && r.evidenceIds.every(id=>evidence.has(id) && r.sourceIds.includes(evidence.get(id)!.sourceId)),'rule evidence');
    if(r.scenario) check(nonempty(r.scenario.condition) && DEMAND_KINDS.includes(r.scenario.demandKind),'scenario');
  }
}
export function validateNewsExposureEvent(event:NewsExposureEvent) {
  check(nonempty(event.news.id) && validDate(event.news.publishedAt) && validDate(event.observedAt) && Date.parse(event.observedAt)>=Date.parse(event.news.publishedAt),'news metadata');
  for(const a of event.anchors) check(nonempty(a.entityId) && nonempty(a.mention) && ['positive','negative','mixed','uncertain'].includes(a.direction) && ['high','medium','low','unknown'].includes(a.confidence),'anchor');
  if(event.scenario) check(nonempty(event.scenario.condition) && DEMAND_KINDS.includes(event.scenario.demandKind),'event scenario');
}
