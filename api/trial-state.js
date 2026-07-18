// Stateless stub for the trial-state channel. On a serverless host there is no
// shared server memory, so cross-tab sync uses the browser (localStorage +
// BroadcastChannel) instead. This just keeps the frontend's periodic calls from
// erroring; remote participants don't use the moderator's live sync.
module.exports = (req, res) => {
  if (req.method === "POST") {
    res.status(200).json({ status: "stored" });
    return;
  }
  res.status(200).json({ state: null });
};
