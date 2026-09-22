export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      advances: {
        Row: {
          advance_date: string
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          deducted_amount: number
          employee_id: string
          id: string
          mcp_key_id: string | null
          note: string | null
          pay_method: Database["public"]["Enums"]["pay_method"]
          payroll_run_id: string | null
          rejected_reason: string | null
          site_id: string | null
          status: Database["public"]["Enums"]["advance_status"]
          updated_at: string
        }
        Insert: {
          advance_date: string
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deducted_amount?: number
          employee_id: string
          id?: string
          mcp_key_id?: string | null
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
          payroll_run_id?: string | null
          rejected_reason?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["advance_status"]
          updated_at?: string
        }
        Update: {
          advance_date?: string
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deducted_amount?: number
          employee_id?: string
          id?: string
          mcp_key_id?: string | null
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
          payroll_run_id?: string | null
          rejected_reason?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["advance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "advances_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_mcp_key_id_fkey"
            columns: ["mcp_key_id"]
            isOneToOne: false
            referencedRelation: "mcp_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          address: string | null
          bank_account: string | null
          branch_label: string | null
          doc_footer: string | null
          email: string | null
          id: boolean
          phone: string | null
          signatory_name: string | null
          signatory_title: string | null
          slip_retention_years: number | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank_account?: string | null
          branch_label?: string | null
          doc_footer?: string | null
          email?: string | null
          id?: boolean
          phone?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          slip_retention_years?: number | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank_account?: string | null
          branch_label?: string | null
          doc_footer?: string | null
          email?: string | null
          id?: boolean
          phone?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          slip_retention_years?: number | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      attachments: {
        Row: {
          byte_size: number
          content_type: string
          created_at: string
          id: string
          object_key: string
          thumb_key: string
          transaction_id: string
        }
        Insert: {
          byte_size: number
          content_type: string
          created_at?: string
          id?: string
          object_key: string
          thumb_key: string
          transaction_id: string
        }
        Update: {
          byte_size?: number
          content_type?: string
          created_at?: string
          id?: string
          object_key?: string
          thumb_key?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          mcp_key_id: string | null
          note: string | null
          site_id: string
          updated_at: string
          work_date: string
          work_units: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          mcp_key_id?: string | null
          note?: string | null
          site_id: string
          updated_at?: string
          work_date: string
          work_units?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          mcp_key_id?: string | null
          note?: string | null
          site_id?: string
          updated_at?: string
          work_date?: string
          work_units?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_mcp_key_id_fkey"
            columns: ["mcp_key_id"]
            isOneToOne: false
            referencedRelation: "mcp_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_adjustments: {
        Row: {
          amount: number
          attendance_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["adjust_kind"]
          name: string
          preset_id: string | null
        }
        Insert: {
          amount: number
          attendance_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["adjust_kind"]
          name: string
          preset_id?: string | null
        }
        Update: {
          amount?: number
          attendance_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["adjust_kind"]
          name?: string
          preset_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_adjustments_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_adjustments_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "wage_adjustment_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_wages: {
        Row: {
          amount: number | null
          attendance_id: string
          ot_amount: number
          updated_at: string
          wage_snapshot: number
          work_units: number
        }
        Insert: {
          amount?: number | null
          attendance_id: string
          ot_amount?: number
          updated_at?: string
          wage_snapshot?: number
          work_units: number
        }
        Update: {
          amount?: number | null
          attendance_id?: string
          ot_amount?: number
          updated_at?: string
          wage_snapshot?: number
          work_units?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_wages_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: true
            referencedRelation: "attendance"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          after: Json | null
          at: string
          before: Json | null
          id: number
          mcp_key_id: string | null
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          id?: number
          mcp_key_id?: string | null
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          id?: number
          mcp_key_id?: string | null
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      branding: {
        Row: {
          company_name: string
          id: boolean
          logo_object_key: string | null
          updated_at: string
        }
        Insert: {
          company_name?: string
          id?: boolean
          logo_object_key?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string
          id?: boolean
          logo_object_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_material: boolean
          kind: Database["public"]["Enums"]["txn_kind"]
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_material?: boolean
          kind: Database["public"]["Enums"]["txn_kind"]
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_material?: boolean
          kind?: Database["public"]["Enums"]["txn_kind"]
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          branch: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          branch?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          branch?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      doc_counters: {
        Row: {
          kind: Database["public"]["Enums"]["doc_kind"]
          last_no: number
          pad: number
          prefix: string
          updated_at: string
        }
        Insert: {
          kind: Database["public"]["Enums"]["doc_kind"]
          last_no: number
          pad: number
          prefix: string
          updated_at?: string
        }
        Update: {
          kind?: Database["public"]["Enums"]["doc_kind"]
          last_no?: number
          pad?: number
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_lines: {
        Row: {
          created_at: string
          description: string
          document_id: string
          id: string
          line_total: number
          qty: number
          seq: number
          unit: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          document_id: string
          id?: string
          line_total?: number
          qty?: number
          seq: number
          unit?: string | null
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          document_id?: string
          id?: string
          line_total?: number
          qty?: number
          seq?: number
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_lines_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          accepted_at: string | null
          amount_words: string
          created_at: string
          created_by: string | null
          customer_address: string | null
          customer_branch: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          customer_tax_id: string | null
          doc_date: string
          doc_no: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          kind: Database["public"]["Enums"]["doc_kind"]
          note: string | null
          seller: Json | null
          sent_at: string | null
          site_id: string | null
          source_document_id: string | null
          status: Database["public"]["Enums"]["doc_status"]
          subtotal: number
          total: number
          txn_id: string | null
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_mode: Database["public"]["Enums"]["vat_mode"]
          vat_rate: number
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          amount_words?: string
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_branch?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          customer_tax_id?: string | null
          doc_date: string
          doc_no?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          kind: Database["public"]["Enums"]["doc_kind"]
          note?: string | null
          seller?: Json | null
          sent_at?: string | null
          site_id?: string | null
          source_document_id?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          subtotal?: number
          total?: number
          txn_id?: string | null
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_mode?: Database["public"]["Enums"]["vat_mode"]
          vat_rate?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          amount_words?: string
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_branch?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          customer_tax_id?: string | null
          doc_date?: string
          doc_no?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          kind?: Database["public"]["Enums"]["doc_kind"]
          note?: string | null
          seller?: Json | null
          sent_at?: string | null
          site_id?: string | null
          source_document_id?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          subtotal?: number
          total?: number
          txn_id?: string | null
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_mode?: Database["public"]["Enums"]["vat_mode"]
          vat_rate?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_txn_id_fkey"
            columns: ["txn_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_wages: {
        Row: {
          daily_rate: number | null
          employee_id: string
          monthly_salary: number | null
          updated_at: string
          wage_type: Database["public"]["Enums"]["wage_type"]
        }
        Insert: {
          daily_rate?: number | null
          employee_id: string
          monthly_salary?: number | null
          updated_at?: string
          wage_type?: Database["public"]["Enums"]["wage_type"]
        }
        Update: {
          daily_rate?: number | null
          employee_id?: string
          monthly_salary?: number | null
          updated_at?: string
          wage_type?: Database["public"]["Enums"]["wage_type"]
        }
        Relationships: [
          {
            foreignKeyName: "employee_wages_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          default_site_id: string | null
          full_name: string
          id: string
          is_active: boolean
          job_title: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_site_id?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_site_id?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_default_site_id_fkey"
            columns: ["default_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          at: string
          id: number
          identifier: string | null
          ip: string | null
          kind: string
          ok: boolean
        }
        Insert: {
          at?: string
          id?: number
          identifier?: string | null
          ip?: string | null
          kind: string
          ok: boolean
        }
        Update: {
          at?: string
          id?: number
          identifier?: string | null
          ip?: string | null
          kind?: string
          ok?: boolean
        }
        Relationships: []
      }
      mcp_call_log: {
        Row: {
          at: string
          error: string | null
          id: string
          key_id: string
          ms: number | null
          ok: boolean
          tool: string
        }
        Insert: {
          at?: string
          error?: string | null
          id?: string
          key_id: string
          ms?: number | null
          ok: boolean
          tool: string
        }
        Update: {
          at?: string
          error?: string | null
          id?: string
          key_id?: string
          ms?: number | null
          ok?: boolean
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_call_log_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "mcp_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_keys: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at?: string | null
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          digest_date: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link: string | null
          pushed_at: string | null
          read_at: string | null
          title: string
          txn_id: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          digest_date?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          pushed_at?: string | null
          read_at?: string | null
          title: string
          txn_id?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          digest_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          pushed_at?: string | null
          read_at?: string | null
          title?: string
          txn_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_txn_id_fkey"
            columns: ["txn_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_lines: {
        Row: {
          accrued: number
          advance_deducted: number
          created_at: string
          days: number
          employee_id: string
          id: string
          net_paid: number
          run_id: string
        }
        Insert: {
          accrued?: number
          advance_deducted?: number
          created_at?: string
          days?: number
          employee_id: string
          id?: string
          net_paid?: number
          run_id: string
        }
        Update: {
          accrued?: number
          advance_deducted?: number
          created_at?: string
          days?: number
          employee_id?: string
          id?: string
          net_paid?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          employee_id: string | null
          id: string
          period_end: string
          period_start: string
          site_id: string | null
          status: Database["public"]["Enums"]["payroll_status"]
          total_accrued: number
          total_advance_deducted: number
          total_paid: number
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          period_end: string
          period_start: string
          site_id?: string | null
          status?: Database["public"]["Enums"]["payroll_status"]
          total_accrued?: number
          total_advance_deducted?: number
          total_paid?: number
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          period_end?: string
          period_start?: string
          site_id?: string | null
          status?: Database["public"]["Enums"]["payroll_status"]
          total_accrued?: number
          total_advance_deducted?: number
          total_paid?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          pin_hash: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          is_active?: boolean
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_ok_at: string | null
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_ok_at?: string | null
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_ok_at?: string | null
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          created_by: string | null
          day_of_month: number
          employee_id: string | null
          end_month: string | null
          id: string
          is_active: boolean
          name: string
          note: string | null
          pay_method: Database["public"]["Enums"]["pay_method"]
          site_id: string | null
          start_month: string
          updated_at: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          created_by?: string | null
          day_of_month?: number
          employee_id?: string | null
          end_month?: string | null
          id?: string
          is_active?: boolean
          name: string
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
          site_id?: string | null
          start_month: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          created_by?: string | null
          day_of_month?: number
          employee_id?: string | null
          end_month?: string | null
          id?: string
          is_active?: boolean
          name?: string
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
          site_id?: string | null
          start_month?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_finance: {
        Row: {
          bond_amount: number
          bond_kind: Database["public"]["Enums"]["bond_kind"] | null
          bond_ref: string | null
          bond_return_txn_id: string | null
          bond_returned_amount: number | null
          bond_returned_at: string | null
          contract_amount: number
          contract_date: string | null
          contract_no: string | null
          created_at: string
          handover_date: string | null
          site_id: string
          updated_at: string
          warranty_end: string | null
          warranty_months: number
        }
        Insert: {
          bond_amount?: number
          bond_kind?: Database["public"]["Enums"]["bond_kind"] | null
          bond_ref?: string | null
          bond_return_txn_id?: string | null
          bond_returned_amount?: number | null
          bond_returned_at?: string | null
          contract_amount?: number
          contract_date?: string | null
          contract_no?: string | null
          created_at?: string
          handover_date?: string | null
          site_id: string
          updated_at?: string
          warranty_end?: string | null
          warranty_months?: number
        }
        Update: {
          bond_amount?: number
          bond_kind?: Database["public"]["Enums"]["bond_kind"] | null
          bond_ref?: string | null
          bond_return_txn_id?: string | null
          bond_returned_amount?: number | null
          bond_returned_at?: string | null
          contract_amount?: number
          contract_date?: string | null
          contract_no?: string | null
          created_at?: string
          handover_date?: string | null
          site_id?: string
          updated_at?: string
          warranty_end?: string | null
          warranty_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_finance_bond_return_txn_id_fkey"
            columns: ["bond_return_txn_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_finance_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_milestones: {
        Row: {
          created_at: string
          id: string
          name: string
          planned_amount: number
          planned_date: string | null
          seq: number
          site_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          planned_amount?: number
          planned_date?: string | null
          seq: number
          site_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          planned_amount?: number
          planned_date?: string | null
          seq?: number
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_milestones_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_supervisors: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          profile_id: string
          site_id: string
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          profile_id: string
          site_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          profile_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_supervisors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_supervisors_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          client_name: string | null
          client_phone: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          status: Database["public"]["Enums"]["site_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["site_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["site_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          category_id: string
          client_ref: string | null
          created_at: string
          created_by: string | null
          id: string
          income_kind: Database["public"]["Enums"]["income_kind"] | null
          installment_no: number | null
          kind: Database["public"]["Enums"]["txn_kind"]
          mcp_key_id: string | null
          note: string | null
          pay_method: Database["public"]["Enums"]["pay_method"]
          period_month: string | null
          recurring_id: string | null
          rejected_reason: string | null
          site_id: string | null
          status: Database["public"]["Enums"]["txn_status"]
          txn_date: string
          updated_at: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          category_id: string
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          income_kind?: Database["public"]["Enums"]["income_kind"] | null
          installment_no?: number | null
          kind: Database["public"]["Enums"]["txn_kind"]
          mcp_key_id?: string | null
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
          period_month?: string | null
          recurring_id?: string | null
          rejected_reason?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["txn_status"]
          txn_date: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          category_id?: string
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          income_kind?: Database["public"]["Enums"]["income_kind"] | null
          installment_no?: number | null
          kind?: Database["public"]["Enums"]["txn_kind"]
          mcp_key_id?: string | null
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
          period_month?: string | null
          recurring_id?: string | null
          rejected_reason?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["txn_status"]
          txn_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_mcp_key_id_fkey"
            columns: ["mcp_key_id"]
            isOneToOne: false
            referencedRelation: "mcp_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_intents: {
        Row: {
          consumed_at: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          object_key: string
          site_id: string | null
          thumb_key: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          object_key: string
          site_id?: string | null
          thumb_key: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          object_key?: string
          site_id?: string | null
          thumb_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_intents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_intents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      wage_adjustment_presets: {
        Row: {
          amount: number
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["adjust_kind"]
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["adjust_kind"]
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["adjust_kind"]
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attendance_by_site: {
        Args: { p_from: string; p_to: string }
        Returns: {
          amount: number
          days: number
          employee_id: string
          employee_work_days: number
          full_name: string
          job_title: string
          site_id: string
          site_name: string
          site_work_days: number
        }[]
      }
      attendance_grid: {
        Args: { p_from: string; p_to: string }
        Returns: {
          amount: number
          attendance_id: string
          employee_id: string
          ot_amount: number
          paid: boolean
          site_id: string
          site_name: string
          wage_snapshot: number
          work_date: string
          work_units: number
        }[]
      }
      attendance_paid: {
        Args: { p_employee: string; p_site: string; p_work_date: string }
        Returns: boolean
      }
      bond_status: {
        Args: { p_on: string; p_soon_days?: number }
        Returns: {
          bond_amount: number
          bond_kind: Database["public"]["Enums"]["bond_kind"]
          bond_ref: string
          bond_return_txn_id: string
          bond_returned_amount: number
          bond_returned_at: string
          contract_amount: number
          contract_date: string
          contract_no: string
          days_left: number
          handover_date: string
          site_id: string
          site_name: string
          site_status: Database["public"]["Enums"]["site_status"]
          status: string
          warranty_end: string
          warranty_months: number
        }[]
      }
      bond_summary: {
        Args: { p_on: string; p_soon_days?: number }
        Returns: {
          due_soon_amount: number
          due_soon_count: number
          event_count: number
          overdue_amount: number
          overdue_count: number
        }[]
      }
      close_payroll_run: {
        Args: { p_run: string }
        Returns: {
          accrued: number
          deducted: number
          lines: number
          paid: number
        }[]
      }
      cron_call: { Args: { p_path: string }; Returns: number }
      delete_employee: { Args: { p_id: string }; Returns: Json }
      doc_recalc: { Args: { p_doc: string }; Returns: undefined }
      employee_balance: {
        Args: { p_employee: string }
        Returns: {
          accrued: number
          advanced: number
          balance: number
        }[]
      }
      employee_balance_raw: {
        Args: { p_employee: string }
        Returns: {
          accrued: number
          advanced: number
          balance: number
        }[]
      }
      employees_delete_info: {
        Args: never
        Returns: {
          advance_count: number
          employee_id: string
          open_advance: number
          payroll_lines: number
          unpaid_wage: number
          work_days: number
        }[]
      }
      gen_recurring: {
        Args: { p_rule: string; p_through: string }
        Returns: number
      }
      is_owner: { Args: never; Returns: boolean }
      issue_document: {
        Args: { p_id: string; p_seller: Json }
        Returns: string
      }
      mcp_assume_owner: { Args: { p_actor: string }; Returns: undefined }
      mcp_begin_write: {
        Args: { p_actor: string; p_key: string }
        Returns: undefined
      }
      mcp_categories: {
        Args: { p_actor: string; p_kind?: string }
        Returns: Json
      }
      mcp_create_advance: {
        Args: {
          p_actor: string
          p_amount: number
          p_date: string
          p_employee: string
          p_key: string
          p_note?: string
          p_pay_method?: string
          p_site?: string
        }
        Returns: Json
      }
      mcp_create_transaction: {
        Args: {
          p_actor: string
          p_amount: number
          p_category: string
          p_client_ref?: string
          p_date: string
          p_income_kind?: string
          p_installment_no?: number
          p_key: string
          p_kind: string
          p_note?: string
          p_pay_method?: string
          p_site?: string
        }
        Returns: Json
      }
      mcp_delete_transaction: {
        Args: { p_actor: string; p_id: string; p_key: string }
        Returns: Json
      }
      mcp_employees: {
        Args: { p_actor: string; p_limit?: number; p_on?: string }
        Returns: Json
      }
      mcp_overview: { Args: { p_actor: string; p_on?: string }; Returns: Json }
      mcp_payroll: {
        Args: { p_actor: string; p_limit?: number }
        Returns: Json
      }
      mcp_pending: {
        Args: { p_actor: string; p_limit?: number }
        Returns: Json
      }
      mcp_record_attendance: {
        Args: {
          p_actor: string
          p_date: string
          p_entries: Json
          p_key: string
          p_site: string
        }
        Returns: Json
      }
      mcp_site_detail: {
        Args: { p_actor: string; p_site: string }
        Returns: Json
      }
      mcp_sites: {
        Args: {
          p_actor: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: Json
      }
      mcp_transactions: {
        Args: {
          p_actor: string
          p_from?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_site?: string
          p_status?: string
          p_terms?: string[]
          p_to?: string
        }
        Returns: Json
      }
      mcp_update_transaction: {
        Args: { p_actor: string; p_id: string; p_key: string; p_patch: Json }
        Returns: Json
      }
      next_doc_no: {
        Args: { p_kind: Database["public"]["Enums"]["doc_kind"] }
        Returns: string
      }
      pay_employee_wage: {
        Args: { p_employee: string }
        Returns: {
          accrued: number
          days: number
          deducted: number
          paid: number
          run_id: string
        }[]
      }
      payroll_adjustment_days: {
        Args: never
        Returns: {
          days: string[]
          employee_id: string
          kind: Database["public"]["Enums"]["adjust_kind"]
          name: string
          times: number
          total: number
        }[]
      }
      payroll_balances: {
        Args: never
        Returns: {
          accrued: number
          advanced: number
          balance: number
          base: number
          days: number
          deduct: number
          employee_id: string
          extra: number
          full_name: string
          job_title: string
        }[]
      }
      payroll_outstanding: {
        Args: never
        Returns: {
          accrued: number
          advanced: number
          balance: number
          people: number
        }[]
      }
      recurring_status: {
        Args: { p_through: string }
        Returns: {
          due_months: number
          id: string
          last_month: string
          posted_months: number
          posted_total: number
        }[]
      }
      report_by_category: {
        Args: { p_from?: string; p_site?: string; p_to?: string }
        Returns: {
          category_id: string
          item_count: number
          kind: Database["public"]["Enums"]["txn_kind"]
          name: string
          total: number
        }[]
      }
      report_by_site: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cost_total: number
          expense: number
          income: number
          name: string
          profit: number
          site_id: string
          wage: number
        }[]
      }
      report_labor: {
        Args: { p_from: string; p_site?: string; p_to: string }
        Returns: {
          advance_paid: number
          ot_total: number
          payroll_paid: number
          wage_total: number
          work_days: number
          work_units: number
          worker_count: number
        }[]
      }
      report_series: {
        Args: {
          p_from: string
          p_grain?: string
          p_site?: string
          p_to: string
        }
        Returns: {
          bucket: string
          expense: number
          income: number
          wage: number
        }[]
      }
      report_summary: {
        Args: { p_from: string; p_site?: string; p_to: string }
        Returns: {
          advance_paid: number
          cost_total: number
          expense_approved: number
          expense_cash: number
          expense_pending: number
          expense_transfer: number
          income_approved: number
          income_pending: number
          payroll_paid: number
          profit: number
          txn_count: number
          wage_cost: number
        }[]
      }
      report_top_workers: {
        Args: { p_from: string; p_site?: string; p_to: string }
        Returns: {
          employee_id: string
          full_name: string
          wage_total: number
          work_units: number
        }[]
      }
      run_recurring_expense: {
        Args: { p_rule: string; p_through: string }
        Returns: number
      }
      run_recurring_expenses: { Args: { p_through: string }; Returns: number }
      save_attendance_day: {
        Args: {
          p_date: string
          p_employee: string
          p_ot?: number
          p_site: string
          p_wage: number
          p_work_units: number
        }
        Returns: string
      }
      save_employee: {
        Args: {
          p_daily: number
          p_default_site: string
          p_full_name: string
          p_id: string
          p_is_active: boolean
          p_job_title: string
          p_monthly: number
          p_profile: string
          p_wage_type: Database["public"]["Enums"]["wage_type"]
        }
        Returns: string
      }
      set_attendance_ot: {
        Args: { p_att: string; p_ot: number }
        Returns: undefined
      }
      site_day_wage: { Args: { p_on: string; p_site: string }; Returns: number }
      site_money: {
        Args: { p_site?: string }
        Returns: {
          attendance_days: number
          contract_amount: number
          cost_expense: number
          cost_material: number
          cost_pending: number
          cost_total: number
          cost_wage: number
          income_approved: number
          income_pending: number
          site_id: string
        }[]
      }
      site_overview: {
        Args: { p_on: string }
        Returns: {
          active_contract: number
          active_cost: number
          active_count: number
          active_income: number
          due_soon_count: number
          overdue_count: number
          pending_count: number
          pending_total: number
          total_count: number
        }[]
      }
      supervises_site: {
        Args: { p_on?: string; p_site: string }
        Returns: boolean
      }
    }
    Enums: {
      adjust_kind: "add" | "deduct"
      advance_status: "pending" | "approved" | "rejected"
      bond_kind: "cash" | "bank_guarantee"
      doc_kind: "quotation" | "invoice" | "receipt"
      doc_status: "draft" | "issued" | "sent" | "accepted" | "void"
      income_kind: "deposit" | "installment" | "variation_order" | "other"
      notification_kind:
        | "txn_pending"
        | "txn_approved"
        | "txn_rejected"
        | "daily_digest"
        | "advance_pending"
        | "advance_approved"
        | "advance_rejected"
      pay_method: "cash" | "transfer"
      payroll_status: "open" | "closed"
      site_status: "planning" | "active" | "paused" | "done" | "cancelled"
      txn_kind: "income" | "expense"
      txn_status: "pending" | "approved" | "rejected"
      user_role: "owner" | "site_supervisor"
      vat_mode: "inclusive" | "exclusive" | "none"
      wage_type: "daily" | "monthly"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      adjust_kind: ["add", "deduct"],
      advance_status: ["pending", "approved", "rejected"],
      bond_kind: ["cash", "bank_guarantee"],
      doc_kind: ["quotation", "invoice", "receipt"],
      doc_status: ["draft", "issued", "sent", "accepted", "void"],
      income_kind: ["deposit", "installment", "variation_order", "other"],
      notification_kind: [
        "txn_pending",
        "txn_approved",
        "txn_rejected",
        "daily_digest",
        "advance_pending",
        "advance_approved",
        "advance_rejected",
      ],
      pay_method: ["cash", "transfer"],
      payroll_status: ["open", "closed"],
      site_status: ["planning", "active", "paused", "done", "cancelled"],
      txn_kind: ["income", "expense"],
      txn_status: ["pending", "approved", "rejected"],
      user_role: ["owner", "site_supervisor"],
      vat_mode: ["inclusive", "exclusive", "none"],
      wage_type: ["daily", "monthly"],
    },
  },
} as const
