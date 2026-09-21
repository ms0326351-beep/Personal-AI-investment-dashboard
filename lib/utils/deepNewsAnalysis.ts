import type { DeepMarketImpact, SecurityImpact } from '../types/newsAnalysis';

export const TIME_HORIZONS = ['immediate','short-term','medium-term','long-term'] as const;
const levels = ['low','medium','high'];
const stringSchema = (maxLength: number) => ({type:'string',minLength:1,maxLength});
const enumeration = (values: readonly string[]) => ({type:'string',enum:values});
const array = (items: object, maxItems: number, minItems=0) => ({type:'array',items,minItems,maxItems});
const record = (properties: Record<string,object>) => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const watch = record({name:stringSchema(60),type:enumeration(['market','macro','company','industry','policy','commodity','currency','rate']),reason:stringSchema(180)});
const security = record({
  symbol:stringSchema(20),relationship:enumeration(['direct','indirect']),
  impactDirection:enumeration(['positive','negative','mixed','uncertain']),impactLevel:enumeration(levels),
  timeHorizon:enumeration(TIME_HORIZONS),reason:stringSchema(400),transmissionPath:array(stringSchema(100),6,2),
  confidence:enumeration(levels),watchFactors:array(watch,7),evidenceQuote:stringSchema(400),
  anchorSymbol:{type:'string',maxLength:20},linkage:enumeration(['company','supply-chain','index-exposure','macro']),
});
export const deepAnalysisProperties = {
  eventSummary:stringSchema(300),eventImportance:enumeration(levels),eventHorizon:enumeration(TIME_HORIZONS),
  impactChain:array(record({stage:enumeration(['event','macro','industry','security']),label:stringSchema(80),explanation:stringSchema(180),basis:enumeration(['reported','inferred'])}),6,1),
  securityImpacts:array(security,10),watchFactors:array(watch,7),
  baseCase:stringSchema(300),bullCase:stringSchema(300),bearCase:stringSchema(300),whatWouldChangeTheView:stringSchema(300),
  uncertainties:array(stringSchema(200),7,1),
};

// Validate the same bounded schema locally as well as at the provider boundary.
type Schema = {type:string;properties?:Record<string,Schema>;required?:string[];enum?:readonly string[];items?:Schema;minItems?:number;maxItems?:number;minLength?:number;maxLength?:number};
function matches(value:unknown, schema:Schema):boolean {
  if(schema.type==='string') return typeof value==='string' && value.trim().length >= (schema.minLength ?? 0)
    && [...value].length <= (schema.maxLength ?? Infinity) && (!schema.enum || schema.enum.includes(value));
  if(schema.type==='array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.length <= (schema.maxItems ?? Infinity) && value.every(v=>matches(v,schema.items!));
  if(!value || typeof value!=='object' || Array.isArray(value)) return false;
  const obj=value as Record<string,unknown>;
  return Object.keys(obj).every(k=>k in schema.properties!) && schema.required!.every(k=>matches(obj[k],schema.properties![k]));
}
/** Only schema-owned field paths, never values or arbitrary model keys. */
export function invalidSchemaPaths(value:unknown, definition:object, path=''):string[] {
  const schema=definition as Schema;
  if(matches(value,schema)) return [];
  if(schema.type==='object' && value && typeof value==='object' && !Array.isArray(value)) {
    const obj=value as Record<string,unknown>;
    const paths=Object.entries(schema.properties ?? {}).flatMap(([key,child])=>invalidSchemaPaths(obj[key],child,path?`${path}.${key}`:key));
    return paths.length?paths:[path || '$'];
  }
  if(schema.type==='array' && Array.isArray(value) && value.length<=(schema.maxItems ?? Infinity) && value.length>=(schema.minItems ?? 0))
    return value.flatMap((v,i)=>invalidSchemaPaths(v,schema.items!,`${path}[${i}]`));
  return [path || '$'];
}
export function tradingInstructionPaths(value:unknown):string[] {
  if(!value || typeof value!=='object') return [];
  const v=value as Record<string,unknown>;
  return [...Object.keys(deepAnalysisProperties),'conclusion','reasoning'].filter(k=>v[k]!==undefined && containsTradingInstruction(v[k]));
}
/** Conservative output guard; semantic accuracy still needs human review. */
export function containsTradingInstruction(value:unknown):boolean {
  const content=typeof value==='string'?value:JSON.stringify(value);
  return /買進|買入|賣出|加碼|減碼|目標價|保證獲利|一定(?:會)?(?:上漲|下跌)|\b(?:buy|sell|overweight|underweight)\b|price\s+target/i.test(content);
}
export function isSecurityImpact(value:unknown):value is SecurityImpact {
  return matches(value,security as Schema) && !containsTradingInstruction(value);
}
export function isDeepMarketImpact(value:unknown):value is DeepMarketImpact {
  if(!value || typeof value!=='object') return false;
  const v=value as Record<string,unknown>;
  if(!Object.entries(deepAnalysisProperties).every(([k,s])=>matches(v[k],s as Schema))) return false;
  const chain=v.impactChain as DeepMarketImpact['impactChain'];
  const order=['event','macro','industry','security'];
  return chain[0].stage==='event' && chain.every((n,i)=>!i || order.indexOf(n.stage)>=order.indexOf(chain[i-1].stage))
    && new Set((v.securityImpacts as SecurityImpact[]).map(s=>s.symbol)).size===(v.securityImpacts as SecurityImpact[]).length
    && !containsTradingInstruction(Object.fromEntries(Object.keys(deepAnalysisProperties).map(k=>[k,v[k]])));
}
export function hasDeepFields(value:Record<string,unknown>) { return Object.keys(deepAnalysisProperties).some(k=>k in value); }
