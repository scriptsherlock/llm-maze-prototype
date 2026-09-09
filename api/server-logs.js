// Hosted stub for the moderator's server-log panel. Serverless has no persistent
// log file, so this returns empty. (Server-side logs are a local researcher tool.)
module.exports = (_req, res) => {
  res.status(200).json({ logs: [] });
};
