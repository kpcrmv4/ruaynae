#!/usr/bin/env node
/**
 * verify-mcp-write.mjs — ปิดแถว R6-* (ตัวเชื่อม MCP ฝั่งเขียน)
 *
 * 🔴 แถวที่สำคัญที่สุดคือ R6-TOOL-06 (กันบันทึกซ้ำ) และ R6-SEC-09 (คีย์ที่เพิกถอนแล้ว)
 * — ทั้งคู่ **ไม่มีอาการให้เห็นเลย** จนกว่าจะมีเงินผิดในรายงาน · การอ่านโค้ดแล้วบอกว่า
 * "มี client_ref อยู่แล้ว" ไม่ใช่หลักฐาน ต้องนับแถวก่อน/หลังจริง
 *
 * 🔴 สคริปต์นี้ **เขียนข้อมูลจริง** ต่างจาก verify-mcp ที่อ่านอย่างเดียว
 * ทุกแถวที่มันสร้างมีชื่อบอกตัวเองว่าเป็นของซ้อม และถูกลบใน `finally`
 * · ล้างเฉพาะ id ที่สคริปต์นี้สร้างเอง ห้ามล้างแบบไม่มีเงื่อนไข (CLAUDE.md §17 ข้อ 9)
 *
 * ใช้: node scripts/verify-mcp-write.mjs [http://localhost:3200]
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { generateKey, hashKey, keyPrefix } from '../src/lib/mcp/keys-core.ts'
import { WRITE_TOOL_NAMES } from '../src/lib/mcp/tool-names.ts'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// ── Supabase Management API — หนึ่งคำขอ = หนึ่งทรานแซกชัน ─────────────
const sql = async (query) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    })
  const text = await r.text()
  if (!r.ok) throw new Error(`SQL ล้มเหลว: ${text.slice(0, 400)}\n--- ${query.slice(0, 300)}`)
  return JSON.parse(text)
}

// ── JSON-RPC ──────────────────────────────────────────────────────────
let rpcId = 0
const call = async (u, method, params) => {
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* บอดี้ว่าง — ผู้เรียกตัดสินเอง */ }
  return { status: r.status, text, json, result: json?.result }
}
const tool = (u, name, args = {}) => call(u, 'tools/call', { name, arguments: args })
const textOf = (res) => res.result?.content?.[0]?.text ?? ''
const jsonOf = (res) => { try { return JSON.parse(textOf(res)) } catch { return null } }

const TAG = 'ตรวจรับ R6 ชั่วคราว'
const F = {
  site: randomUUID(), catExpense: randomUUID(), catIncome: randomUUID(),
  emp: randomUUID(), emp2: randomUUID(), otherSite: randomUUID(),
}
const keyIds = []
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const mkKey = async (label) => {
  const secret = generateKey()
  const [row] = await sql(`
    insert into public.mcp_keys (label, key_hash, key_prefix, created_by)
    values (${q(`${TAG} ${label}`)}, ${q(hashKey(env.MCP_KEY_PEPPER, secret))},
            ${q(keyPrefix(secret))}, ${q(owner.id)})
    returning id`)
  keyIds.push(row.id)
  return { id: row.id, url: `${BASE}/api/mcp/${secret}` }
}

const [owner] = await sql(
  `select id from public.profiles where role = 'owner' and is_active order by created_at limit 1`)
if (!owner) {
  console.error('❌ ไม่มีบัญชีเจ้าของในฐานข้อมูล — seed ก่อน')
  process.exit(1)
}
const TODAY = (await sql(`select (now() at time zone 'Asia/Bangkok')::date::text as d`))[0].d

console.log(`\n🔎 verify-mcp-write · ${BASE}\n`)

try {
  // ── fixture ของตัวเอง ───────────────────────────────────────────────
  await sql(`
    insert into public.sites (id, name, status) values
      (${q(F.site)}, ${q(`${TAG} โครงการ`)}, 'active'),
      (${q(F.otherSite)}, ${q(`${TAG} โครงการอื่น`)}, 'active');
    insert into public.categories (id, name, kind, is_active, sort_order) values
      (${q(F.catExpense)}, ${q(`${TAG} หมวดจ่าย`)}, 'expense', true, 990),
      (${q(F.catIncome)},  ${q(`${TAG} หมวดรับ`)},  'income',  true, 991);
    insert into public.employees (id, full_name, is_active) values
      (${q(F.emp)},  ${q(`${TAG} คนงานหนึ่ง`)}, true),
      (${q(F.emp2)}, ${q(`${TAG} คนงานสอง`)}, true);
    insert into public.employee_wages (employee_id, wage_type, daily_rate) values
      (${q(F.emp)}, 'daily', 450), (${q(F.emp2)}, 'daily', 500)`)

  const k = await mkKey('หลัก')

  // ══ 1 · พื้นผิวที่โมเดลเห็น ═══════════════════════════════════════
  {
    const r = await call(k.url, 'tools/list')
    const tools = r.result?.tools ?? []
    const bad = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object')
    const missing = WRITE_TOOL_NAMES.filter((n) => !tools.some((t) => t.name === n))
    check('R6-TOOL-01 tools/list คืน 14 ตัว ทุกตัวมี inputSchema และมีเครื่องมือฝั่งเขียนครบ',
      r.status === 200 && tools.length === 14 && bad.length === 0 && missing.length === 0,
      `${tools.length} ตัว · ขาด ${missing.join(',') || '—'}`)
  }
  {
    const r = await call(k.url, 'initialize', { protocolVersion: '2025-06-18' })
    const ins = String(r.result?.instructions ?? '')
    check('R6-TOOL-02 initialize บอกขั้นตอนยืนยันก่อนบันทึก และบอกว่ารูปในแชทไม่ถูกเก็บ',
      ins.includes('รอคำตอบก่อนเรียกเครื่องมือ') && ins.includes('ไม่ได้ถูกเก็บเข้าระบบ'),
      `${ins.length} ตัวอักษร`)
  }

  // ══ 2 · บันทึกจริง ════════════════════════════════════════════════
  let txnId = null
  {
    const cats = jsonOf(await tool(k.url, 'list_categories', { kind: 'expense' }))
    const mine = (cats ?? []).find((c) => c.id === F.catExpense)
    const ref = randomUUID()
    const r = await tool(k.url, 'record_transaction', {
      kind: 'expense', category_id: mine?.id, amount: 1234.56, txn_date: TODAY,
      site_id: F.site, note: 'ค่าทางด่วนจากสลิป', client_ref: ref,
    })
    const j = jsonOf(r)
    txnId = j?.transaction_id ?? null
    const [row] = txnId
      ? await sql(`select amount::text, status::text, created_by::text, mcp_key_id::text
                   from public.transactions where id = ${q(txnId)}`)
      : [null]
    check('R6-TOOL-03 list_categories → record_transaction → แถวเกิดจริง อนุมัติแล้ว มีเจ้าของและป้ายคีย์',
      mine !== undefined && j?.ok === true && row?.status === 'approved'
        && row?.created_by === owner.id && row?.mcp_key_id === k.id && row?.amount === '1234.56',
      row ? `status=${row.status} created_by=${row.created_by === owner.id ? 'owner' : row.created_by} key=${row.mcp_key_id === k.id}` : textOf(r))

    // ค้นกลับด้วยเครื่องมือฝั่งอ่าน — ตัวเลขต้องตรงกัน ไม่ใช่แค่แถวมีอยู่
    const found = jsonOf(await tool(k.url, 'search_transactions', { site_id: F.site, limit: 20 }))
    const hit = (found?.rows ?? []).find((t) => t.id === txnId)
    check('R6-TOOL-03b แถวที่เพิ่งบันทึกโผล่ใน search_transactions ด้วยยอดเดียวกัน',
      hit !== undefined && Number(hit.amount) === 1234.56,
      hit ? `amount=${hit.amount}` : 'ไม่เจอแถว')
  }
  {
    const r = await tool(k.url, 'record_transaction', {
      kind: 'expense', amount: 100, txn_date: TODAY, site_id: F.site,
    })
    check('R6-TOOL-04 ไม่ส่ง category_id → isError พร้อมข้อความไทย ไม่ใช่ JSON-RPC error',
      r.status === 200 && !r.json?.error && r.result?.isError === true
        && textOf(r).includes('หมวด'),
      `${r.status} · “${textOf(r)}”`)
  }
  {
    const [{ n: before }] = await sql('select count(*)::int as n from public.transactions')
    const r = await tool(k.url, 'record_transaction', {
      kind: 'expense', category_id: F.catExpense, amount: 500,
      txn_date: '2569-09-01', site_id: F.site,
    })
    const [{ n: after }] = await sql('select count(*)::int as n from public.transactions')
    check('R6-TOOL-05 วันที่เป็น พ.ศ. → ถูกปฏิเสธ และไม่มีแถวใหม่ในฐานข้อมูลเลย',
      r.result?.isError === true && before === after,
      `แถว ${before}→${after} · “${textOf(r)}”`)
  }
  {
    const ref = randomUUID()
    const args = {
      kind: 'expense', category_id: F.catExpense, amount: 777.77, txn_date: TODAY,
      site_id: F.site, note: 'ยิงซ้ำ', client_ref: ref,
    }
    const [{ n: before }] = await sql('select count(*)::int as n from public.transactions')
    const a = jsonOf(await tool(k.url, 'record_transaction', args))
    const b = jsonOf(await tool(k.url, 'record_transaction', args))
    const [{ n: after }] = await sql('select count(*)::int as n from public.transactions')
    check('R6-TOOL-06 เรียกซ้ำด้วย client_ref เดิม → duplicate: true และแถวเพิ่มแค่ 1',
      a?.duplicate === false && b?.duplicate === true
        && a?.transaction_id === b?.transaction_id && after - before === 1,
      `แถว ${before}→${after} · duplicate=${b?.duplicate}`)
  }

  // ══ 3 · ลงชื่อคนเข้าโครงการ ═══════════════════════════════════════════
  {
    // คนที่สองไปลงชื่อโครงการอื่นไว้ก่อนแล้ว — ชุดนี้ต้องได้ 1 สำเร็จ 1 ตก
    await sql(`insert into public.attendance (site_id, employee_id, work_date, work_units)
               values (${q(F.otherSite)}, ${q(F.emp2)}, ${q(TODAY)}, 1)`)
    const r = await tool(k.url, 'record_attendance', {
      site_id: F.site,
      entries: [{ employee_id: F.emp, work_units: 1 }, { employee_id: F.emp2, work_units: 1 }],
    })
    const j = jsonOf(r)
    check('R6-TOOL-07 คนหนึ่งลงชื่อโครงการอื่นไปแล้ว → คนที่เหลือยังลงสำเร็จ และคนนั้นอยู่ใน skipped พร้อมเหตุผล',
      j?.recorded?.length === 1 && j?.skipped?.length === 1
        && j.recorded[0].employee_id === F.emp && j.skipped[0].reason?.length > 0,
      `recorded=${j?.recorded?.length} skipped=${j?.skipped?.[0]?.reason ?? '—'}`)
  }
  {
    const j = jsonOf(await tool(k.url, 'list_employees', { on_date: TODAY }))
    const two = (j?.employees ?? []).find((e) => e.id === F.emp2)
    check('R6-TOOL-08 list_employees บอกว่าวันนั้นใครอยู่โครงการไหนแล้ว (attendance_on_date)',
      two?.attendance_on_date?.site_id === F.otherSite,
      `คนงานสอง → ${two?.attendance_on_date?.site_name ?? 'ว่าง'}`)
  }

  // ══ 4 · เบิกล่วงหน้า — เบิกเกินได้ แต่ต้องบอก AI ว่าเกิน ═════════
  // เจ้าของสั่ง 20 ก.ย. 2569 ให้เบิกเกินได้ · สิ่งที่ต้องยืนยันจึงไม่ใช่
  // "ถูกปฏิเสธ" อีกต่อไป แต่เป็น **คำตอบต้องพกคำเตือนกลับไปให้แชท**
  // ไม่งั้น AI จะรายงานว่าสำเร็จเฉย ๆ แล้วเจ้าของไม่มีวันรู้ว่าจ่ายเกินไปเท่าไหร่
  {
    const over = jsonOf(await tool(k.url, 'record_advance', { employee_id: F.emp, amount: 999999 }))
    const small = jsonOf(await tool(k.url, 'record_advance', { employee_id: F.emp, amount: 100 }))
    check('R6-TOOL-09 เบิกเกินค่าแรงค้างจ่าย → ok:true พร้อม overdrawn:true และ balance ติดลบ',
      over?.ok === true && over?.overdrawn === true && Number(over?.balance) < 0
        && small?.ok === true,
      `เกิน: ok=${over?.ok} overdrawn=${over?.overdrawn} balance=${over?.balance}`)

    // วันในอนาคตยังต้องถูกปฏิเสธ — ห้ามหลวมไปพร้อมกับการปลดเพดาน
    const future = await tool(k.url, 'record_advance', {
      employee_id: F.emp, amount: 50,
      advance_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    })
    check('R6-TOOL-09b เบิกลงวันในอนาคต → ยังถูกปฏิเสธ (DATE_FUTURE)',
      future.result?.isError === true && /อนาคต/.test(textOf(future)),
      `“${textOf(future)}”`)
  }

  // ══ 5 · แก้และลบ ══════════════════════════════════════════════════
  {
    const upd = jsonOf(await tool(k.url, 'update_transaction', { transaction_id: txnId, amount: 2000 }))
    const [row] = await sql(`select amount::text, note from public.transactions where id = ${q(txnId)}`)
    const del = jsonOf(await tool(k.url, 'delete_transaction', { transaction_id: txnId }))
    const [{ n }] = await sql(`select count(*)::int as n from public.transactions where id = ${q(txnId)}`)
    const [{ n: audits }] = await sql(`
      select count(*)::int as n from public.audit_log
      where table_name = 'transactions' and row_id = ${q(txnId)} and mcp_key_id = ${q(k.id)}`)
    check('R6-TOOL-10 แก้แล้วลบ → คืน before/after · แถวหายจริง · audit_log ติดป้ายคีย์ครบทุกครั้ง',
      upd?.before?.amount !== undefined && Number(upd?.after?.amount) === 2000
        && row?.note === 'ค่าทางด่วนจากสลิป' && del?.ok === true && n === 0 && audits >= 3,
      `after=${upd?.after?.amount} note=${row?.note ?? '(หาย)'} เหลือ ${n} แถว · audit ${audits} แถว`)
  }

  // ══ 6 · ความปลอดภัย ══════════════════════════════════════════════
  {
    const rk = await mkKey('เพิกถอนแล้ว')
    await sql(`update public.mcp_keys set revoked_at = now() where id = ${q(rk.id)}`)
    const [{ n: before }] = await sql('select count(*)::int as n from public.transactions')
    const r = await tool(rk.url, 'record_transaction', {
      kind: 'expense', category_id: F.catExpense, amount: 1, txn_date: TODAY, site_id: F.site,
    })
    const [{ n: after }] = await sql('select count(*)::int as n from public.transactions')
    check('R6-SEC-09 คีย์ที่เพิกถอนแล้วเรียก record_transaction → 401 และไม่มีแถวเกิดขึ้น',
      r.status === 401 && before === after, `${r.status} · แถว ${before}→${after}`)
  }
  {
    // ⚠️ ค่าลับอยู่ในตารางอื่นอยู่แล้ว — ตรวจว่าคำตอบของ tool ฝั่งเขียนไม่พามันออกไป
    const blob = [
      textOf(await tool(k.url, 'list_employees', {})),
      textOf(await tool(k.url, 'list_categories', {})),
      textOf(await tool(k.url, 'record_attendance', { site_id: F.site, entries: [{ employee_id: F.emp }] })),
    ].join('\n')
    const leaked = ['pin_hash', 'key_hash', 'object_key', 'client_phone', '@staff.invalid']
      .filter((f) => blob.includes(f))
    check('R6-SEC-10 คำตอบของ tool ฝั่งเขียนไม่มีฟิลด์ใน blocklist หลุดออกไป',
      leaked.length === 0, leaked.join(', ') || `สะอาด (${blob.length} ตัวอักษร)`)
  }
  {
    // เติมร่องรอย 60 ครั้งในนาทีที่แล้ว แล้วยิงจริงอีกครั้ง — ต้องโดนกั้น
    const rk = await mkKey('เพดานเรียก')
    await sql(`
      insert into public.mcp_call_log (key_id, tool, ok, ms, at)
      select ${q(rk.id)}, 'list_sites', true, 5, now() - interval '10 seconds'
      from generate_series(1, 60)`)
    const [{ n: before }] = await sql('select count(*)::int as n from public.transactions')
    const r = await tool(rk.url, 'record_transaction', {
      kind: 'expense', category_id: F.catExpense, amount: 1, txn_date: TODAY, site_id: F.site,
    })
    const [{ n: after }] = await sql('select count(*)::int as n from public.transactions')
    check('R6-TOOL-11 เกินเพดาน 60 ครั้ง/นาที → ตัวเขียนก็โดนกั้น และไม่มีแถวเกิดขึ้น',
      r.result?.isError === true && textOf(r).includes('เรียกถี่') && before === after,
      `“${textOf(r)}” · แถว ${before}→${after}`)
  }
} finally {
  // 🔴 คืนฐานข้อมูลให้เหมือนตอนที่เจอ — ลบเฉพาะของที่สคริปต์นี้สร้าง
  const ids = [F.site, F.otherSite].map(q).join(',')
  await sql(`
    delete from public.advances    where employee_id in (${q(F.emp)}, ${q(F.emp2)});
    delete from public.attendance  where site_id in (${ids});
    delete from public.transactions where site_id in (${ids});
    delete from public.employee_wages where employee_id in (${q(F.emp)}, ${q(F.emp2)});
    delete from public.employees   where id in (${q(F.emp)}, ${q(F.emp2)});
    delete from public.categories  where id in (${q(F.catExpense)}, ${q(F.catIncome)});
    delete from public.sites       where id in (${ids});
    delete from public.mcp_call_log where key_id in (${keyIds.map(q).join(',') || 'null'});
    delete from public.mcp_keys    where id in (${keyIds.map(q).join(',') || 'null'})`)
    .catch((e) => console.error('⚠️  ล้างข้อมูลซ้อมไม่สำเร็จ — ตรวจด้วยมือ:', e.message))
}

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass === results.length ? '✅' : '❌'} ผ่าน ${pass}/${results.length} แถว\n`)
process.exit(pass === results.length ? 0 : 1)
