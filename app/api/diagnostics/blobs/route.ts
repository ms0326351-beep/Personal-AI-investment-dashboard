import 'server-only';
import { createPreviewBlobsDiagnostic } from '@/lib/services/previewBlobsDiagnostic';
export const runtime='nodejs';
export const POST=createPreviewBlobsDiagnostic();
