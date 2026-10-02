export interface RawXmlDocument {
  accessionNumber:string;
  rawXml:string;
  rawXmlHash:string;
  hashBasis:'decoded_xml_utf8';
  sourceUrl:string;
  retrievedAt:string;
}
export interface RawXmlReference {key:string;rawXmlHash:string;hashBasis:'decoded_xml_utf8'}
export interface RawXmlStore {
  putImmutable(document:RawXmlDocument):Promise<{status:'CREATED'|'ALREADY_EXISTS'|'INTEGRITY_CONFLICT';reference:RawXmlReference}>;
  get(accessionNumber:string):Promise<RawXmlDocument|null>;
  exists(accessionNumber:string):Promise<boolean>;
}
