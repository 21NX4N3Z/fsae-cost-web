#!/usr/bin/env node
/**
 * deploy เองโดยไม่ต้อง `vercel login`
 *
 * ปัญหา: token ของ Vercel หมดอายุทุก ~8 ชม. และ CLI รุ่นใหม่หาไฟล์ auth ไม่เจอ
 * ทำให้ `vercel deploy` ล้มทั้งที่ยังมี refreshToken อยู่
 *
 * วิธีนี้: ต่ออายุ token ผ่าน OAuth ของ Vercel เอง แล้วส่งผ่าน env var
 *   https://vercel.com/.well-known/oauth-authorization-server -> token_endpoint
 *   POST client_id + grant_type=refresh_token + refresh_token
 *
 * ใช้:  node scripts/deploy.mjs [--prod]
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CLIENT_ID = "cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp";
const ISSUER = "https://vercel.com";

// ตำแหน่งที่อาจมีไฟล์ credentials ของ Vercel CLI
const CANDIDATES = [
  join(process.env.APPDATA || "", "xdg.data", "com.vercel.cli", "auth.json"),
  join(process.env.APPDATA || "", "com.vercel.cli", "auth.json"),
  join(process.env.LOCALAPPDATA || "", "com.vercel.cli", "auth.json"),
  join(homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
  join(homedir(), ".vercel", "auth.json"),
];

function findAuth() {
  for (const p of CANDIDATES) {
    if (existsSync(p)) {
      try {
        JSON.parse(readFileSync(p, "utf8"));
        return p;
      } catch {
        /* ไฟล์เสีย ลองไปตัวถัดไป */
      }
    }
  }
  return null;
}

async function getTokenEndpoint() {
  const paths = [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ];
  for (const p of paths) {
    try {
      const r = await fetch(ISSUER + p, { headers: { "User-Agent": "vercel/60.0.0" } });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.token_endpoint) return j.token_endpoint;
    } catch {
      /* ลองต่อ */
    }
  }
  throw new Error("หา token_endpoint ไม่เจอ");
}

async function refresh(auth) {
  if (auth.expiresAt && auth.expiresAt * 1000 > Date.now() + 60_000) {
    return auth.token; // ยังไม่หมดอายุ
  }
  if (!auth.refreshToken) throw new Error("ไม่มี refreshToken — ต้องรัน vercel login ครั้งเดียว");

  console.log("token หมดอายุ กำลังต่ออายุ...");
  const endpoint = await getTokenEndpoint();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "vercel/60.0.0",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
    }),
  });
  if (!res.ok) throw new Error("refresh ไม่สำเร็จ: HTTP " + res.status + " " + (await res.text()).slice(0, 160));

  const j = await res.json();
  auth.token = j.access_token;
  if (j.refresh_token) auth.refreshToken = j.refresh_token;
  auth.expiresAt = Math.floor(Date.now() / 1000) + (j.expires_in || 28800) - 60;
  console.log("ต่ออายุแล้ว หมดอายุ " + new Date(auth.expiresAt * 1000).toISOString().slice(11, 16) + " UTC");

  // เขียนกลับทุกไฟล์ที่อ่านมา เพื่อให้คำสั่งอื่นใช้ได้ด้วย
  for (const p of CANDIDATES) {
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(auth, null, 2));
    } catch {
      /* บางทางเขียนไม่ได้ ไม่เป็นไร */
    }
  }
  return auth.token;
}

const authPath = findAuth();
if (!authPath) {
  console.error("ไม่พบไฟล์ auth.json ของ Vercel — ต้องรัน `npx vercel login` ครั้งเดียว");
  process.exit(1);
}
console.log("พบ credentials:", authPath);

const auth = JSON.parse(readFileSync(authPath, "utf8"));
const token = await refresh(auth);

const prod = !process.argv.includes("--preview");
const args = ["vercel", "deploy", ...(prod ? ["--prod"] : []), "--yes"];
console.log("กำลัง deploy:", args.join(" "));

// Vercel CLI ต้องมี TTY จึงต้องให้ child process inherit ของเดิม
// ถ้าใช้ pipe จะได้ "stdout is not a tty" แล้ว deploy ไม่ทำงาน
try {
  execSync(`npx ${args.join(" ")}`, {
    stdio: "inherit",
    env: { ...process.env, VERCEL_TOKEN: token },
  });
} catch (err) {
  console.error("deploy ไม่สำเร็จ (exit " + err.status + ")");
  process.exit(err.status || 1);
}
