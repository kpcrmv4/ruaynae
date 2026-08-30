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
      app_settings: {
        Row: {
          address: string | null
          id: boolean
          signatory_name: string | null
          signatory_title: string | null
          slip_retention_years: number | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          id?: boolean
          signatory_name?: string | null
          signatory_title?: string | null
          slip_retention_years?: number | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          id?: boolean
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
      audit_log: {
        Row: {
          action: string
          actor: string | null
          after: Json | null
          at: string
          before: Json | null
          id: number
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
          kind: Database["public"]["Enums"]["txn_kind"]
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["txn_kind"]
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["txn_kind"]
          name?: string
          sort_order?: number
        }
        Relationships: []
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
      site_finance: {
        Row: {
          contract_amount: number
          created_at: string
          site_id: string
          updated_at: string
        }
        Insert: {
          contract_amount?: number
          created_at?: string
          site_id: string
          updated_at?: string
        }
        Update: {
          contract_amount?: number
          created_at?: string
          site_id?: string
          updated_at?: string
        }
        Relationships: [
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
          note: string | null
          pay_method: Database["public"]["Enums"]["pay_method"]
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
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
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
          note?: string | null
          pay_method?: Database["public"]["Enums"]["pay_method"]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_owner: { Args: never; Returns: boolean }
      site_overview: {
        Args: { p_on: string }
        Returns: {
          active_contract: number
          active_count: number
          due_soon_count: number
          overdue_count: number
          total_count: number
        }[]
      }
      supervises_site: {
        Args: { p_on?: string; p_site: string }
        Returns: boolean
      }
    }
    Enums: {
      income_kind: "deposit" | "installment" | "variation_order" | "other"
      pay_method: "cash" | "transfer"
      site_status: "planning" | "active" | "paused" | "done" | "cancelled"
      txn_kind: "income" | "expense"
      txn_status: "pending" | "approved" | "rejected"
      user_role: "owner" | "site_supervisor"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      income_kind: ["deposit", "installment", "variation_order", "other"],
      pay_method: ["cash", "transfer"],
      site_status: ["planning", "active", "paused", "done", "cancelled"],
      txn_kind: ["income", "expense"],
      txn_status: ["pending", "approved", "rejected"],
      user_role: ["owner", "site_supervisor"],
    },
  },
} as const
