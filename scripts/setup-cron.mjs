#!/usr/bin/env node
/**
 * setup-cron.mjs — เก็บ URL ของแอปและ `CRON_SECRET` ลง Supabase Vault
 *
 * 🔴 **ความลับต้องไม่อยู่ในไฟล์ migration** — commit เมื่อไหร่ก็ติดอยู่ใน
 * ประวัติ git ตลอดไป ลบไฟล์ทีหลังก็ยังอยู่ (CLAUDE.md §13 ข้อ 4)
 * ไฟล์นี้จึงอ่านค่าจาก `.env.local` แล้วเขียนลง Vault ตอนรัน · ตัวสคริปต์เอง
 * ไม่มีความลับอยู่ในนั้นเลย และ **ไม่พิมพ์ค่าออกหน้าจอ** ไม่ว่ากรณีใด
 *
 * ต้องรัน **ก่อน** migration `20260904080000_pg_cron_jobs.sql` — ไม่งั้นงาน
 * ตามเวลาจะทำงานแล้วข้ามไปเงียบ ๆ ทุกครั้งเพราะอ่านค่าไม่เจอ
 *
 * ⚠️ เปลี่ยนโดเมนหรือหมุน `CRON_SECRET` เมื่อไหร่ **ต้องรันซ้ำ** ไม่งั้นงาน
 * ตามเวลาจะยิงไปที่เดิม/ด้วยกุญแจเดิม แล้วโดน 401 โดยไม่มีใครเห็น
 *
 * ใช้: node scripts/setup-cron.mjs [https://โดเมนของแอป]
 */
import { readFileSync } from 'node:fs'
import { PRODUCTION_ORIGIN } from './app-origins.mjs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)

const REF = env.SUPABASE_PROJECT_REF
const TOKEN = env.SUPABASE_ACCESS_TOKEN
const SECRET = env.CRON_SECRET
const BASE = (process.argv[2] ?? PRODUCTION_ORIGIN).replace(/\/+$/, '')

if (!REF || !TOKEN) throw new Error('.env.local ต้องมี SUPABASE_PROJECT_REF และ SUPABASE_ACCESS_TOKEN')
if (!SECRET) throw new Error('.env.local ต้องมี CRON_SECRET — งานตามเวลายิงเข้า API ของเราด้วยค่านี้')
if (!/^https:\/\//.test(BASE)) throw new Error(`URL ต้องขึ้นต้นด้วย https:// — ได้ ${BASE}`)

// ตรึงเป้าหมาย: ref ต้องตรงกับ subdomain ใน URL ที่แอปใช้จริง (เหตุผลเดียวกับ db.mjs)
const hostRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (hostRef !== REF) {
  throw new Error(`เป้าหมายไม่ตรงกัน: PROJECT_REF=${REF} แต่ URL ชี้ไป ${hostRef} — หยุดก่อนเขียนผิดที่`)
}

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  // ⚠️ ห้ามพิมพ์ `query` ออกมาตอน error — มันมีความลับอยู่ข้างใน
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** ค่าเดิมมีอยู่แล้ว = อัปเดต ไม่ใช่เพิ่มใบที่สอง (Vault ยอมให้ชื่อซ้ำได้) */
const put = async (name, value) => {
  const esc = String(value).replaceAll("'", "''")
  await sql(`
    do $$
    declare v_id uuid;
    begin
      select id into v_id from vault.secrets where name = '${name}';
      if v_id is null then
        perform vault.create_secret('${esc}', '${name}', 'ตั้งโดย scripts/setup-cron.mjs');
      else
        perform vault.update_secret(v_id, '${esc}', '${name}');
      end if;
    end $$;
  `)
}

await put('app_base_url', BASE)
await put('cron_secret', SECRET)

// พิสูจน์ว่าอ่านกลับได้จริง — เทียบ **ความยาว** ไม่ใช่ค่า เพื่อไม่ให้ความลับโผล่
const [check] = await sql(`
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') as base,
    (select length(decrypted_secret) from vault.decrypted_secrets where name = 'cron_secret') as secret_len
`)

if (check.base !== BASE) throw new Error(`เก็บ URL ไม่ตรง: ได้ ${check.base}`)
if (Number(check.secret_len) !== SECRET.length) throw new Error('เก็บ CRON_SECRET ไม่ครบ')

console.log(`✅ เก็บลง Vault แล้ว (โปรเจ็ค ${REF})`)
console.log(`   app_base_url = ${check.base}`)
console.log(`   cron_secret  = เก็บแล้ว ${check.secret_len} ตัวอักษร (ไม่แสดงค่า)`)
console.log('\nขั้นต่อไป: node scripts/db.mjs file supabase/migrations/20260904080000_pg_cron_jobs.sql')
