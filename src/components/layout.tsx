import { useEffect, useState } from "react";
import { Link, useLoaderData } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { SearchBox } from "./search-box";
import { useCartDrawer } from "./cart-drawer";
import { PhoneCopy } from "./phone-copy";
import { SHOP } from "~/lib/booking/shop";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_LOGOS,
} from "~/lib/payment-methods";

/** The providers the checkout takes, in the order its form lists them. */
const ACCEPTED_PROVIDERS = ["qpay", "storepay"] as const;

interface RootData {
  cartCount: number;
}

export function Header() {
  const data = useLoaderData({ from: "__root__" }) as RootData;
  const { open: cartOpen, openCart } = useCartDrawer();

  return (
    <header className="header">
      <div className="wrap header__bar">
        {/*
          The mark carries no wordmark, so the shop's name has to come from the
          accessible name instead — without it the only link to the homepage
          announces as "link" and the site loses its name in the a11y tree, in
          search results' link context, and to anyone with images off.
        */}
        <Link to="/" className="logo" aria-label="Three33 Barber — нүүр">
          <Logo className="logo__mark" />
        </Link>

        {/* Inline field, desktop only. Phones search from the products page. */}
        <div className="header__search">
          <SearchBox />
        </div>

        {/*
          Left to right: booking, the catalogue, the cart. Booking is the one
          red control (a dashed red outline), so it leads and the two plain
          icons sit together after it. On a phone it is a square with
          scissors; from 900px it spells out "Цаг захиалах" instead.
        */}
        <div className="header__actions">
          <Link to="/booking" className="header__book" aria-label="Цаг захиалах">
            <ScissorsIcon />
            <span className="header__booklabel">Цаг захиалах</span>
          </Link>
          {/*
            The shop's two controls, framed together in the dashed line the
            product cards use. Whichever is in use is filled: products on any
            /products page (TanStack marks the link data-status="active"), the
            cart while its drawer is open.
          */}
          <div className="header__shop">
            <Link to="/products" className="icon-btn" aria-label="Бүтээгдэхүүн">
              <ProductsIcon className="header__productsicon" />
            </Link>
            <button
              type="button"
              className="icon-btn"
              aria-label="Сагс"
              aria-expanded={cartOpen}
              onClick={openCart}
            >
              <CartIcon />
              {data.cartCount > 0 && (
                <span key={data.cartCount} className="badge">
                  {data.cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer__cols">
          <section className="footer__col">
            <h2 className="footer__head">Хаяг</h2>
            <p className="footer__body">
              Сүхбаатар дүүрэг, 3-р хороо
              <br />
              UB Central Residence, 1 давхар
              <br />
              Three33 Barber
            </p>
          </section>

          <section className="footer__col">
            <h2 className="footer__head">Холбоо барих</h2>
            <p className="footer__body">
              <PhoneCopy display={SHOP.phoneIntl} className="phone-copy footer__copy" />
              <br />
              {/* <a href="mailto:three33barber@three33barber.com">
                                three33barber@three33barber.com
                            </a> */}
            </p>
          </section>

          {/*
            The providers' marks and names as checkout itself shows them
            (lib/payment-methods), turned white for the black footer by a CSS
            filter, then bank transfer, which the shop takes outside checkout
            and so has no provider entry. A phone shows the marks only; the
            names stay for screen readers.
          */}
          <section className="footer__col">
            <h2 className="footer__head">Payment accepted</h2>
            <ul className="footer__pay">
              {ACCEPTED_PROVIDERS.map((method) => (
                <li key={method} className="footer__payitem">
                  <img
                    src={PAYMENT_METHOD_LOGOS[method]}
                    alt=""
                    width={20}
                    height={20}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="footer__payname">
                    {PAYMENT_METHOD_LABELS[method]}
                  </span>
                </li>
              ))}
              <li className="footer__payitem">
                <BankIcon />
                <span className="footer__payname">Bank</span>
              </li>
            </ul>
          </section>

          <section className="footer__col">
            <h2 className="footer__head">Сошиал</h2>
            <p className="footer__body">
              {/*
                              rel="noreferrer" and not just noopener: these leave the
                              site for a social network, and there is no reason to
                              hand it the page the customer came from.
                            */}
              {/* <a
                                href="https://www.facebook.com/Three33barber"
                                target="_blank"
                                rel="noreferrer"
                            >
                                Facebook — Three33barber
                            </a> */}
              {/* <br /> */}
              <a
                href="https://www.instagram.com/uppercutdeluxe_mongolia"
                target="_blank"
                rel="noreferrer"
              >
                @uppercutdeluxe_mongolia
              </a>
            </p>
          </section>
        </div>

        <div className="footer__bottom">
          <p className="footer__note">
            Authentic products. Modern grooming.
            <br />
            Timeless barber culture.
          </p>
          <a
            className="footer__credit"
            href="https://atelier.mn"
            target="_blank"
            rel="noreferrer"
          >
            by__atelier.mn
          </a>
        </div>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
      <BackToTop />
    </>
  );
}

/**
 * Shown once the visitor is this far down, in screen heights. Under one
 * screen on purpose: the home page only scrolls about one screen in all, and
 * the button should still turn up at its bottom.
 */
const BACK_TO_TOP_AFTER_SCREENS = 0.6;

/**
 * Square button, bottom right, that rises into view once the page has been
 * scrolled some way down, and scrolls back up when tapped.
 * Smooth unless the visitor asked for reduced motion.
 *
 * Always rendered and hidden with visibility, not unmounted, so it can
 * animate out as well as in; visibility also takes it out of the tab order
 * and the accessibility tree while hidden.
 */
export function BackToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setShown(
        window.scrollY > window.innerHeight * BACK_TO_TOP_AFTER_SCREENS,
      );
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  const toTop = () => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      className="totop"
      data-shown={shown}
      aria-label="Дээш буцах"
      onClick={toTop}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 19V5M5 12l7-7 7 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
        />
      </svg>
    </button>
  );
}

/**
 * Inline SVGs — no external icon font, so nothing to block under a strict CSP.
 *
 * The header icons' viewBoxes end at x=21, where the right-most stroke ends,
 * instead of the usual 24, so the glyph box is the drawn glyph and centres
 * truly inside its button (.header__shop in app.css). Width shrinks in proportion (17.5 = 20 × 21/24), so the glyphs render at
 * exactly the same size.
 */
/**
 * Four tiles: the catalogue. Centred on its viewBox, so the CSS turn into a
 * diamond (.header__productsicon) pivots on the middle of the glyph.
 *
 * Exported for the home page's "Бүтээгдэхүүн үзэх" button, which shows it
 * in front of the words so the header's unlabelled icon gets its meaning.
 */
export function ProductsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="17.5"
      height="20"
      viewBox="0 0 21 24"
      fill="none"
      aria-hidden
    >
      <rect x="3" y="4.5" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="12" y="4.5" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="13.5" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="12" y="13.5" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * Booking's glyph: the scissors from the booking pages, in red inside the
 * dashed red square. Hidden once the label shows.
 */
function ScissorsIcon() {
  return (
    <svg
      className="header__bookicon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1L20 20M8.1 15.9L20 4" />
    </svg>
  );
}

/**
 * Bank transfer's mark: a columned bank, drawn in the footer's white. Heavy
 * strokes and three columns, so it weighs the same as the solid QPay and
 * StorePay marks beside it rather than reading as a thin line icon.
 */
function BankIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 9 12 3.5 21 9Z" />
      <path d="M6 12.5v5M12 12.5v5M18 12.5v5" />
      <path d="M3 21h18" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="17.5" height="20" viewBox="0 0 21 24" fill="none" aria-hidden>
      <path
        d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.5a1 1 0 0 0 1-.78L20 8H6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}
