import { InMemorySecIngestionRepository } from './secIngestionRepository';
import { InMemorySecIngestionAudit } from './secIngestionAudit';
import { SecRepositoryWriteError, type SecIngestionRecord } from '../types/secIngestion';
import { registerSecAdapterContract, type SecAdapterContractHarness } from './testing/secIngestionContract';

registerSecAdapterContract('InMemory',async():Promise<SecAdapterContractHarness>=>{
  const base=new InMemorySecIngestionRepository(),audit=new InMemorySecIngestionAudit();
  const keys=new Set<string>();let fault:'child_failure'|'rollback'|'ack_timeout'|null=null;
  return {
    repository:{getFilingByAccession:a=>base.getFilingByAccession(a),saveIngestion:async record=>{
      keys.add(record.accessionNumber); // Include failed writes in actual visibility inspection.
      const current=fault;fault=null;
      if(current==='rollback')throw new SecRepositoryWriteError('NOT_COMMITTED');
      if(current==='child_failure'){
        // Memory snapshot validation is its actual pre-publication boundary.
        const invalid:SecIngestionRecord=structuredClone(record);invalid.transactions.at(-1)!.id='invalid-child';
        try{await base.saveIngestion(invalid);}catch{throw new SecRepositoryWriteError('NOT_COMMITTED');}
        throw new Error('Expected child validation failure');
      }
      const saved=await base.saveIngestion(record);
      if(current==='ack_timeout')throw new SecRepositoryWriteError('UNKNOWN');
      return saved;
    }},audit,attempts:a=>audit.getAttempts(a),
    stats:async()=>{
      const stored=await Promise.all([...keys].map(a=>base.getFilingByAccession(a)));
      return {filings:stored.filter(Boolean).length,transactions:stored.reduce((n,r)=>n+(r?.transactions.length??0),0)};
    },faultNextSave:kind=>{fault=kind;},dispose:async()=>{},
  };
});
