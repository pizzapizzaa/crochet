# Loopy & Co. — Crochet Shop

A handcrafted crochet storefront built with **Astro**, **Tailwind CSS**, **Supabase**, and deployed on **Vercel**.

---

## Pages

| Route | Description |
|---|---|
| `/` | Homepage — hero, featured products, about, newsletter |
| `/store` | Shop front — filterable by category & sort, with search |
| `/store/[slug]` | Individual product page with images, details, related items |
| `/gallery` | Masonry photo gallery linking to store items |
| `/pattern-generator` | Interactive crochet pattern calculator (React island) |

---

## Tech Stack

- **Framework**: [Astro 4](https://astro.build) (hybrid SSR)  
- **Styling**: [Tailwind CSS 3](https://tailwindcss.com)  
- **Interactive components**: React 18 (Astro Islands)  
- **Database & Auth**: [Supabase](https://supabase.com)  
- **Hosting**: [Vercel](https://vercel.com)

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

```env
PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

You can find these in your [Supabase project settings → API](https://supabase.com/dashboard/project/_/settings/api).

### 3. Set up the database

In your Supabase dashboard, open the **SQL Editor** and run each file in
`supabase/` **in this order**. They are idempotent, so re-running one is safe.

| # | File | What it adds |
|---|------|--------------|
| 1 | `schema.sql` | `products`, `gallery_items`, `orders`, RLS policies |
| 2 | `pos-schema.sql` | `categories` and the columns the back office edits |
| 3 | `makes-schema.sql` | `makes` and `make_items` — the bundles |
| 4 | `shop-schema.sql` | Checkout columns and `commit_order()` |
| 5 | `fulfilment-schema.sql` | Delivery tracking, `order_events`, refunds, `restock_order()` |

Step 5 is required for the orders screens to work — without it the POS cannot
read `needs_attention`, `tracking_number` or the order history.

If your database predates the payOS switch it may still carry `paypal_order_id`,
`paypal_capture_id` and `stripe_session_id`, and be missing the columns checkout
writes. Step 5 detects that and adds them, so running it is enough either way.

### 4. Create a Storage bucket

In Supabase Dashboard → **Storage** → New Bucket → name it `product-images` → set to **Public**.

Upload your product photos and use the public URLs in the `images` column of the `products` table.

### 5. Run locally

```bash
npm run dev
```

Visit `http://localhost:4321`

---

## Deploying to Vercel

### First-time setup

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com/new), import the GitHub repo.
3. Vercel will auto-detect Astro.
4. Add environment variables in Vercel project settings:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
5. Deploy!

### Subsequent deploys

Every push to `main` triggers an automatic deployment.

---

## Switching from Mock Data to Supabase

All pages currently use `mockData.ts` for development. Once your Supabase credentials are ready, replace the mock queries:

**Example in `src/pages/store.astro`:**

```diff
- import { mockProducts } from '../lib/mockData';
- let products = [...mockProducts];
+ import { supabase } from '../lib/supabase';
+ const { data: products } = await supabase.from('products').select().eq('is_active', true);
```

Do the same for `index.astro`, `gallery.astro`, and `store/[slug].astro`.

---

## Project Structure

```
src/
├── components/
│   ├── Header.astro
│   ├── Footer.astro
│   ├── ProductCard.astro
│   └── PatternGenerator.tsx   ← React island
├── layouts/
│   └── Layout.astro
├── lib/
│   ├── supabase.ts            ← Supabase client
│   ├── database.types.ts      ← TypeScript types
│   └── mockData.ts            ← Dev data (replace with Supabase)
├── pages/
│   ├── index.astro            ← Homepage
│   ├── store.astro            ← Shop front
│   ├── store/[slug].astro     ← Individual item
│   ├── gallery.astro          ← Gallery
│   └── pattern-generator.astro
supabase/
└── schema.sql                 ← Run in Supabase SQL Editor
```
