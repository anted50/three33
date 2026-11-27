import { Fragment } from "react";
import type { ReactNode } from "react";
import { SearchBox } from "./search-box";

/**
 * Steps kept on a phone. The first two, home and the catalogue, are the ones
 * people go back to. Anything deeper (a product's category) folds into "…":
 * with this few categories, few shoppers navigate by them.
 */
const KEPT_ON_PHONE = 2;

/**
 * The trail above a page: earlier steps as links in the muted grey, then the
 * page itself in ink, not a link, marked aria-current. Chevrons sit between
 * the steps.
 *
 * `trail` holds the links, in order from the home page. `current` is the
 * page's own name.
 *
 * On a phone the catalogue search bar sits under the trail, and the trail
 * stays on one line: steps past KEPT_ON_PHONE fold into
 * "…" (as shadcn's collapsed breadcrumb does), and a long current name is
 * cut with an ellipsis. See .breadcrumb in app.css.
 */
export function Breadcrumbs({
  trail,
  current,
}: {
  trail: ReactNode[];
  current: ReactNode;
}) {
  const folds = trail.length > KEPT_ON_PHONE;

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol className="breadcrumb__list">
          {trail.map((step, index) => {
            const folded = index >= KEPT_ON_PHONE;
            return (
              <Fragment key={index}>
                <li className="breadcrumb__item" data-folded={folded}>
                  {step}
                </li>
                <li
                  className="breadcrumb__sep"
                  data-folded={folded}
                  aria-hidden="true"
                >
                  <Chevron />
                </li>
                {folds && index === KEPT_ON_PHONE - 1 && (
                  <>
                    <li className="breadcrumb__more" aria-hidden="true">
                      …
                    </li>
                    <li
                      className="breadcrumb__sep breadcrumb__more"
                      aria-hidden="true"
                    >
                      <Chevron />
                    </li>
                  </>
                )}
              </Fragment>
            );
          })}
          <li className="breadcrumb__item breadcrumb__item--current">
            <span className="breadcrumb__current" aria-current="page">
              {current}
            </span>
          </li>
        </ol>
      </nav>
      {/* Phones only (the header has the field from 900px): search lives
        under the trail, full width. See .page-search in app.css. */}
      <div className="page-search">
        <SearchBox />
      </div>
    </>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
