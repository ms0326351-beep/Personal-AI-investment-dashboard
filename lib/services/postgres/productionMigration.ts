import 'server-only';
import type { Pool } from 'pg';
import type { DatabaseTarget } from '../../types/databaseSafety';
import { loadProductionMigrations } from './productionManifest';
import { productionPreflight } from './productionPreflight';
import { runSecMigrations } from './migrationRunner';

export interface MigrationApproval {restoreCapabilityReviewed:boolean;restorePointReviewed:boolean;forwardFixReviewed:boolean;writeApproved:boolean}
export async function executeProductionMigration(pool:Pool,target:DatabaseTarget,approval:MigrationApproval){
  if(!approval.writeApproved||!approval.restoreCapabilityReviewed||!approval.restorePointReviewed||!approval.forwardFixReviewed)throw Error('Migration prerequisite incomplete');
  const {entries,migrations}=await loadProductionMigrations(); // Check bytes before any DB access.
  const preflight=await productionPreflight(pool,target);
  if(entries.some(e=>e.minimumPostgresVersion>preflight.postgresMajor))throw Error('Manifest PostgreSQL version requirement unmet');
  const user=(await pool.query('SELECT current_user AS name')).rows[0].name;
  if(user!=='investment_dashboard_migrator')throw Error('Dedicated migrator required');
  return runSecMigrations(pool,target,'sec_app',migrations,'direct');
}
