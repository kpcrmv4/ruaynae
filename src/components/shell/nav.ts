import {
  CalendarDays,
  Home,
  Inbox,
  Plug,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import type { Database } from '@/lib/database.types'

export type Role = Database['public']['Enums']['user_role']

/**
 * เมนูทั้งหมด — มาจากเดโม่ที่อนุมัติแล้ว (docs/design/DESIGN.md §4)
 * ห้ามคิดใหม่ · เพิ่ม/ลด ต้องกลับไปแก้เดโม่ก่อน
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
}

export type NavGroup = { heading: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    heading: 'หลัก',
    items: [
      { href: '/', label: 'ภาพรวม', sub: 'สรุปเงินและทุกไซต์', icon: Home },
      { href: '/sites', label: 'ไซต์งาน', sub: 'โปรเจ็คที่กำลังทำ', icon: Warehouse },
      { href: '/ledger', label: 'รายรับ-รายจ่าย', sub: 'ทุกรายการ ค้นหาและกรอง', icon: Receipt },
    ],
  },
  {
    heading: 'คนและค่าแรง',
    items: [
      { href: '/attendance', label: 'คนเข้าไซต์', sub: 'ลงชื่อรายวัน', icon: CalendarDays },
      // เจ้าของเท่านั้น — เบิกและรอบจ่ายเป็นเรื่องเงิน หัวหน้าไซต์ไม่เกี่ยว
      // (คำสั่งเจ้าของ 31 ส.ค. 2569) · CRUD คนงานอยู่ที่ /settings/users
      {
        href: '/payroll',
        label: 'ค่าแรงและรอบจ่าย',
        sub: 'ค้างจ่าย เบิก ปิดรอบ',
        icon: Users,
        ownerOnly: true,
      },
    ],
  },
  {
    heading: 'เจ้าของ',
    items: [
      {
        href: '/approvals',
        label: 'รออนุมัติ',
        sub: 'รายจ่ายที่หัวหน้าไซต์คีย์',
        icon: Inbox,
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
export function navFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.ownerOnly || role === 'owner'),
  })).filter((g) => g.items.length > 0)
}

/** ปุ่มกลางของแถบล่าง — งานที่ทำบ่อยที่สุดของทั้งสอง role */
export const PRIMARY_ACTION = { href: '/entry', label: 'บันทึกรายจ่าย' }

/** 4 ช่องแรกของแถบล่าง (ช่องที่ 5 คือ "เพิ่มเติม" เสมอ) */
export const BOTTOM_NAV: NavItem[] = [
  { href: '/', label: 'ภาพรวม', sub: '', icon: Home },
  { href: '/sites', label: 'ไซต์งาน', sub: '', icon: Warehouse },
  { href: '/attendance', label: 'คนเข้าไซต์', sub: '', icon: CalendarDays },
]
