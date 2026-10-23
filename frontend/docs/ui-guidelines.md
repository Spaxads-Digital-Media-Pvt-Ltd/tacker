# Tracker UI guidelines

How the frontend looks and behaves, and which shared pieces to reuse. This describes the code as it
is; when the code changes, update this file. Paths are relative to this file.

## 1. Tokens

All colour, type, radius, shadow and motion values are CSS variables in
[`src/index.css`](../src/index.css), exposed to Tailwind in [`tailwind.config.js`](../tailwind.config.js)
as `rgb(var(--token) / <alpha-value>)`. Colour tokens are `R G B` triplets, so a translucent variant is
an opacity modifier (`bg-metric-revenue/10`), never a new variable. **Never hard-code a hex, `rgb()`
or `white` / `black` in a component.**

### Colour

| Group | Tailwind | Use |
|---|---|---|
| Neutrals | `bg-page`, `bg-surface`, `bg-elevated`, `bg-subtle`, `border-border`, `border-border-strong` | Page canvas, cards, raised chips, recessed wells, hairlines, control outlines |
| Text | `text-fg`, `text-fg-secondary`, `text-fg-muted` | Primary, secondary, muted (muted still passes 4.5:1 on page and surface) |
| Accent | `bg-accent`, `bg-accent-hover`, `bg-accent-subtle`, `text-accent-text` | Fills, hover fills, tints/selected tabs, links |
| Brand | `brand`, `chart` (and `--focus-ring` for the global `:focus-visible` outline) | Indicators, icons, charts, the focus outline — **not text in Light** |
| Status | `success`, `danger`, `warning`, `info` (each with `-bg` and `-text`) | Same meaning in every theme: green +, red −, amber pending, blue info |
| Metrics | `metric-revenue`, `-payout`, `-margin`, `-clicks`, `-conversions` | Chart series, sparklines, icon chips — not text in Light |
| Shell | `header-*`, `table-*`, `sidebar-*` | App shell, table heads, sidebar rows |

### Token-by-background rule

The text/icon token is chosen by the fill it sits on:

| Background | Foreground |
|---|---|
| `bg-accent` (hero, chips, step marker) | `text-on-accent` (`--text-on-accent`) |
| `.btn-primary` | `--btn-primary-fg` (white in Light, dark ink in Dark — handled by the class) |
| Destructive fill | `--danger-fill` + `--btn-danger-fg` (use `.btn-danger`; plain `--danger` is too light behind text in Dark) |
| Success state / selected status | `bg-success-bg text-success-text`, plus `ring-1 ring-inset ring-success` when selected |
| Former `bg-white` | `bg-surface` |
| Toggle knob | Off: `bg-on-accent` on a `bg-border-strong` track. On: `bg-surface` on a `bg-success` track ([`ToggleRow`](../src/shared-components/primitives/ToggleRow.tsx)) |
| Status dot for "warning" | `bg-warning-text` (plain `--warning` is 2.15:1 on white) |

Content canvases and data colours (chart series, uploaded images) stay as they are, with a comment.

### Layers, radius, spacing, type

- **z-index:** shell layers stay below 100 (header 40, drawer/flyout 50, rail tooltip 60). `z-overlay`
  (100) is every dimmed Modal / ConfirmDialog; `z-popover` (110) is any menu or picker that can open
  inside one. Don't invent other values for portaled layers.
- **Radius:** `rounded` = `--radius` 8px (controls), `rounded-card` 12px, `rounded-nav` 10px (sidebar
  rows), `rounded-shell` 22px (inset main panel).
- **Spacing:** Tailwind's default 4px scale; no custom spacing tokens. Mobile side gutter is 16px
  (`px-4`).
- **Type:** `text-h1` 28 · `text-h2` 22 · `text-h3` 18 · `text-body` 14 · `text-small` 13 ·
  `text-tiny` 12. Inter for UI, Space Mono (`font-mono`) for IDs, tokens and codes.
- **Shadows:** `shadow-card`, `shadow-card-hover`, `shadow-elevated` — neutral only (slate in Light,
  black in Dark).

### Light / Dark

[`ThemeContext`](../src/theme/ThemeContext.tsx) toggles a `dark` class on `<html>` (Tailwind
`darkMode: 'class'`), following the OS until the user picks. `.dark` redefines the **same** token
names, so a component written with tokens works in both themes without `dark:` variants. Light is
slate + teal (`--accent` #007F62); Dark is warm near-black + mauve/plum (`--accent` #7E4E73).
The Figma variable collection "Tracker Tokens" (file `T9GskIZx8IyRtXE8VoDBYm`, Light/Dark modes)
mirrors these values.

### Hard rules

- **No gradients, glows, blur (`blur-*`, `backdrop-blur-*`) or coloured shadows.** Surfaces are flat
  token fills. The built CSS contains 0 `gradient` and 0 `blur(`. A scroll affordance is a flat 2px
  `bg-border-strong` bar (see `TableScroll`), not a fade.
- **WCAG AA in both themes:** text ≥ 4.5:1, UI parts (control outlines, focus ring, status dots) ≥ 3:1.
  The comments beside each token in `index.css` record its measured ratios — keep them current when a
  value changes.

## 2. Shared components

| Component | File | Use it when |
|---|---|---|
| `StateBlock` | [`primitives/ui.tsx`](../src/shared-components/primitives/ui.tsx) | Any loading / empty / error state of a panel or table. `variant="loading"` (skeleton, `rows`), `"empty"` (icon + `title` + `hint` + optional `action`), `"error"` (alert + Retry when `onRetry` is given). No variant = the legacy dashed box. |
| `HistoryModal` / `HistoryList` | [`panels/HistoryModal.tsx`](../src/shared-components/panels/HistoryModal.tsx) | A record's `GET …/:id/history`. Modal from a row menu; `HistoryList` inline in a History tab (`zoneNote` shows the zone). Default six columns, replaceable via `columns`. Times in the browser zone unless `timeZone` is passed. |
| `TimeSeriesChart` + `chartMath` | [`charts/TimeSeriesChart.tsx`](../src/shared-components/charts/TimeSeriesChart.tsx), [`charts/chartMath.ts`](../src/shared-components/charts/chartMath.ts) | Every line / area / bar chart. Token tones only; one unit (one currency) per chart; `null` = gap; keyboard + screen-reader table built in. Geometry (nice ticks, clamped curves, gap runs) lives in `chartMath` so it can be unit-tested. |
| `pickXLabels` + `useElementWidth` | [`charts/chartMath.ts`](../src/shared-components/charts/chartMath.ts), [`charts/useElementWidth.ts`](../src/shared-components/charts/useElementWidth.ts) | Any chart that draws its own x-axis labels (TimeSeriesChart, the report `MiniChart`, the analytics `LabeledChart`, the super-admin `TrendChart`). Pass label centres, widths (`estimateLabelWidth`) and the plot bounds: first and last label always kept, the rest spaced ≥ 8 px by real width, every label inside the plot. Draw SVG charts at the measured pixel width (`useElementWidth`), never a stretched `viewBox`. |
| `MenuSelect` | [`primitives/ui.tsx`](../src/shared-components/primitives/ui.tsx) | Every toolbar select (search field, status, type, sort). `.btn-toolbar` trigger named "<label>: <value>" (`prefix` for a visible lead-in like "Sort:"), radio items with a check, `active` for the filtered state, `display` for a summary such as "3 statuses". Values pass through untouched. Native `<select>` stays native. |
| `MenuPopover` / `MenuItem` / `TableRowMenu` | [`primitives/ui.tsx`](../src/shared-components/primitives/ui.tsx), [`primitives/TableActionsKit.tsx`](../src/shared-components/primitives/TableActionsKit.tsx) | Any dropdown menu — row ⋮ (`TableRowMenu`), Table Actions, toolbar menus. Portaled to `<body>` (an `overflow` or `transform` parent can't clip it), flips above, stays 8 px inside the viewport, follows scroll / resize, Escape and a chosen item return focus to the trigger, ↑ / ↓ / Home / End move between items. Never hand-roll an `absolute top-full` menu inside a table cell, drawer or modal body. Pickers inside a focus-trapped `Modal` (e.g. `EntitySearchSelect`) stay in the dialog and scroll into view instead. |
| `FilterToolbar` + `ActiveFilterChips` | [`pages/admin/PagedListControls.tsx`](../src/pages/admin/PagedListControls.tsx), [`primitives/ActiveFilterChips.tsx`](../src/shared-components/primitives/ActiveFilterChips.tsx) | A list page's toolbar: `lead` (the search), `children` (selects, then the Filters button), `chips` / `onRemoveChip` / `onClearAll`, `actions` (primary action + ⋮). Chips render inline right after Filters and wrap from the toolbar's left edge; the actions stay pinned to row 1 on the right; no filters → no extra row. On a phone row 1 is search + actions. Use `ActiveFilterChips inline` only inside a wrapping flex row; never as a separate row under a toolbar. |
| `ResultsBar` (report chips) | [`primitives/ReportLayout.tsx`](../src/shared-components/primitives/ReportLayout.tsx) | Report / analytics pages: pass `<ActiveFilterChips>` as a child — the bar puts the chips inline after the title (sm+) or in a row after its actions (phone), keeps the actions pinned top-right, and renders nothing extra without filters. |
| `moneyIn` | [`lib/moneyFormat.ts`](../src/lib/moneyFormat.ts) | One amount in one known currency (payout, invoice total). `{ decimals: 3 }` for rates finer than cents (e.g. RPM) — display only. Missing → muted "—", bad text → "Invalid amount". Use `moneyDisplay` for report rows, `moneyAxisTick` for chart axes. |
| `reportCurrency` | [`lib/reportCurrency.ts`](../src/lib/reportCurrency.ts) | Report rows: `resolveCurrency` gives single / mixed / none. Mixed currencies show "Mixed", never a summed number; sorting is within each currency. |
| `useReportZone` | [`lib/useReportZone.ts`](../src/lib/useReportZone.ts) (helpers in [`lib/reportZone.ts`](../src/lib/reportZone.ts)) | Any report page: one zone for the date range, buckets and timestamps (network zone by default, user override remembered). |
| `Badge` + `lib/offerStatus` | [`primitives/ui.tsx`](../src/shared-components/primitives/ui.tsx), [`lib/offerStatus.ts`](../src/lib/offerStatus.ts) | Status chips. Tone comes from the value (success / warning / danger / neutral) or an explicit `tone`. Offer statuses use `OFFER_STATUS_LABEL` / `OFFER_STATUS_TONE` / `OFFER_TONE_DOT` — display only; filters and requests keep raw values. |
| `Tabs` | [`primitives/ui.tsx`](../src/shared-components/primitives/ui.tsx) | Multi-section entity screens. WAI-ARIA tabs (arrow keys, Home/End), optional `counts`. Below `sm` the strip scrolls sideways and keeps the active tab in view — never wraps the page wider. |
| `TableScroll` / `Table` | [`primitives/ui.tsx`](../src/shared-components/primitives/ui.tsx) | Wide tables scroll horizontally (never reflow to cards) with a sticky header / first column and the flat edge bar. |
| `EmptyShellTable` | [`primitives/EmptyShellTable.tsx`](../src/shared-components/primitives/EmptyShellTable.tsx) | Detail sub-tabs with no backend yet: without `rows` it shows only an honest "Not available yet" state. |
| `Accordion` | [`panels/Accordion.tsx`](../src/shared-components/panels/Accordion.tsx) | A titled collapsible card outside forms. Built on `FormSection` with `lazyMount`: content mounts on first open (so tabs that fetch on mount send nothing until opened), then stays mounted. |

## 3. Forms

Shared pieces live in [`src/shared-components/forms/`](../src/shared-components/forms/). They are
presentational: the page keeps its own `<form>`, state, validation, requests and submit.

- **`FormLayout`** — form card with caption, title and required note.
  - **Aside rule:** use `layout="aside"` (336px column with Field help + Up next at ≥ lg) only when the
    page or wizard has **3 or more fields with hints** (today: OfferCreate, OfferEdit, SmartLinkForm).
    Otherwise `layout="centered"`: card centred at 960px, hints as (?) tooltips, Up next below the
    card.
  - **One container:** the page actions row, the `Stepper` card, the form card and the `FormFooter`
    content all use `.form-width` (index.css). A centred form sets `--form-max-w: 960px` — the content
    width at 1280px with the sidebar expanded — so margins are equal at every desktop width, sidebar
    expanded or collapsed; with an aside form it is the full content width (card + aside).
  - The layout is **fixed per page** — the same on every step and tab, so the card width never jumps.
  - Pass `stepper` when a sticky `Stepper` sits above it (offsets the sticky aside).
- **`Stepper`** ([`panels/Stepper.tsx`](../src/shared-components/panels/Stepper.tsx)) — wizard
  progress. Optional `groups` (phases) and `labels` (short display names). **Not clickable by default**;
  pass `onStepClick` only where the page already let users jump between steps. Scrolls sideways below
  md with the current chip in view.
- **`FormSection`** — a group of fields, optionally `collapsible`.
  - Never put a `required` field in a section that is collapsed by default (a dev warning fires).
  - Collapsed content stays **mounted and hidden**, so values and native validation survive.
  - It opens itself on an invalid control or a Field error.
  - Edit pages open sections that already hold data and show "N filled" (`filledCount`). Key the
    section on the loaded record when form state is copied in by an effect.
  - `ExpandAllToggle` inside a `FormSectionGroup` renders only with 3+ collapsible sections.
- **`FieldHelpPanel`** — shows the focused field's label and its **existing** hint
  (`data-help-label` / `data-help` from `Field`). Never write new help copy for it; `FIELD_HELP_EMPTY`
  is the empty state on a hinted step with no Up next.
- **`UpNextCard`** — wizards only: next step number, name, optional description, Required badge.
- **`ChoiceCards` / `StatusChoice`** — radio cards with roving focus. `StatusChoice` (status picks
  only) selects with the success treatment; `ChoiceCards` (any other option set) with the accent
  treatment. 4+ options become a 2×2 grid below sm.
- **`ToggleRow`** ([`primitives/ToggleRow.tsx`](../src/shared-components/primitives/ToggleRow.tsx)) —
  label + Yes/No + switch (`role="switch"`). `hint` feeds Field help; `hintIcon` also shows the (?)
  tooltip.
- **`FormFooter`** — sticky footer: optional "Step X of Y", the page's Cancel/Back, and the primary
  button (label/disabled/busy passed through). `shortLabel` is the primary's text below sm.
  `unsavedNote` only on a page that actually guards unsaved changes — no page does today, so none
  passes it.
- **`Field`** ([`primitives/ui.tsx`](../src/shared-components/primitives/ui.tsx)) — label wired to
  the control (keeps an existing `id`), label turns accent on focus, optional `hint` (tooltip +
  `data-help`), optional `error` (danger outline, message under the control, `aria-invalid` /
  `aria-describedby`). `error` is display only; validation stays in the page.
- Auth screens use [`AuthCard`, `AuthError`, `AuthSubmit`](../src/shared-components/primitives/AuthCard.tsx):
  a persistent `aria-live` error region and a submit with spinner, busy label and `aria-busy`.

## 4. Motion

- **Tokens:** `duration-fast` 120ms, `duration-base` 200ms, `duration-slow` 320ms;
  `ease-out-token`, `ease-in-out-token`.
- New motion is **150–300ms**, animates **`transform` and `opacity` only** (no width/height/colour
  keyframes, no `stroke-dashoffset`), and plays once — no idle loops.
- Auth keyframes in `tailwind.config.js`: `rise-in`, `card-in` (starts at 0.6 opacity so inputs are
  usable at once), `curve-in`, `dot-pop`, `ring-pulse`, `error-in`, `shake-x`.
- Older entrance animations (`fade-in-up`, `slide-in-*`, `unwrap`, `draw-line`) run 400ms–1.5s and
  predate this rule; don't use them for new work.
- **`prefers-reduced-motion`:** a global rule in `index.css` reduces every animation and transition to
  ~0ms with no delay. Also add `motion-reduce:animate-none` / `motion-reduce:transition-none` at the
  call site, and hide purely decorative motion (`motion-reduce:hidden`) so the final frame shows.

## 5. Do / don't

**Do**
- Use tokens and the token-by-background table; reuse the components above before writing new ones.
- Use `StateBlock` for every loading, empty and error state.
- Format money with `lib/moneyFormat` / `lib/reportCurrency`; never sum across currencies.
- Keep existing copy, field names, `id`s, validation and requests when restyling.

**Don't**
- Add gradients, glows, blur, coloured shadows, or hex/`white` literals.
- Use `--brand` or metric hues for text in Light.
- Collapse required fields by default, or write new help/tip copy.
- Make Stepper chips clickable on a page that didn't already allow jumping.
- Change a form's layout between steps or tabs.
- Build a page-local dropdown (`useDropdown` + an `absolute top-full` panel) — use `MenuSelect` /
  `MenuPopover`.
- Put filter chips on their own row under a toolbar — use `FilterToolbar` / `ResultsBar`.

### Dev server

After changing `tailwind.config.js`, restart the Vite dev server — utilities added to the config are
not picked up by a running server. (A server left running from before a config change served CSS
without `z-overlay` / `z-popover`, so menus looked clipped under the table header; the production
build was correct.) Stopping the shell that ran `npm run dev` can leave the `vite.js` node process
alive: check that only one Vite listens on the port before verifying, and in the page confirm a
config utility resolves (e.g. an element with `z-popover` computes `z-index: 110`).

### Checklist for a new or changed page

- [ ] Light **and** Dark checked; every text pair ≥ 4.5:1, UI parts ≥ 3:1.
- [ ] At 390px wide: no horizontal page scroll (`document.documentElement.scrollWidth === 390`);
      wide tables scroll inside `TableScroll`; long strings wrap.
- [ ] Loading, empty and error states use `StateBlock`.
- [ ] Keyboard: visible focus ring, logical tab order, dialogs trap focus.
- [ ] Reduced motion shows the final state.
- [ ] No gradient / blur in the built CSS; no new colour literals.
- [ ] Route lazy-loaded (`React.lazy` + `<Suspense>`).
