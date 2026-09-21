import type { EtfDataset, EtfHoldingsSnapshot, EtfProvenance } from '../types/etfExposure';
import type { ExposureDataset } from '../types/exposure';
import { validDate } from '../utils/exposureValidation';

export interface EtfHoldingsRepository {
  getSnapshot(etfAssetId: string, asOfDate: string, knownAt?: string): Promise<EtfHoldingsSnapshot | null>;
  getHistory(etfAssetId: string): Promise<EtfHoldingsSnapshot[]>;
}
export const holdingFraction=(holding:EtfHoldingsSnapshot['holdings'][number])=>holding.weight===null?null:holding.weight/(holding.weightUnit==='percent'?100:1);
const check=(ok:boolean,message:string)=>{if(!ok) throw new Error(`Invalid ETF data: ${message}`);};
export function validateEtfDataset(data:EtfDataset,foundation:ExposureDataset):void {
  check(typeof data.version==='string' && data.version.trim().length>0,'version');
  const ids=new Set<string>(), revisions=new Set<string>();
  const entities=new Map(foundation.entities.map(e=>[e.id,e]));
  const sources=new Map(foundation.sources.map(s=>[s.id,s]));
  const evidence=new Map(foundation.evidence.map(e=>[e.id,e]));
  const funds=new Set(data.snapshots.map(s=>s.etfAssetId));
  const provenance=(p:EtfProvenance)=>{
    check(validDate(p.sourceDate) && validDate(p.lastVerifiedAt) && Date.parse(p.lastVerifiedAt)>=Date.parse(p.sourceDate),'provenance dates');
    check(['low','medium','high','unknown'].includes(p.confidence),'confidence');
    check(['reported','calculated','estimated','inferred','unknown'].includes(p.evidenceType) && ['verified','estimated','unknown'].includes(p.dataQuality),'quality');
    check(p.sourceIds.every(id=>sources.has(id)) && p.evidenceIds.every(id=>evidence.has(id) && p.sourceIds.includes(evidence.get(id)!.sourceId)),'evidence/source reference');
  };
  for(const s of data.snapshots) {
    check(s.id.trim().length>0 && !ids.has(s.id),'duplicate snapshot ID'); ids.add(s.id);
    check(entities.get(s.etfAssetId)?.kind==='Asset','ETF asset');
    check(validDate(s.asOfDate) && Date.parse(s.asOfDate)<=Date.parse(s.sourceDate),'snapshot date');
    check(['complete','partial','unknown'].includes(s.completeness),'completeness');
    provenance(s);
    const revision=JSON.stringify([s.etfAssetId,Date.parse(s.asOfDate),Date.parse(s.sourceDate),Date.parse(s.lastVerifiedAt)]);
    check(!revisions.has(revision),'ambiguous snapshot revision'); revisions.add(revision);
    const rows=new Set<string>(), assets=new Set<string>();
    for(const h of s.holdings) {
      check(h.id.trim().length>0 && !rows.has(h.id),'duplicate holding ID'); rows.add(h.id);
      check(h.name.trim().length>0 && (h.ticker===null || typeof h.ticker==='string'),'holding identity');
      check(['stock','etf','cash','other','unknown'].includes(h.assetType),'holding type');
      check(!h.underlyingAssetId || !funds.has(h.underlyingAssetId) || h.assetType==='etf','known fund mislabeled as non-ETF');
      check(h.underlyingAssetId===null || (entities.get(h.underlyingAssetId)?.kind==='Asset' && !assets.has(h.underlyingAssetId)),'underlying asset/duplicate');
      if(h.underlyingAssetId) assets.add(h.underlyingAssetId);
      provenance(h);
      check(Date.parse(h.sourceDate)>=Date.parse(s.asOfDate),'holding source date');
      check(['fraction','percent'].includes(h.weightUnit) && ['netAssets','equitySleeve','unknown'].includes(h.weightBasis),'weight basis/unit');
      const fraction=holdingFraction(h);
      check(fraction===null || (Number.isFinite(fraction) && fraction>=0 && fraction<=1),'weight range');
      if(h.calculation) {
        const c=h.calculation;
        check(Number.isFinite(c.holdingMarketValue) && c.holdingMarketValue>=0 && Number.isFinite(c.fundNetAssetValue) && c.fundNetAssetValue>0 && !!c.currency.trim() && validDate(c.asOfDate) && Date.parse(c.asOfDate)===Date.parse(s.asOfDate),'calculation inputs');
        check(fraction!==null && Math.abs(c.holdingMarketValue/c.fundNetAssetValue-fraction)<1e-12,'calculated weight mismatch');
      }
    }
  }
}
/** No future snapshots/revisions. A newer partial snapshot supersedes an older complete one. */
export function selectEtfSnapshot(data:EtfDataset,etfAssetId:string,asOfDate:string,knownAt=asOfDate):EtfHoldingsSnapshot|null {
  check(validDate(asOfDate) && validDate(knownAt),'query dates');
  const effective=Date.parse(asOfDate), known=Date.parse(knownAt);
  return data.snapshots.filter(s=>s.etfAssetId===etfAssetId && Date.parse(s.asOfDate)<=effective && Date.parse(s.sourceDate)<=known && Date.parse(s.lastVerifiedAt)<=known)
    .sort((a,b)=>Date.parse(b.asOfDate)-Date.parse(a.asOfDate) || Date.parse(b.sourceDate)-Date.parse(a.sourceDate) || Date.parse(b.lastVerifiedAt)-Date.parse(a.lastVerifiedAt))[0] ?? null;
}
export function createEtfHoldingsRepository(data:EtfDataset,foundation:ExposureDataset):EtfHoldingsRepository {
  validateEtfDataset(data,foundation);
  const copy=structuredClone(data);
  return {
    async getSnapshot(id,asOf,knownAt=asOf) {return structuredClone(selectEtfSnapshot(copy,id,asOf,knownAt));},
    async getHistory(id) {return structuredClone(copy.snapshots.filter(s=>s.etfAssetId===id).sort((a,b)=>Date.parse(a.asOfDate)-Date.parse(b.asOfDate) || Date.parse(a.sourceDate)-Date.parse(b.sourceDate)));},
  };
}
