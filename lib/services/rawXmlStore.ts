import 'server-only';
import { createHash } from 'node:crypto';
import type { RawXmlDocument, RawXmlReference, RawXmlStore } from '../types/rawXmlStore';
import { secFilingKey } from '../utils/secEndpoints';

/** Deterministic test adapter; no cloud client/credential or retention deletion. */
export class InMemoryRawXmlStore implements RawXmlStore {
  private readonly documents=new Map<string,RawXmlDocument>();
  async putImmutable(input:RawXmlDocument) {
    const key=secFilingKey(input.accessionNumber),url=new URL(input.sourceUrl);
    if(input.hashBasis!=='decoded_xml_utf8' || createHash('sha256').update(input.rawXml,'utf8').digest('hex')!==input.rawXmlHash ||
        url.protocol!=='https:' || url.hostname!=='www.sec.gov' || !Number.isFinite(Date.parse(input.retrievedAt)))throw new Error('Invalid raw XML document');
    const previous=this.documents.get(key);
    const reference:RawXmlReference={key,rawXmlHash:previous?.rawXmlHash??input.rawXmlHash,hashBasis:'decoded_xml_utf8'};
    if(previous)return {status:previous.rawXmlHash===input.rawXmlHash?'ALREADY_EXISTS' as const:'INTEGRITY_CONFLICT' as const,reference};
    this.documents.set(key,structuredClone(input));
    return {status:'CREATED' as const,reference};
  }
  async get(accession:string){const d=this.documents.get(secFilingKey(accession));return d?structuredClone(d):null;}
  async exists(accession:string){return this.documents.has(secFilingKey(accession));}
}
