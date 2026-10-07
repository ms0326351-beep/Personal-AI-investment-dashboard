import 'server-only';
import { readFile } from 'node:fs/promises';
import { migrationChecksum } from './migrationRunner';

export interface BootstrapPreparation {
  environment: 'production'; database: 'neondb'; postgresMajor: 18;
  instanceUuid: string; migratorPassword: string; runtimePassword: string;
  operatorTargetConfirmed: boolean; uuidStoredOutsideRepository: boolean;
  rolesReviewed: boolean; restoreCapabilityReviewed: boolean;
  restorePointReviewed: boolean; forwardFixReviewed: boolean;
}
export interface BootstrapManifest {
  schemaVersion: 'sec-bootstrap-manifest-v1'; artifactVersion: 2;
  environment: 'production'; database: 'neondb'; postgresMajor: 18;
  requiresExpectedInstanceUuid: true; requiresSeparateWriteApproval: true;
  actions: [{order: 1; filename: 'PRODUCTION_BOOTSTRAP_V2.sql'; sha256: string; transactional: true}];
  recovery: string;
}
export function validateBootstrapManifest(value: unknown): BootstrapManifest {
  if (!value || typeof value !== 'object') throw Error('Bootstrap manifest refused');
  const m = value as Partial<BootstrapManifest>;
  if (m.schemaVersion !== 'sec-bootstrap-manifest-v1' || m.artifactVersion !== 2 ||
      m.environment !== 'production' || m.database !== 'neondb' || m.postgresMajor !== 18 ||
      m.requiresExpectedInstanceUuid !== true || m.requiresSeparateWriteApproval !== true ||
      !Array.isArray(m.actions) || m.actions.length !== 1 ||
      m.actions[0]?.order !== 1 || m.actions[0]?.filename !== 'PRODUCTION_BOOTSTRAP_V2.sql' ||
      m.actions[0]?.transactional !== true || !/^[a-f0-9]{64}$/.test(m.actions[0]?.sha256 ?? '') ||
      typeof m.recovery !== 'string' || !m.recovery.trim()) throw Error('Bootstrap manifest refused');
  return m as BootstrapManifest;
}
export async function loadBootstrapArtifact() {
  const manifest = validateBootstrapManifest(JSON.parse(await readFile(new URL('./production/bootstrap.manifest.v1.json', import.meta.url), 'utf8')));
  const sql = await readFile(new URL('./production/PRODUCTION_BOOTSTRAP_V2.sql', import.meta.url), 'utf8');
  verifyBootstrapArtifact(manifest, sql);
  return {manifest, sql};
}
export function verifyBootstrapArtifact(manifest: BootstrapManifest, sql: string) {
  validateBootstrapManifest(manifest);
  if (migrationChecksum(sql) !== manifest.actions[0].sha256) throw Error('Bootstrap checksum refused');
}
/** Preparation only: no pg, env access, connection, execution or write authorization.
 * Returned SQL contains locally supplied secrets: never log, serialize or commit it.
 * No public CLI calls this function. Production execution needs separate approval.
 */
export async function prepareBootstrap(input: BootstrapPreparation) {
  const flags = ['operatorTargetConfirmed', 'uuidStoredOutsideRepository', 'rolesReviewed',
    'restoreCapabilityReviewed', 'restorePointReviewed', 'forwardFixReviewed'] as const;
  if (input.environment !== 'production' || input.database !== 'neondb' || input.postgresMajor !== 18 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.instanceUuid ?? '') ||
      flags.some(k => input[k] !== true) ||
      !/^[a-f0-9]{64}$/.test(input.migratorPassword ?? '') ||
      !/^[a-f0-9]{64}$/.test(input.runtimePassword ?? '') || input.migratorPassword === input.runtimePassword)
    throw Error('Bootstrap preparation refused');
  const {manifest, sql} = await loadBootstrapArtifact();
  const rendered = sql.replaceAll('<LOCALLY_GENERATED_INSTANCE_UUID>', input.instanceUuid)
    .replaceAll('<GENERATE_MIGRATOR_PASSWORD_LOCALLY>', input.migratorPassword)
    .replaceAll('<GENERATE_RUNTIME_PASSWORD_LOCALLY>', input.runtimePassword)
    .replaceAll('<BOOTSTRAP_TEMPLATE_SHA256>', manifest.actions[0].sha256);
  if (/<[A-Z_]+>/.test(rendered)) throw Error('Bootstrap placeholder unresolved');
  return {manifest, sql: rendered, productionWriteAuthorized: false as const};
}
