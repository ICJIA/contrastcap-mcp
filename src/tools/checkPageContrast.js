import { CONFIG } from '../config.js';
import { auditPage, withAuditTimeout } from './auditPage.js';
import { formatPageResult } from '../utils/formatResults.js';

export async function checkPageContrast(params) {
  const level = params.level || CONFIG.DEFAULT_LEVEL;

  const {
    finalUrl,
    axePassCount,
    resolvedPassCount,
    failures,
    warnings,
    skippedCount,
  } = await withAuditTimeout(auditPage(params.url, level));

  return formatPageResult({
    url: finalUrl,
    wcagLevel: level,
    axePassCount,
    resolvedPassCount,
    failures,
    warnings,
    skippedCount,
  });
}
