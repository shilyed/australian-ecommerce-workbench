# Nike-inspired Workbench Design System

This is the frontend design reference for the Australian ecommerce workbench.
It adapts Nike's neutral palette, strong typography, pill-shaped actions, and
flat product presentation to a Chinese-language merchant operations interface.
It is not an official Nike design system or a verbatim copy of a storefront.

Adding this document does not change the running UI. Apply it when implementing
new or explicitly requested frontend redesigns; do not restyle unrelated pages
as a side effect of a functional fix.

Upstream reference: [VoltAgent/awesome-design-md, Nike DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/e06a96660396d741d0c106c8972172254dafbdc2/design-md/nike/DESIGN.md).
Pinned revision: `e06a96660396d741d0c106c8972172254dafbdc2`.
The source attribution and MIT notice are preserved below.

## 1. Visual direction

- Athletic clarity, strong hierarchy, restrained chrome, and useful density.
- Black, white, and neutral gray carry the interface. Color communicates a
  business state, not decoration.
- Use bold headings and a clear primary action, not campaign slogans or
  oversized storefront heroes.
- Keep product imagery prominent where real, authorized images already exist.
  Do not invent image data or add backend fields just to decorate a page.
- Prefer flat surfaces, thin dividers, and aligned content over nested cards.
- No neon glow, scanlines, glassmorphism, decorative gradients, or floating cards.

## 2. Color roles and themes

These are design values, not an additional runtime stylesheet. Map them to the
existing CSS variables in `app/src/index.css` and their Tailwind aliases. The
current variables use HSL channels: convert hex values before using them inside
`hsl(var(--...))`; do not paste hex strings into that expression.

| Role | Light | Dark | Existing token / purpose |
| --- | --- | --- | --- |
| Canvas | `#ffffff` | `#111111` | `--background` |
| Content surface | `#ffffff` | `#181818` | `--card`, `--popover` |
| Soft surface | `#f5f5f5` | `#242424` | `--secondary`, `--muted` |
| Primary text | `#111111` | `#f5f5f5` | `--foreground` |
| Secondary text | `#707072` | `#b3b3b5` | `--muted-foreground` |
| Primary action | `#111111` | `#f5f5f5` | `--primary` |
| Text on primary | `#ffffff` | `#111111` | `--primary-foreground` |
| Decorative divider | `#e5e5e5` | `#39393b` | `--border` |
| Essential control border | `#707072` | `#9e9ea0` | `--input` |
| Focus ring | `#111111` | `#f5f5f5` | `--ring` |
| Success | `#007d48` | `#6ee7b7` | Confirmed / completed state |
| Warning | `#8a4b00` | `#f5c16c` | Needs attention / incomplete |
| Danger | `#d30005` | `#ff8a8d` | Error / destructive action |
| Information | `#1151ff` | `#9bb8ff` | Informational state |

The light palette is the primary design reference. Preserve the existing theme
provider, system preference, and saved user selection; do not force a new theme.
Dark mode is a workbench adaptation, not a claim about Nike's storefront.

Use semantic roles instead of page-specific `text-red-300` or similar hardcoded
colors. State indicators need text or icons as well as color. In this workbench,
red may indicate operational errors and destructive actions, not only sale prices.
Check actual foreground/background combinations for WCAG AA contrast: 4.5:1 for
normal text and 3:1 for large text and essential non-text indicators. Decorative
dividers are not substitutes for visible control boundaries.

## 3. Typography

| Role | Size / line height | Weight | Usage |
| --- | --- | --- | --- |
| Page title | 28 / 36px | 700 | One clear page heading |
| Section title | 20 / 28px | 600 | Major content groups |
| Panel title | 16 / 24px | 600 | List, form, or detail heading |
| Body / table | 14 / 22px | 400 | Operational reading |
| Strong body | 14 / 22px | 600 | Product name or important value |
| Label / caption | 12 / 18px | 500 | Secondary metadata and form labels |
| Metric | 28 / 36px | 700 | Real numeric values |
| Button | 14 / 20px | 600 | Short, explicit action labels |

Use a system-first stack such as `"Helvetica Neue", Arial, "Noto Sans SC",
"PingFang SC", "Microsoft YaHei", sans-serif`. The existing available Chinese
font may be reused; this integration does not install or fetch fonts.

Nike Futura ND and Helvetica Now are reference typography, not bundled or
licensed assets. Do not download proprietary font files. An explicitly approved
editorial surface may use a separately licensed open-source display font, but
operational pages do not need one.

Keep Chinese text at normal letter spacing. Uppercase is limited to short Latin
identifiers, not decorative English headings above every Chinese title. Reserve
monospace for SKU, order IDs, or code; use tabular numerals for aligned amounts.
Do not apply the upstream 96px campaign tier to dashboards or forms.

## 4. Components and interaction states

Reuse the existing shadcn/Radix primitives under `app/src/components/ui` and
shared workbench components. Extend the current components instead of creating
parallel button, dialog, table, or theme implementations.

| Component | Default treatment | Required behavior |
| --- | --- | --- |
| Primary button | Ink fill, inverse text, full pill, 44px height, 24px horizontal padding | One primary action per action group |
| Secondary button | Soft-gray pill with primary text | Lower-emphasis alternatives |
| Destructive action | Explicit danger treatment and clear wording | Preserve existing confirmation requirements |
| Search | Soft-gray surface, 24px radius, 44px height | Visible label or accessible name |
| Form input | Neutral surface, 8px radius, 44px height | Persistent label; inline help and field errors |
| Filter chip | Neutral outlined pill; inverted when selected | Selected state is programmatically exposed |
| Status pill | Compact semantic text/icon with restrained background | No glow; status is not color-only |
| Product image | Flat, square crop on a soft-gray stage | Real authorized imagery; useful alt text |
| Table | Flat surface, subtle row separators, aligned columns | Right-align amounts; do not cram full details into a row |
| Detail sheet | Neutral surface, 12px radius where appropriate | Keyboard access, focus return, and unsaved-change handling |
| Empty state | Compact explanation and one useful action if available | Distinguish no records, no matches, and load failure |

Provide hover, focus-visible, active, disabled, loading, error, and selected
states where applicable. The upstream reference does not fully specify these;
the workbench must not omit them.

- Hover: use restrained neutral feedback, without lifting the component.
- Focus-visible: use a 2px visible ring with a 2px offset.
- Active: change surface or border; do not copy the upstream `scale(0.5)` press
  effect into operational controls.
- Disabled: preserve readable labels, use the native disabled state when
  appropriate, and prevent duplicate submissions.
- Loading: keep action labels understandable and expose pending status.
- Error: retain the entered data, show the actual error, and offer a valid retry
  when supported. Do not make failures look like successful empty results.

## 5. Layout, spacing, and page templates

Use a 4px sub-grid with an 8px base rhythm:
`4 / 8 / 12 / 16 / 24 / 32 / 48px`.

- Desktop sidebar reference width: 232px; preserve supported collapse behavior.
- Utility/header reference height: 56px.
- Content padding: 24px desktop, 16px tablet, 12px mobile.
- Related controls: 8px gap; fields: 16px gap; sections: 24-32px gap.
- Operational table rows start around 56px and may grow for meaningful content.
  Do not impose a fixed height that clips translated text or wrapped names.
- Use the available width for operational tables. Reserve a maximum width of
  about 1440px for reading-oriented dashboards and detail content when useful.

### Lists: sourcing, orders, inventory

Place title/actions, search/filters, and the working list before creation forms.
Open creation/editing in the existing Sheet or Dialog patterns when redesigning
these pages. Keep secondary metadata in details, not long paragraphs in each row.
Preserve URL-backed filters, deep links, permissions, and existing operations.

### Overview

Use compact metrics followed by the most important work queues and due actions.
Avoid several large empty panels that all compete for attention. A genuine zero
is different from missing or unverified data: show the latter with an explanation,
not a fabricated zero or invented trend chart.

### Product and marketplace details

Separate master product data from marketplace-specific information. Group long
forms into clear sections with visible error locations. Keep local save,
platform update, publish, and unpublish as distinct, explicitly labeled actions.
Styling must not turn a local save into a platform write.

## 6. Surfaces, shapes, and depth

- Product cards and table/list surfaces are flat, with 0px radius where practical.
- Standard form controls use 8px radius; sheets/dialog panels may use 12px.
- CTA buttons and filter chips use full pills; search uses 24px radius.
- Use 1px dividers to separate content; avoid borders around every nested group.
- Do not add drop shadows to ordinary cards. A restrained overlay shadow may be
  used for a popover or dialog if needed to distinguish its layer.
- Depth comes from content, imagery, and surface contrast, not decorative effects.

The form, overlay, and operational table treatments are deliberate adaptations:
the upstream analysis is primarily a retail storefront reference and leaves
important administrative UI patterns unspecified.

## 7. Design guardrails

Do:

- Make the next useful action and current business state easy to identify.
- Use black/white hierarchy, concise text, flat surfaces, and consistent alignment.
- Keep financial caveats, platform errors, and compliance warnings legible.
- Keep visible copy limited to labels, actual data/state, validation errors, and
  essential risk confirmations. Avoid explanatory paragraphs under action buttons.
- Preserve all existing business contracts, permission checks, and confirmations.

Do not:

- Add Nike logos, swooshes, slogans, campaign copy, or unlicensed imagery/fonts.
- Imply an official Nike association or use sports imagery as dashboard filler.
- Convert operational screens into storefronts with heroes, carousels, or giant
  display headings merely to imitate the reference.
- Remove necessary status colors, error messages, or field labels for minimalism.
- Hide essential actions behind hover-only controls.
- Add header slogans, repeated workflow tutorials, architectural explanations,
  or reassuring "this will not automatically..." notes to ordinary list pages.
  Put mandatory consequences only beside the relevant risky action or confirmation.
- Change APIs, database schema, workflow transitions, or deployments as part of
  applying this visual guide without a separate requirement.

## 8. Responsive behavior and accessibility

Use the existing Tailwind breakpoints rather than introducing a competing scale:
`sm 640px`, `md 768px`, `lg 1024px`, `xl 1280px`, `2xl 1536px`.

- Below 768px, use the existing mobile navigation drawer and single-column forms.
- At medium widths, reduce columns before shrinking text or controls.
- On wide screens, metrics may use three columns and work queues four; collapse
  these grids to two and then one as content width requires.
- Keep essential list columns visible. If a dense table needs horizontal
  scrolling, confine it to its table container, not the entire page.
- Mobile interactive targets must provide at least 44 x 44px of hit area.
- Do not communicate state only by color, movement, or hover.
- Use semantic headings, real labels, accessible names for icons, and the
  existing Radix focus management for overlays.
- Respect `prefers-reduced-motion`; restrict transitions to subtle 120-180ms
  feedback and avoid motion that shifts control positions.

## 9. Agent implementation workflow

1. Read this document and the existing component/page before editing frontend UI.
2. Determine whether the task is a functional change or an intentional redesign;
   do not expand a small fix into a whole-site restyle.
3. Reuse `AuthLayout`, `PageHeader`, `StatusPill`, `States`, and existing UI
   primitives. Add only the smallest shared abstraction the requested work needs.
4. During a redesign, centralize implemented values in the existing CSS-variable
   and Tailwind setup. Do not duplicate literal palettes in each feature page.
5. Inspect the requested page with representative data, missing data, long
   Chinese names, errors, both themes, keyboard navigation, and narrow widths.
6. Preserve all data loading, query parameters, mutation behavior, and business
   safeguards. A design reference is not authorization to deploy or publish.

Example implementation request:

> Redesign the sourcing list using the root DESIGN.md. Apply the neutral
> Nike-inspired palette, flat list hierarchy, and pill actions. Keep search and
> filters visible, move creation into an accessible sheet, reuse existing
> primitives, and preserve all data contracts and mutation behavior.

## Source attribution and license

Adapted from `design-md/nike/DESIGN.md` in
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) at
revision `e06a96660396d741d0c106c8972172254dafbdc2`. Palette and visual vocabulary
come from that reference; Chinese typography, administrative layouts, dark mode,
complete interaction states, and workflow safeguards are workbench adaptations.

The upstream MIT notice below applies to the upstream-derived design guidance.
It does not relicense this application's other source files or grant rights to
Nike trademarks, photography, or proprietary fonts.

```text
MIT License

Copyright (c) 2026 VoltAgent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
