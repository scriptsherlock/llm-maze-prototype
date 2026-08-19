// The handful of Redis commands this study uses, over either an Upstash-style REST API
// or a local JSON file.
//
// Two backends because the hosting question has two answers. Outside mainland China the
// app runs on a platform with an ephemeral filesystem and talks to a managed store.
// Inside it, reaching that store means an outbound call across the border on every
// write -- slow, unreliable, and it fails looking like lost data rather than a network
// problem. A server in China should keep its data in China, on its own disk.
//
// Chosen by whether the KV variables are set, so neither deployment needs a flag.
const fs = require("fs");
const path = require("path");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const useRest = Boolean(KV_URL && KV_TOKEN);

// Serverless filesystems are wiped between invocations, so a file backend there would
// accept every write and lose all of it, silently. Better to report unconfigured.
const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const usable = useRest || !onServerless;

const FILE = process.env.STORE_FILE || path.join(process.cwd(), "error_logs", "store.json");

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (_e) { return {}; }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  // Write then rename: a crash mid-write leaves the previous file intact rather than a
  // truncated one, and this file is the whole study.
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

async function viaRest(command) {
  const response = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `KV HTTP ${response.status}`);
  return data.result;
}

// Node runs one request at a time per process, so read-modify-write needs no lock at
// this scale. Worth remembering if this ever runs more than one instance.
function viaFile(command) {
  const [rawOp, key, ...args] = command;
  const op = String(rawOp).toUpperCase();
  const db = readAll();
  switch (op) {
    case "INCR": db[key] = Number(db[key] || 0) + 1; writeAll(db); return db[key];
    case "SET": db[key] = args[0]; writeAll(db); return "OK";
    case "GET": return db[key] === undefined ? null : db[key];
    case "RPUSH": db[key] = [...(db[key] || []), ...args]; writeAll(db); return db[key].length;
    case "LRANGE": {
      const list = db[key] || [];
      const start = Number(args[0]);
      const stop = Number(args[1]);
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    }
    case "SADD": {
      const set = new Set(db[key] || []);
      args.forEach((v) => set.add(v));
      db[key] = [...set]; writeAll(db); return args.length;
    }
    case "SREM": db[key] = (db[key] || []).filter((v) => !args.includes(v)); writeAll(db); return 1;
    case "SMEMBERS": return db[key] || [];
    case "DEL": [key, ...args].forEach((k) => { delete db[k]; }); writeAll(db); return 1;
    default: throw new Error(`store: unsupported command ${op}`);
  }
}

async function kv(command) {
  if (!usable) throw new Error("No store: set KV_REST_API_URL and KV_REST_API_TOKEN, or run somewhere with a writable disk.");
  return useRest ? viaRest(command) : viaFile(command);
}

module.exports = {
  kv,
  backend: useRest ? "rest" : "file",
  usable,
  location: useRest ? KV_URL.replace(/^https?:\/\//, "").split("/")[0] : FILE,
};
