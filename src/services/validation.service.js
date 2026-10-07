const THRESHOLD = 0.75;

function validDate(value) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function validate(result) {
  if (!result || result.confidence < THRESHOLD) {
    return {
      accepted: false,
      message: "Low confidence. Retry or enter the expiry manually."
    };
  }

  if (!validDate(result.expiry_date)) {
    return {
      accepted: false,
      message: "Expiry date could not be parsed reliably."
    };
  }

  if (result.mfg_date && !validDate(result.mfg_date)) {
    return {
      accepted: false,
      message: "Manufacturing date could not be parsed reliably."
    };
  }

  if (result.mfg_date && result.expiry_date < result.mfg_date) {
    return {
      accepted: false,
      message: "Expiry date is earlier than manufacturing date."
    };
  }

  return { accepted: true };
}

module.exports = { validate, THRESHOLD };
