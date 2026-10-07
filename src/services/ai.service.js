async function interpretExpiry(rawText) {
  // PRACTICE ONLY:
  // Replace this service with the selected LLM API on Oct 10.
  const match = rawText.match(
    /MFG\s+(\d{2})\/(\d{2})\/(\d{4}).*EXP\s+(\d{2})\/(\d{2})\/(\d{4}).*BATCH\s+([A-Z0-9-]+)/i
  );

  if (!match) {
    return {
      expiry_date: null,
      mfg_date: null,
      batch: null,
      confidence: 0
    };
  }

  const [, md, mm, my, ed, em, ey, batch] = match;

  return {
    mfg_date: `${my}-${mm}-${md}`,
    expiry_date: `${ey}-${em}-${ed}`,
    batch,
    confidence: 0.94
  };
}

module.exports = { interpretExpiry };
