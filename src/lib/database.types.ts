export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Kept in step with the CHECK constraint on makes.difficulty. */
export type Difficulty = 'Beginner' | 'Easy' | 'Intermediate' | 'Advanced';
export const DIFFICULTIES: Difficulty[] = ['Beginner', 'Easy', 'Intermediate', 'Advanced'];

/** Kept in step with the CHECK constraint on orders.status. */
export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

/**
 * Whether the money arrived, which is a separate question from how far along
 * the parcel is: an order can be paid and still pending, or shipped and
 * refunded.
 */
export type PaymentStatus = 'unpaid' | 'paid' | 'failed' | 'refunded';

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          slug: string;
          description: string | null;
          image_url: string | null;
          display_order: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name: string;
          slug: string;
          description?: string | null;
          image_url?: string | null;
          display_order?: number;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['categories']['Insert']>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          slug: string;
          description: string;
          price: number;
          compare_at_price: number | null;
          category: string;
          category_id: string | null;
          tags: string[];
          images: string[];
          stock: number;
          is_active: boolean;
          is_featured: boolean;
          yarn_weight: string | null;
          hook_size: string | null;
          dimensions: string | null;
          care_instructions: string | null;
          cost_price: number | null;
          supplier_name: string | null;
          supplier_url: string | null;
          supplier_sku: string | null;
          cost_note: string | null;
          units_sold: number;
          cost_updated_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name: string;
          slug: string;
          description: string;
          price: number;
          compare_at_price?: number | null;
          category: string;
          category_id?: string | null;
          tags?: string[];
          images?: string[];
          stock?: number;
          is_active?: boolean;
          is_featured?: boolean;
          yarn_weight?: string | null;
          hook_size?: string | null;
          dimensions?: string | null;
          care_instructions?: string | null;
          cost_price?: number | null;
          supplier_name?: string | null;
          supplier_url?: string | null;
          supplier_sku?: string | null;
          cost_note?: string | null;
          units_sold?: number;
          cost_updated_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'products_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      makes: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          title: string;
          slug: string;
          summary: string | null;
          pinterest_url: string;
          pinterest_pin_id: string | null;
          author_name: string;
          author_url: string | null;
          attribution_note: string | null;
          image_url: string | null;
          source_image_url: string | null;
          difficulty: Difficulty | null;
          estimated_time: string | null;
          bundle_price: number | null;
          bundle_discount_pct: number;
          tags: string[];
          display_order: number;
          is_active: boolean;
          is_featured: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          title: string;
          slug: string;
          summary?: string | null;
          pinterest_url: string;
          pinterest_pin_id?: string | null;
          author_name: string;
          author_url?: string | null;
          attribution_note?: string | null;
          image_url?: string | null;
          source_image_url?: string | null;
          difficulty?: Difficulty | null;
          estimated_time?: string | null;
          bundle_price?: number | null;
          bundle_discount_pct?: number;
          tags?: string[];
          display_order?: number;
          is_active?: boolean;
          is_featured?: boolean;
        };
        Update: Partial<Database['public']['Tables']['makes']['Insert']>;
        Relationships: [];
      };
      make_items: {
        Row: {
          id: string;
          created_at: string;
          make_id: string;
          product_id: string;
          quantity: number;
          note: string | null;
          is_optional: boolean;
          display_order: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          make_id: string;
          product_id: string;
          quantity?: number;
          note?: string | null;
          is_optional?: boolean;
          display_order?: number;
        };
        Update: Partial<Database['public']['Tables']['make_items']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'make_items_make_id_fkey';
            columns: ['make_id'];
            isOneToOne: false;
            referencedRelation: 'makes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'make_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: 'gallery_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          order_number: string;
          customer_email: string;
          customer_name: string;
          customer_note: string | null;
          items: Json;
          subtotal: number;
          shipping_total: number;
          total: number;
          status: OrderStatus;
          payment_status: PaymentStatus;
          shipping_address: Json;
          paid_at: string | null;
          payment_provider: string;
          provider_order_code: number | null;
          provider_payment_id: string | null;
          payment_reference: string | null;
          amount_charged: number | null;
          charged_currency: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          order_number: string;
          customer_email: string;
          customer_name: string;
          customer_note?: string | null;
          items: Json;
          subtotal?: number;
          shipping_total?: number;
          total: number;
          status?: OrderStatus;
          payment_status?: PaymentStatus;
          shipping_address: Json;
          paid_at?: string | null;
          payment_provider?: string;
          provider_order_code?: number | null;
          provider_payment_id?: string | null;
          payment_reference?: string | null;
          amount_charged?: number | null;
          charged_currency?: string | null;
        };
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
        Relationships: [];
      };
    };
    Views: {
      make_bundle_totals: {
        Row: {
          make_id: string;
          items_subtotal: number;
          optional_subtotal: number;
          items_cost: number;
          required_count: number;
          optional_count: number;
        };
        Relationships: [
          {
            foreignKeyName: 'make_bundle_totals_make_id_fkey';
            columns: ['make_id'];
            isOneToOne: true;
            referencedRelation: 'makes';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      /** Takes payment and stock together — see supabase/shop-schema.sql. */
      commit_order: {
        Args: { p_order_id: string; p_payment_ref: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
  };
}

// Convenience types
export type Category = Database['public']['Tables']['categories']['Row'];
export type Product = Database['public']['Tables']['products']['Row'];
export type GalleryItem = Database['public']['Tables']['gallery_items']['Row'];
export type Order = Database['public']['Tables']['orders']['Row'];

export type Make = Database['public']['Tables']['makes']['Row'];
export type MakeItem = Database['public']['Tables']['make_items']['Row'];
export type BundleTotals = Database['public']['Views']['make_bundle_totals']['Row'];

/** A bundle line joined to the product it points at. */
export interface MakeItemWithProduct extends MakeItem {
  product: Product;
}

/** A make with its bundle resolved — what both the POS and the shop render. */
export interface MakeWithBundle extends Make {
  items: MakeItemWithProduct[];
}

export type OrderInsert = Database['public']['Tables']['orders']['Insert'];
export type ProductInsert = Database['public']['Tables']['products']['Insert'];
export type MakeInsert = Database['public']['Tables']['makes']['Insert'];
export type MakeItemInsert = Database['public']['Tables']['make_items']['Insert'];
export type CategoryInsert = Database['public']['Tables']['categories']['Insert'];
