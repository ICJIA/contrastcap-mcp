function truncate(str, max) {
  if (typeof str !== 'string') return str;
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function round(n, decimals = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function shapeEntry(item) {
  const entry = {
    selector:         truncate(item.selector, 120),
    text:             truncate(item.text || '', 40),
    ratio:            round(item.ratio, 2),
    required:         item.required,
    level:            item.level,
    fontSize:         item.fontSize,
    fontWeight:       item.fontWeight,
    isLargeText:      !!item.isLargeText,
    foreground:       item.foreground,
    background:       item.background,
    backgroundSource: item.backgroundSource || 'computed',
  };
  if (item.suggestion) entry.suggestion = item.suggestion;
  if (item.note) entry.note = item.note;
  return entry;
}

export function formatPageResult({
  url,
  wcagLevel,
  axePassCount,
  resolvedPassCount,
  skippedCount,
  failures,
  warnings,
}) {
  const pass = axePassCount + resolvedPassCount;
  const total = pass + failures.length + warnings.length + skippedCount;

  return {
    url,
    timestamp: new Date().toISOString(),
    wcag_level: wcagLevel,
    summary: {
      total,
      pass,
      fail: failures.length,
      warning: warnings.length,
      skipped: skippedCount,
    },
    failures: failures.map(shapeEntry),
    warnings: warnings.map(shapeEntry),
  };
}

export function formatSummaryResult({
  url,
  wcagLevel,
  axePassCount,
  resolvedPassCount,
  failCount,
  warningCount,
  skippedCount,
}) {
  const pass = axePassCount + resolvedPassCount;
  const total = pass + failCount + warningCount + skippedCount;
  return {
    url,
    timestamp: new Date().toISOString(),
    wcag_level: wcagLevel,
    counts: {
      total_elements_checked: total,
      pass,
      fail: failCount,
      warning: warningCount,
      skipped: skippedCount,
    },
  };
}

export function formatElementResult({ url, wcagLevel, entry }) {
  const out = {
    url,
    timestamp: new Date().toISOString(),
    wcag_level: wcagLevel,
    selector: entry.selector,
    text: truncate(entry.text || '', 40),
    ratio: round(entry.ratio, 2),
    required: entry.required,
    pass: entry.pass,
    fontSize: entry.fontSize,
    fontWeight: entry.fontWeight,
    isLargeText: !!entry.isLargeText,
    foreground: entry.foreground,
    background: entry.background,
    backgroundSource: entry.backgroundSource || 'computed',
  };
  if (entry.suggestion) out.suggestion = entry.suggestion;
  if (entry.note) out.note = entry.note;
  return out;
}

export const _test = { truncate, round, shapeEntry };
