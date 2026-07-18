// Hosted equivalent of GET /api/state. AI is always available for hosted
// participants (the moderator on/off toggle is a local researcher tool).
const { provider, model } = require("../lib/hint-engine");

module.exports = (_req, res) => {
  res.status(200).json({ ai_enabled: true, provider, model });
};
