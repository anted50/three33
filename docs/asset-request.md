# Assets needed from the client

Send to: Three 33 barbershop / Erdenebileg Damdinsuren

The site currently renders the wordmark as text in Cormorant Garamond. That is
a deliberate placeholder, not a design decision — everything below is blocked on
files only the client has.

## 1. Logos — blocking

**SVG strongly preferred** for all of these. SVG stays sharp at any size and on
any screen; a PNG that looks fine on a laptop is visibly soft on a phone. If
only raster exists, send PNG with transparency at 1000px+ on the long edge.

| What | Where it goes | Notes |
|---|---|---|
| Primary Three 33 logo | Site header | Horizontal lockup works best in a 56px-tall bar |
| Light-on-dark version | Footer | The footer is black now — a dark logo disappears |
| Icon / monogram, square | Favicon, phone home screen | Must stay legible at 32×32 |
| Uppercut Deluxe retailer lockup | Homepage, footer | **Only if the distribution agreement permits displaying it** — please confirm |

Also useful if it exists: a brand guide, or just the exact brand colours as hex.
The site currently uses `#d81f26`, matched by eye from the Uppercut packaging.

## 2. Product photography — 9 products have none

Packshots for the rest were extracted from the Product Bible PDF. These nine
could not be recovered from it and currently show a text placeholder:

Clay · Clay Spray · Control Cream · Texture Cream · Salt Spray · Foam Tonic ·
Beard Oil · Beard Balm · Barber Cape

Any of these solves it:
- The original packshot files, if the distributor supplied them separately
- A newer Product Bible export
- Plain photos on a white background — a phone on a windowsill is genuinely fine

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
