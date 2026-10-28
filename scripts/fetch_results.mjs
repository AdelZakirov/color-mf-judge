// Dump the study collections to results/*.json with the Firebase CLI login (`npx firebase login`).
// Clients cannot read the data (firestore.rules); this uses the owner's credentials.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const auth = require("firebase-tools/lib/auth");
const { configstore } = require("firebase-tools/lib/configstore");

const PROJECT = "cmf-check";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const { access_token } = await auth.getAccessToken(configstore.get("tokens").refresh_token, []);

function plain(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  throw new Error(`unhandled value ${JSON.stringify(v)}`);
}

async function list(collection) {
  const out = [];
  let token = "";
  do {
    const url = `${BASE}/${collection}?pageSize=1000${token ? `&pageToken=${token}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!r.ok) throw new Error(`${collection}: ${r.status} ${await r.text()}`);
    const body = await r.json();
    for (const d of body.documents ?? []) {
      const row = { id: d.name.split("/").pop() };
      for (const [k, v] of Object.entries(d.fields ?? {})) row[k] = plain(v);
      out.push(row);
    }
    token = body.nextPageToken ?? "";
  } while (token);
  return out;
}

mkdirSync("results", { recursive: true });
for (const c of ["sessions", "answers"]) {
  const rows = await list(c);
  writeFileSync(`results/${c}.json`, JSON.stringify(rows, null, 1));
  console.log(`${c}: ${rows.length}`);
}
