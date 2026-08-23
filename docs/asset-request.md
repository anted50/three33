# Assets needed from the client

Send to: Three33 barbershop / Erdenebileg Damdinsuren

The site currently renders the wordmark as text in Cormorant Garamond. That is
a deliberate placeholder, not a design decision — everything below is blocked on
files only the client has.

## 1. Logos — blocking

**SVG strongly preferred** for all of these. SVG stays sharp at any size and on
any screen; a PNG that looks fine on a laptop is visibly soft on a phone. If
only raster exists, send PNG with transparency at 1000px+ on the long edge.

| What | Where it goes | Notes |
|---|---|---|
| Primary Three33 logo | Site header | Horizontal lockup works best in a 56px-tall bar |
| Light-on-dark version | Footer | The footer is black now — a dark logo disappears |
| Icon / monogram, square | Favicon, phone home screen | Must stay legible at 32×32 |
| Uppercut Deluxe retailer lockup | Homepage, footer | **Only if the distribution agreement permits displaying it** — please confirm |

Also useful if it exists: a brand guide, or just the exact brand colours as hex.
The site currently uses `#d81f26`, matched by eye from the Uppercut packaging.

## 2. Product photography — resolved, but please confirm licensing

All 22 products now have packshots. Thirteen were extracted from the Product
Bible PDF; the remaining nine were downloaded from Uppercut Deluxe's own
Shopify store (`scripts/fetch-brand-images.mjs`) and normalised to match.

They are **self-hosted**, not hot-linked — a `<img src>` pointing at the
brand's CDN would break whenever they re-upload a photo, 404 on any product
they discontinue, and spend their bandwidth without asking.

**Please confirm** the distribution agreement covers using the brand's product
photography on the store. This is normal practice for an authorised
distributor, and usually encouraged, but it is worth a line in writing.

Higher-resolution originals would still be welcome if the distributor has an
asset pack.

## 3. Prices — blocking launch

**Every price on the site is a placeholder I invented.** The packing list has no
pricing. Nothing should go live until the client confirms the retail price of
all 28 SKUs.

## 4. Copy and policy

- **Shipping fees**: currently 5,000₮ Ulaanbaatar, 15,000₮ countryside, free over
  50,000₮ in UB. Confirm or correct.
- **Return/refund policy** — decides whether admin needs refund tooling in v1
- **Contact details** for the footer: phone, opening hours, address as it should
  be displayed
- **Legal entity name** for receipts and terms

## 5. Domain and email — blocks passwordless login

- Which domain will the store live on?
- Confirm we can add DNS records (SPF, DKIM, DMARC) for it

Without those records, emailed login codes and order confirmations land in spam.
See `docs/email-otp.md`.

## 6. Already answered — no action needed

- **E-barimt**: QPay issues receipts for us via `POST /v2/ebarimt/create`. But it
  needs a **VAT-enabled invoice code**, and `THREE33_BARBER_INVOICE` is the plain
  one. If receipts are required, request that code from QPay.
- **QPay credentials**: working, verified against production. Worth rotating the
  password before launch — it has been forwarded through several inboxes.
