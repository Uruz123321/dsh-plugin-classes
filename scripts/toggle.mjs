import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
const DSH_HOME = process.env.DSH_HOME ?? "E:/DeepSeek Orb/dsh-home";
const BASE = "http://127.0.0.1:19387";
const b64 = (b) => Buffer.from(b).toString("base64").replaceAll("+","-").replaceAll("/","_").replace(/=+$/u,"");
const text = readFileSync(path.join(DSH_HOME, ".credentials.yaml"), "utf8");
const m = /client-connection\/browser-session:\s*\n\s*kind:[^\n]*\n\s*payload:\s*\n\s*version:[^\n]*\n\s*secret:\s*([A-Za-z0-9_-]+)/u.exec(text.replace(/\r/g, ""));
const secret = Buffer.from(m[1].replaceAll("-","+").replaceAll("_","/"), "base64");
const authority = new URL(BASE).host;
const name = "dsh-auth-" + b64(createHash("sha256").update(authority).digest());
const now = Date.now();
const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 6*24*3600*1000 }), "utf8"));
const sig = b64(createHmac("sha256", secret).update(body).digest());
const cookie = name + "=v1." + body + "." + sig;
async function call(endpoint, args) {
  const res = await fetch(BASE + "/api/" + endpoint, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ type: "client-request", rpcId: "t", method: endpoint, payload: { args } }) });
  const json = await res.json();
  console.log(endpoint, "→", res.status, JSON.stringify(json.result).slice(0, 600));
  return json;
}


await call('pluginManager/setPluginEnabled', { id: 'include:dsh-plugin-classes', enabled: false });
await new Promise(r => setTimeout(r, 1200));
await call('pluginManager/setPluginEnabled', { id: 'include:dsh-plugin-classes', enabled: true });
