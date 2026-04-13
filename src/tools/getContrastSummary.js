import { CONFIG } from '../config.js';
import { auditPage, withAuditTimeout } from './auditPage.js';
import { formatSummaryResult } from '../utils/formatResults.js';

export async function getContrastSummary(params) {
  const level = params.level || CONFIG.DEFAULT_LEVEL;

  const {
    finalUrl,
    axePassCount,
    resolvedPassCount,
    failures,
    warnings,
    skippedCount,
  } = await withAuditTimeout(auditPage(params.url, level));

  return formatSummaryResult({
    url: finalUrl,
    wcagLevel: level,
    axePassCount,
    resolvedPassCount,
    failCount: failures.length,
    warningCount: warnings.length,
    skippedCount,
  });
}
