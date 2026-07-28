// Hosted batch route-evaluation (v5): evaluate all junctions in one call so the
// client can precompute every cue at trial start.
const { getCredentialError, validateBatchRequest, evaluateJunctionsBatch, provider, model } = require("../lib/hint-engine");

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_error) { return {}; }
  }
  return req.body;
}

module.exports = async (req, res) => {
  const startedAt = Date.now();
  if (req.method !== "POST") {
    res.status(405).json({ status: "method_not_allowed", message: "Use POST." });
    return;
  }
  const body = parseBody(req);

  const credentialError = getCredentialError();
  if (credentialError) {
    res.status(503).json({ status: "missing_api_key", message: credentialError, latency_ms: Date.now() - startedAt });
    return;
  }
  const stateError = validateBatchRequest(body);
  if (stateError) {
    res.status(400).json({ status: "bad_request", message: stateError, latency_ms: Date.now() - startedAt });
    return;
  }
  try {
    const logError = (action, details) => console.warn("[route-eval-batch]", action, JSON.stringify(details));
    const result = await evaluateJunctionsBatch(body, logError);
    console.log("[route-eval-batch] AI cues:", JSON.stringify({ goal: body.goal, junctions: result.junctions }));
    res.status(200).json({ ...result, latency_ms: Date.now() - startedAt });
  } catch (error) {
    res.status(error.statusCode || 502).json({ status: "llm_failed", message: error.message || "Batch route evaluation failed.", latency_ms: Date.now() - startedAt, provider, model });
  }
};
