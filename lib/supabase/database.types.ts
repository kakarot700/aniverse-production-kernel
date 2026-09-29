export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string | null; avatar_url: string | null; created_at: string; updated_at: string };
        Insert: { id: string; display_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string };
        Update: { display_name?: string | null; avatar_url?: string | null; updated_at?: string };
        Relationships: [];
      };
      watchlists: {
        Row: { id: string; user_id: string; media_id: string; created_at: string };
        Insert: { id?: string; user_id: string; media_id: string; created_at?: string };
        Update: { media_id?: string; created_at?: string };
        Relationships: [];
      };
      playback_history: {
        Row: { id: string; user_id: string; media_id: string; episode_number: number; position_ms: number; updated_at: string };
        Insert: { id?: string; user_id: string; media_id: string; episode_number: number; position_ms: number; updated_at?: string };
        Update: { position_ms?: number; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
