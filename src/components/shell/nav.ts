import {
  Banknote,
  BarChart3,
  CalendarDays,
  FileText,
  HandCoins,
  Home,
  Inbox,
  Plug,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import type { Database } from '@/lib/database.types'

export type Role = Database['public']['Enums']['user_role']

/**
 * เมนูทั้งหมด — โครงตามเดโม่ที่อนุมัติแล้ว (docs/design/DESIGN.md §4)
 * ปรับรอบรีดีไซน์มือถือ 31 ส.ค. 2569 ตามคำสั่งเจ้าของ (DESIGN.md §4.1):
 * หน้าแรกเป็น "วันนี้" · แถบล่างจัดช่องตาม role · ปุ่มกลางเปิดแผ่นบันทึกประจำวัน
 *
 * ที่เก็บเป็นไฟล์เดียว ไม่ใช่เขียนซ้ำใน sidebar กับ bottom nav
 * เพราะสองที่จะเพี้ยนจากกันทันทีที่มีคนเพิ่มเมนูแล้วแก้แค่ที่เดียว
 */
export type NavItem = {
  href: string
  label: string
  sub: string
  icon: LucideIcon
  ownerOnly?: boolean
  /** เห็นเฉพาะหัวหน้าโครงการ — งานที่เจ้าของทำจากอีกหน้าหนึ่งอยู่แล้ว
   *  (เจ้าของเบิกให้ลูกน้องที่ `/payroll` ซึ่งจ่ายทันที ไม่ต้องยื่นคำขอกับตัวเอง) */
  supervisorOnly?: boolean
}

export type NavGroup = { heading: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    heading: 'หลัก',
    items: [
      { href: '/', label: 'วันนี้', sub: 'งานประจำวันและสรุปทุกโครงการ', icon: Home },
      { href: '/sites', label: 'โครงการ', sub: 'งานที่กำลังทำอยู่', icon: Warehouse },
      { href: '/ledger', label: 'รายรับ-รายจ่าย', sub: 'ทุกรายการ ค้นหาและกรอง', icon: Receipt },
      // เอกสารมีค่างานและกำไรอยู่ในตัว จึงเป็นของเจ้าของเหมือน site_finance
      {
        href: '/documents',
        label: 'เอกสาร',
        sub: 'ใบเสนอราคา ใบเสร็จ/ใบกำกับภาษี',
        icon: FileText,
        ownerOnly: true,
      },
    ],
  },
  {
    heading: 'คนและค่าแรง',
    items: [
      { href: '/attendance', label: 'คนเข้าโครงการ', sub: 'ลงชื่อรายวัน', icon: CalendarDays },
      // เจ้าของเท่านั้น — เบิกและรอบจ่ายเป็นเรื่องเงิน หัวหน้าโครงการไม่เกี่ยว
      // (คำสั่งเจ้าของ 31 ส.ค. 2569) · CRUD คนงานอยู่ที่ /settings/users
      {
        href: '/payroll',
        label: 'ค่าแรงและการจ่าย',
        sub: 'ค้างจ่าย เบิก จ่ายค่าแรง',
        icon: Users,
        ownerOnly: true,
      },
      // หัวหน้าโครงการยื่นคำขอเบิกแทนลูกน้อง แล้วเจ้าของอนุมัติทีหลัง
      // (คำสั่งเจ้าของ 21 ก.ย. 2569) · ตัวเลขเงินค่าแรงยังเป็นความลับจากเขา
      {
        href: '/advances',
        label: 'ตั้งเบิกค่าแรง',
        sub: 'ยื่นคำขอแทนลูกน้อง รอเจ้าของอนุมัติ',
        icon: HandCoins,
        supervisorOnly: true,
      },
    ],
  },
  {
    heading: 'เจ้าของ',
    items: [
      {
        href: '/approvals',
        label: 'รออนุมัติ',
        sub: 'รายจ่ายที่หัวหน้าโครงการคีย์',
        icon: Inbox,
        ownerOnly: true,
      },
      {
        href: '/reports',
        label: 'รายงาน',
        sub: 'สรุปเงิน คน และโครงการ ตามเดือน/ปี',
        icon: BarChart3,
        ownerOnly: true,
      },
      {
        href: '/audit',
        label: 'ประวัติการแก้ไข',
        sub: 'ใครแก้อะไร เมื่อไหร่',
        icon: ShieldCheck,
        ownerOnly: true,
      },
      { href: '/settings', label: 'ตั้งค่า', sub: 'แบรนด์ ผู้ใช้ หมวดค่าใช้จ่าย', icon: Settings },
    ],
  },
  {
    heading: 'เชื่อมต่อ',
    items: [
      {
        href: '/mcp',
        label: 'เชื่อมต่อ AI',
        sub: 'ให้ Claude/ChatGPT อ่านข้อมูล',
        icon: Plug,
        ownerOnly: true,
      },
    ],
  },
]

/**
 * เมนูที่ role นี้เห็น
 * ⚠️ นี่คือการ "ซ่อนปุ่ม" ไม่ใช่การควบคุมสิทธิ์ — สิทธิ์จริงอยู่ที่ RLS
 * ซ่อนเมนูแล้วคิดว่าปลอดภัยคือการเข้าใจผิดที่แพงที่สุดเรื่องหนึ่ง
 */
export const visibleTo = (role: Role, i: NavItem | QuickAddItem): boolean =>
  (!i.ownerOnly || role === 'owner') && (!i.supervisorOnly || role === 'site_supervisor')

export function navFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => visibleTo(role, i)),
  })).filter((g) => g.items.length > 0)
}

/**
 * แผ่นบันทึกประจำวัน — เปิดจากปุ่มกลมกลางแถบล่าง
 *
 * ทุกการบันทึกที่ต้องทำทุกวันเริ่มได้จากทุกหน้าใน 2 แตะ · ช่องทางเดิม
 * (เมนู /entry /attendance /payroll) ยังอยู่ครบ อันนี้เป็นทางลัด ไม่ใช่ทางเดียว
 */
export type QuickAddTone = 'expense' | 'income' | 'brand'
export type QuickAddItem = NavItem & { tone: QuickAddTone }

export const QUICK_ADD: QuickAddItem[] = [
  {
    href: '/entry',
    label: 'บันทึกรายจ่าย',
    sub: 'แนบสลิปได้ · งานที่ทำบ่อยที่สุด',
    icon: Wallet,
    tone: 'expense',
  },
  {
    href: '/entry?kind=income',
    label: 'บันทึกรายรับ',
    sub: 'มัดจำ · งวดงาน · ค่างานเพิ่ม',
    icon: Banknote,
    tone: 'income',
    ownerOnly: true,
  },
  {
    href: '/attendance',
    label: 'ลงชื่อคนเข้าโครงการ',
    sub: 'ติ๊กแล้วค่าแรงเข้าต้นทุนโครงการทันที',
    icon: CalendarDays,
    tone: 'brand',
  },
  {
    href: '/payroll',
    label: 'เบิกล่วงหน้า',
    sub: 'เลือกคนแล้วจ่ายได้ทันที',
    icon: HandCoins,
    tone: 'brand',
    ownerOnly: true,
  },
  {
    href: '/advances',
    label: 'ตั้งเบิกค่าแรง',
    sub: 'ยื่นคำขอแทนลูกน้อง รอเจ้าของอนุมัติ',
    icon: HandCoins,
    tone: 'brand',
    supervisorOnly: true,
  },
]

export const quickAddFor = (role: Role): QuickAddItem[] =>
  QUICK_ADD.filter((i) => visibleTo(role, i))

/**
 * 3 ช่องเมนูของแถบล่าง (ช่องกลางคือปุ่มบันทึก · ช่องที่ 5 คือ "เพิ่มเติม" เสมอ)
 *
 * จัดตาม role เพราะงานประจำวันของสองคนไม่เหมือนกัน — หัวหน้าโครงการลงชื่อคนเข้าโครงการ
 * ทุกเช้า ส่วนเจ้าของเคลียร์คิวอนุมัติทุกวัน · /ledger อยู่ทั้งคู่เพราะ
 * "คีย์เสร็จแล้วขอดูว่าลงไหม/โดนตีกลับไหม" คืองานถัดไปของการบันทึกเสมอ
 */
/**
 * ตัวเลข "ของค้างต้องทำ" ต่อเมนู — คีย์คือ `href` ของเมนูนั้น
 *
 * 🔴 นับในฐานข้อมูลที่ `(app)/layout.tsx` ด้วย `head: true, count: 'exact'`
 * เสมอ ห้ามดึงแถวมานับใน JS (CLAUDE.md §7) — เมนูอยู่ทุกหน้า ค่าใช้จ่ายของ
 * การนับผิดวิธีจึงคูณด้วยจำนวนหน้าที่เปิดทั้งวัน
 *
 * ป้ายที่เป็น 0 **ไม่วาดเลย** ไม่ใช่วาดเป็นเลขศูนย์ — ป้ายแดงที่ติดอยู่
 * ตลอดเวลาคือป้ายที่คนเลิกมอง แล้ววันที่มีของค้างจริงก็จะไม่มีใครเห็น
 */
export type NavBadges = Record<string, number>

export const badgeOf = (badges: NavBadges, href: string) => badges[href] ?? 0

/**
 * รวมตัวเลขของเมนูกลุ่มหนึ่ง — ใช้กับปุ่ม "เพิ่มเติม" ของแถบล่าง
 *
 * 🔴 เมนูที่ไม่ได้อยู่บนแถบล่างถูกซ่อนอยู่ในแผ่นนั้น · ถ้าไม่รวมยอดขึ้นมา
 * ตัวเลขของค้างที่อยู่ข้างในจะไม่มีใครเห็นจนกว่าจะบังเอิญกดเปิด
 */
export const badgeTotal = (groups: NavGroup[], badges: NavBadges) =>
  groups.reduce(
    (sum, g) => sum + g.items.reduce((s, i) => s + badgeOf(badges, i.href), 0),
    0,
  )

/** เลขบนป้าย — เกิน 99 ตัดเป็น "99+" ไม่งั้นป้ายกว้างจนดันเมนูเสียรูป */
export const badgeText = (n: number) => (n > 99 ? '99+' : String(n))

export const bottomNavFor = (role: Role): NavItem[] => [
  { href: '/', label: 'วันนี้', sub: '', icon: Home },
  role === 'owner'
    ? { href: '/approvals', label: 'รออนุมัติ', sub: '', icon: Inbox }
    /*
      🔴 ป้ายในแถบล่างสั้นกว่าชื่อเมนูเต็มโดยตั้งใจ — ช่องหนึ่งกว้าง 1/5 ของจอ
      บนจอ 390px เหลือที่ให้ตัวหนังสือ 70px ส่วน "คนเข้าโครงการ" ที่ 10.5px
      กว้าง 74px จึงถูก `truncate` ตัดเป็น "คนเข้าโครงกา…" ซึ่งอ่านแล้วเดาไม่ออก
      · ชื่อเต็มยังอยู่ครบในแถบข้างและในแผ่น "เพิ่มเติม"
    */
    : { href: '/attendance', label: 'คนเข้างาน', sub: '', icon: CalendarDays },
  { href: '/ledger', label: 'รายการ', sub: '', icon: Receipt },
]
