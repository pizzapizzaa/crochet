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
| `/pos/makes/import` | Bulk Pinterest pin importer (back office) |
| `/pos/products/import` | Import a product from a shop link (back office) |

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

The back office needs three more:

```env
ADMIN_PASSWORD=whatever-you-sign-in-to-/pos-with
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
POS_IMPORT_TOKEN=a-long-random-string-at-least-16-characters
```

`SUPABASE_SERVICE_ROLE_KEY` is what lets `/pos` write; keep it server-side
only. `POS_IMPORT_TOKEN` is optional and only needed for the Chrome extension
— it is the secret that lets something which is *not* one of our own pages
write a product into the catalogue. Generate one with:

```bash
node -e "console.log(crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,''))"
```

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
| 6 | `import-schema.sql` | Indexes the bulk importers use to spot what is already imported |

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
   - `SUPABASE_SERVICE_ROLE_KEY` — the back office cannot write without it
   - `ADMIN_PASSWORD` — what you sign in to `/pos` with
   - `POS_IMPORT_TOKEN` — only if you use the Chrome extension
5. Deploy!

### Subsequent deploys

Every push to `main` triggers an automatic deployment.

---

## Bringing things in from elsewhere

Two importers, both under `/pos`, both built on the same idea: read what the
source page already publishes, show it for approval, and only then write.

### Pinterest pins, in bulk — `/pos/makes/import`

Paste as many pin links as you like — a tidy list, a board URL, or a lump of
text with links buried in it. Every pin is read (oEmbed first, Open Graph
second), shown as a row with its photograph, and saved as a **draft make** once
you approve it. Pins you have already imported come back marked and unticked,
so pasting the same board twice is harmless.

Two things it will not do, on purpose:

- **It will not save a make without a credited author.** `makes.author_name` is
  `NOT NULL` because a make is a pointer at somebody else's work. Where the
  scrape came back without a name, the row asks you to type one.
- **It will not build the bundle for you.** An imported make has no materials
  until you open it and pick the yarn and hooks, which is why imports land as
  drafts.

Boards fetched from the server give up their first screenful only — Pinterest
builds a board in the browser, so that is all the HTML contains. For a whole
board, use the extension below.

### A product from another shop's link — `/pos/products/import`

Paste one or more product URLs. Each page is read for JSON-LD, schema.org
microdata and Open Graph tags, plus the `.json` endpoint Shopify serves beside
every product, and comes back as a row with the name, price, photographs and
SKU filled in. Set a markup if you are reselling — the source price becomes the
cost and yours is set above it — pick a category, and import.

What lands in the catalogue:

- a **draft** product (nothing is published unless you tick the box)
- its photographs **copied into your own `product-images` bucket**, not
  hotlinked to the shop you found them on
- `supplier_url`, `supplier_name` and `supplier_sku` filled in, so where it came
  from survives on the row and shows up on `/pos/materials`
- a description lifted as a **starting point** — rewrite it before publishing

Shops that refuse anything but a browser (most large marketplaces) will come
back empty. That is what the extension is for.

#### Foreign prices

The catalogue is priced in USD and almost no supplier is — the yarn comes from
Chinese shops quoting CNY. A scraped price is converted before it is shown, and
the row says what it did: `¥120.00 → $16.80 at 0.14 CNY/USD`. The markup is
applied to the converted figure, and the rate is written onto the product's
cost note so a margin can still be explained months later.

Rates live in `src/lib/currency.ts` and are overridden with `FX_RATES` in the
environment:

```env
FX_RATES=CNY:0.1385,EUR:1.09
```

They are constants you set rather than a live feed, for the same reason
`VND_PER_USD` is — see the comment at the top of that file. VND is not listed
there because it is derived from `VND_PER_USD`, so the two cannot disagree.

A currency with no rate is never guessed at: the price comes through
unconverted and the row says so in as many words.

### The Chrome extension — `extension/`

A small MV3 extension that reads the page your browser has already rendered,
which is the half a server cannot do. On a product page it imports in one
click; on a Pinterest board it collects every pin you have scrolled past and
hands them to the bulk importer.

Set `POS_IMPORT_TOKEN`, load `extension/` unpacked at `chrome://extensions`,
and put the shop address and the same token into its settings. Full
instructions, including what it can and cannot read, are in
[`extension/README.md`](extension/README.md).

### The API underneath

| Route | What it does |
|---|---|
| `POST /api/pos/pinterest-bulk-lookup` | Reads up to 8 pins and flags ones already imported |
| `POST /api/pos/pinterest-board` | Best-effort list of pins on a board page |
| `POST /api/pos/pinterest-bulk-import` | Writes reviewed pins as draft makes |
| `POST /api/pos/product-scrape` | Reads one shop page, writes nothing |
| `POST /api/pos/product-import` | Creates a product from a scrape or from the extension |
| `GET`/`POST` `/api/pos/categories-list` | Categories, for the extension's filing dropdown |
| `GET`/`POST` `/api/pos/fx` | Exchange rates, so the extension converts at the same rate the shop does |

The first three take the `admin_auth` session cookie. The last three take
either that cookie **or** the import token — but the cookie is only accepted
from our own pages: a cross-origin request must carry the token, so no site you
happen to be signed in on can post products into your shop behind your back.

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
│   ├── mockData.ts            ← Dev data (replace with Supabase)
│   ├── pinterest.ts           ← Reading a pin, and a paste full of them
│   ├── mirror.ts              ← Copying a remote image into our bucket
│   ├── apiAuth.ts             ← Cookie-or-token auth for the import endpoints
│   └── scrape/                ← Reading a product off a shop page
├── pages/
│   ├── index.astro            ← Homepage
│   ├── store.astro            ← Shop front
│   ├── store/[slug].astro     ← Individual item
│   ├── gallery.astro          ← Gallery
│   ├── pattern-generator.astro
│   └── pos/                   ← Back office, including both import screens
extension/                     ← Chrome extension (one-click importing)
supabase/
└── schema.sql                 ← Run in Supabase SQL Editor
```
