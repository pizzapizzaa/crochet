# ZippyZack Importer — Chrome extension

Two buttons, both of which save a lot of copying and pasting:

- **On a shop's product page** — reads the product and puts it in your catalogue
  as a draft, with the photographs copied into your own storage and the source
  link kept on the row.
- **On a Pinterest board** — collects every pin you have scrolled past and hands
  them to `/pos/makes/import`, ready to review.

It reads the page your browser has already rendered, which is the reason it
exists: the same URL fetched by a server gets the pre-JavaScript version of the
page, and on plenty of shops that has no price in it — or nothing at all,
because the shop refuses anything that is not a browser.

---

## Install it

1. Set `POS_IMPORT_TOKEN` in your shop's environment (Vercel → Settings →
   Environment Variables, and in `.env` for local work). Use a long random
   string — 32 characters or more:

   ```bash
   node -e "console.log(crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,''))"
   ```

   Redeploy so the running site picks it up.

2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load
   unpacked**, and pick this `extension/` folder.

3. Click the extension, then **Open settings**. Enter your shop address
   (`https://yourshop.com`, no `/pos`) and the same token. Press **Test the
   connection** — it should come back with how many categories it found.

Optionally set a default category, a markup and a stock level there too, so an
import is genuinely one click.

---

## Using it

**A product.** Open the product page, click the ZippyZack button. The panel
already has the name, price, photographs and SKU. Adjust the price if you want,
pick a category, press **Import to my shop**. It lands as a draft — open it in
the POS to rewrite the description before publishing.

A markup of, say, 60% means the shop's price is recorded as what the item costs
you and your price is set 60% above it. With no markup the price comes across
as-is and no cost is recorded. Both figures are in dollars: a foreign price is
converted first, and the markup is taken on the converted number.

**A board of pins.** Open the board, scroll until you can see everything you
want (Pinterest only loads a board as you scroll — the extension can only
collect what is actually on the page), then click the ZippyZack button and
**Send pins**. Your POS opens with the pins ready to review. Every make needs
its pin author credited before it can be saved, which is why they go to the
review screen rather than straight into the database.

---

## What it can and cannot do

- It cannot read `chrome://` pages, the Chrome Web Store, or PDFs. Chrome
  forbids it, for good reasons.
- A shop that renders nothing without an account will read as empty; sign in
  first and try again.
- Prices arrive in dollars. A page pricing in yuan, euros or anything else is
  converted before the panel shows it — `¥120.00 → $16.80`, with the rate used
  written under it and onto the product's cost note. The rates come from your
  shop (`FX_RATES` in its environment), so the extension and the site can never
  disagree about what a yuan is worth.
- A page that names no currency at all, in its markup or in front of its price,
  is flagged **currency not stated** and taken as dollars. So is one priced in
  a currency your shop holds no rate for — add it to `FX_RATES`. In both cases
  the panel says so rather than converting on a guess.
- It never publishes anything by itself unless you tick the box.

## What it sends, and where

Only what you are looking at, only to your own shop, only when you press the
button: the product fields read off the page, and your token. The token is your
shop's write access — treat it like a password, and if it leaks, change
`POS_IMPORT_TOKEN` and update it here.

## Permissions, and why each one

| Permission | Why |
|---|---|
| `activeTab` | Read the page you are on, only when you click the button. |
| `scripting` | Run the reader inside that page. |
| `storage` | Remember your shop address, token and defaults. |

No host permissions and no background script: it has no access to any tab until
you press the button, and nothing runs when the popup is closed.
