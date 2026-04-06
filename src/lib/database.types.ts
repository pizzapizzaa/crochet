export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      products: {
        Row: {
          id: string;
          created_at: string;
          name: string;
          slug: string;
          description: string;
          price: number;
          compare_at_price: number | null;
          category: string;
          tags: string[];
          images: string[];
          stock: number;
          is_active: boolean;
          is_featured: boolean;
          yarn_weight: string | null;
          hook_size: string | null;
          dimensions: string | null;
          care_instructions: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          name: string;
          slug: string;
          description: string;
          price: number;
          compare_at_price?: number | null;
          category: string;
          tags?: string[];
          images?: string[];
          stock?: number;
          is_active?: boolean;
          is_featured?: boolean;
          yarn_weight?: string | null;
          hook_size?: string | null;
          dimensions?: string | null;
          care_instructions?: string | null;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
      };
      gallery_items: {
        Row: {
          id: string;
          created_at: string;
          title: string;
          description: string | null;
          image_url: string;
          alt_text: string;
          product_id: string | null;
          is_featured: boolean;
          display_order: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          title: string;
          description?: string | null;
          image_url: string;
          alt_text: string;
          product_id?: string | null;
          is_featured?: boolean;
          display_order?: number;
        };
        Update: Partial<Database['public']['Tables']['gallery_items']['Insert']>;
      };
      orders: {
        Row: {
          id: string;
          created_at: string;
          customer_email: string;
          customer_name: string;
          items: Json;
          total: number;
          status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
          shipping_address: Json;
          stripe_session_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          customer_email: string;
          customer_name: string;
          items: Json;
          total: number;
          status?: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
          shipping_address: Json;
          stripe_session_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// Convenience types
export type Product = Database['public']['Tables']['products']['Row'];
export type GalleryItem = Database['public']['Tables']['gallery_items']['Row'];
export type Order = Database['public']['Tables']['orders']['Row'];
