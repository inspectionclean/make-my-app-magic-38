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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      intake_submissions: {
        Row: {
          access_panels: boolean | null
          access_time: string | null
          business_name: string
          business_type: string | null
          city: string
          contact_name: string
          created_at: string
          duct_runs: number | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          equipment: string[] | null
          fans: number | null
          filters: Json | null
          fire_suppression: boolean | null
          frequency: string | null
          hoods: number | null
          hours: string | null
          id: string
          kitchen_type: string | null
          last_cleaning: string | null
          onsite_name: string | null
          onsite_phone: string | null
          other_equipment: string | null
          phone: string
          previous_company: string | null
          problem_areas: string | null
          roof_access: boolean | null
          service_address: string
          service_issues: string | null
          state: string
          text_phone: string | null
          title: string | null
          website: string | null
          zip: string
        }
        Insert: {
          access_panels?: boolean | null
          access_time?: string | null
          business_name: string
          business_type?: string | null
          city: string
          contact_name: string
          created_at?: string
          duct_runs?: number | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          equipment?: string[] | null
          fans?: number | null
          filters?: Json | null
          fire_suppression?: boolean | null
          frequency?: string | null
          hoods?: number | null
          hours?: string | null
          id?: string
          kitchen_type?: string | null
          last_cleaning?: string | null
          onsite_name?: string | null
          onsite_phone?: string | null
          other_equipment?: string | null
          phone: string
          previous_company?: string | null
          problem_areas?: string | null
          roof_access?: boolean | null
          service_address: string
          service_issues?: string | null
          state: string
          text_phone?: string | null
          title?: string | null
          website?: string | null
          zip: string
        }
        Update: {
          access_panels?: boolean | null
          access_time?: string | null
          business_name?: string
          business_type?: string | null
          city?: string
          contact_name?: string
          created_at?: string
          duct_runs?: number | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          equipment?: string[] | null
          fans?: number | null
          filters?: Json | null
          fire_suppression?: boolean | null
          frequency?: string | null
          hoods?: number | null
          hours?: string | null
          id?: string
          kitchen_type?: string | null
          last_cleaning?: string | null
          onsite_name?: string | null
          onsite_phone?: string | null
          other_equipment?: string | null
          phone?: string
          previous_company?: string | null
          problem_areas?: string | null
          roof_access?: boolean | null
          service_address?: string
          service_issues?: string | null
          state?: string
          text_phone?: string | null
          title?: string | null
          website?: string | null
          zip?: string
        }
        Relationships: []
      }
      job_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          job_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          job_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          id: string
          job_id: string
          storage_path: string
          taken_at: string
          type: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          job_id: string
          storage_path: string
          taken_at?: string
          type: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          job_id?: string
          storage_path?: string
          taken_at?: string
          type?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          address: string
          assigned_to: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          description: string | null
          google_event_id: string | null
          id: string
          lat: number | null
          lng: number | null
          mgmt_email: string | null
          report_sent_at: string | null
          scheduled_at: string
          service_type: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          address: string
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          description?: string | null
          google_event_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          mgmt_email?: string | null
          report_sent_at?: string | null
          scheduled_at: string
          service_type?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          address?: string
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          description?: string | null
          google_event_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          mgmt_email?: string | null
          report_sent_at?: string | null
          scheduled_at?: string
          service_type?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: []
      }
      performance_reports: {
        Row: {
          access_panel_condition: string | null
          access_panels: boolean | null
          address: string
          airflow_check: string | null
          areas_cleaned: string[] | null
          arrival_time: string | null
          business_name: string
          city: string
          completion_time: string | null
          condition_after: string | null
          condition_before: string | null
          contact_name: string
          created_at: string
          customer_rep: string | null
          customer_signature: string | null
          duct_runs: number | null
          email: string | null
          fan_check: string | null
          fans: number | null
          filter_condition: string | null
          findings: string | null
          fire_suppression: boolean | null
          grease_level: string | null
          hoods: number | null
          id: string
          other_cleaned: string | null
          phone: string
          photos: string[] | null
          previous_cleaning_date: string | null
          recommendation_items: string[] | null
          recommendations: string | null
          roof_access: boolean | null
          service_date: string
          service_type: string | null
          signature_date: string
          state: string
          submitted_by: string | null
          technician_name: string | null
          technician_signature: string | null
          technicians: string | null
          zip: string
        }
        Insert: {
          access_panel_condition?: string | null
          access_panels?: boolean | null
          address: string
          airflow_check?: string | null
          areas_cleaned?: string[] | null
          arrival_time?: string | null
          business_name: string
          city: string
          completion_time?: string | null
          condition_after?: string | null
          condition_before?: string | null
          contact_name: string
          created_at?: string
          customer_rep?: string | null
          customer_signature?: string | null
          duct_runs?: number | null
          email?: string | null
          fan_check?: string | null
          fans?: number | null
          filter_condition?: string | null
          findings?: string | null
          fire_suppression?: boolean | null
          grease_level?: string | null
          hoods?: number | null
          id?: string
          other_cleaned?: string | null
          phone: string
          photos?: string[] | null
          previous_cleaning_date?: string | null
          recommendation_items?: string[] | null
          recommendations?: string | null
          roof_access?: boolean | null
          service_date: string
          service_type?: string | null
          signature_date: string
          state: string
          submitted_by?: string | null
          technician_name?: string | null
          technician_signature?: string | null
          technicians?: string | null
          zip: string
        }
        Update: {
          access_panel_condition?: string | null
          access_panels?: boolean | null
          address?: string
          airflow_check?: string | null
          areas_cleaned?: string[] | null
          arrival_time?: string | null
          business_name?: string
          city?: string
          completion_time?: string | null
          condition_after?: string | null
          condition_before?: string | null
          contact_name?: string
          created_at?: string
          customer_rep?: string | null
          customer_signature?: string | null
          duct_runs?: number | null
          email?: string | null
          fan_check?: string | null
          fans?: number | null
          filter_condition?: string | null
          findings?: string | null
          fire_suppression?: boolean | null
          grease_level?: string | null
          hoods?: number | null
          id?: string
          other_cleaned?: string | null
          phone?: string
          photos?: string[] | null
          previous_cleaning_date?: string | null
          recommendation_items?: string[] | null
          recommendations?: string | null
          roof_access?: boolean | null
          service_date?: string
          service_type?: string | null
          signature_date?: string
          state?: string
          submitted_by?: string | null
          technician_name?: string | null
          technician_signature?: string | null
          technicians?: string | null
          zip?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          arrived_at: string
          created_at: string
          id: string
          job_id: string
          left_at: string | null
          source: string
          user_id: string
        }
        Insert: {
          arrived_at?: string
          created_at?: string
          id?: string
          job_id: string
          left_at?: string | null
          source?: string
          user_id: string
        }
        Update: {
          arrived_at?: string
          created_at?: string
          id?: string
          job_id?: string
          left_at?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "employee" | "office"
      job_status: "scheduled" | "in_progress" | "completed" | "cancelled"
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
      app_role: ["admin", "employee", "office"],
      job_status: ["scheduled", "in_progress", "completed", "cancelled"],
    },
  },
} as const
