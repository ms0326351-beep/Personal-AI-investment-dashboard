import type { NextConfig } from 'next';

/** Capture only non-secret platform build metadata, never diagnostic credentials.
 * Next replaces these exact process.env references with build-time literals.
 */
export function netlifyDiagnosticBuildMetadata(env:Record<string,string|undefined>) {
  const context=env.NETLIFY==='true' && ['production','deploy-preview','branch-deploy'].includes(env.CONTEXT??'')?env.CONTEXT!:'unknown';
  let url='';
  if(context==='deploy-preview') {
    try {
      const candidate=new URL(env.DEPLOY_PRIME_URL??'');
      if(candidate.protocol==='https:' && /^deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/.test(candidate.hostname) && !candidate.username && !candidate.password && !candidate.port) url=candidate.origin;
    } catch { /* Missing metadata stays unavailable. */ }
  }
  return {PREVIEW_DIAGNOSTIC_BUILD_CONTEXT:context,PREVIEW_DIAGNOSTIC_BUILD_URL:url};
}
const config:NextConfig={env:netlifyDiagnosticBuildMetadata(process.env)};
export default config;
