# KVFX Tools website

A one-page site that sells KVFX Tools: a hero tour, the top ten features in
one player, everything inside the panel, pricing and questions. It is plain
HTML with its CSS and JavaScript inline, and no framework, so it loads fast
and can be hosted anywhere.

The top ten, in order: Curve Editor, Text Animate, Duplicate Comp + Nested,
Effects Manager, Comp Resizer, Silence Remover, Follow Layer, Unprecompose,
Sequence Layers and Align as Group.

The dot grid behind the headline answers the visitor's own cursor: the dots
near it light up and lean away, a click sends a ripple through the grid, and
a drag draws a selection box, like a marquee in a comp, that selects the
headline words, the text and the cards it touches (Escape or a click on empty
space clears it). Links and buttons work as usual, and on phones a tap sends
the ripple. It is drawn on two canvases, so it costs no download.

## Why it loads fast

* **The first view is light.** It needs only the page (about 43 KB), the
  fonts and a 34 KB poster image.
* **Videos wait their turn.**
  * Every `<video>` is `preload="none"` with a WebP poster.
  * The hero clip starts loading only after the page has finished, when the
    browser is idle.
  * The feature player loads one clip at a time, when it scrolls into view.
  * Clips pause whenever they are off screen.
* **The clips are tiny.**
  * Each feature clip is 32–130 KB in AV1/WebM, which Chrome, Edge and
    Firefox play, or 47–180 KB in H.264/MP4, which Safari uses.
  * The hero tour, across the Text, Ease, FX, Generate and Tools tabs, is
    460 KB.
  * The browser downloads only the format it can play.
* **Visitors who ask for less get less.** With *Reduce motion* or *Data
  Saver* turned on, nothing plays until the visitor presses play. With
  *Reduce motion*, the grid still lights up and selects, without the ripple
  or the lean.
* **Nothing runs when nothing moves.** The grid draws only while the cursor
  is moving over it or a ripple is still spreading.

## Before you go live

Edit the three values at the top of the `<script>` near the end of
`index.html`:

```js
const CONFIG = {
  buyUrl: "#pricing",                        // your checkout link
  youtubeUrl: "https://www.youtube.com/",    // your channel or the playlist
  price: "$29",                              // shown on the page
};
```

Then also:

* **Price for search engines:** set the price in the `application/ld+json`
  block at the top of the page.
* **Pricing promises:** check the list in the pricing card. "Free updates for
  version 1" and "No account and no activation" are written as promises. Keep
  them only if they are your policy. KVFX Tools has no activation today.
* **Share image:** put your domain in front of `assets/og.jpg` in the
  `og:image` tag (`https://yourdomain.com/assets/og.jpg`). Social apps need the
  full address.
* **Legal pages:** add Terms, Privacy and Refund pages, and link them in the
  footer. Payment providers check for them before they approve a store.
* **Test in After Effects first:** test the plugin in a real After Effects on
  Windows and on macOS before taking payments. `docs/FEATURES.md` lists what
  has only been tested against the mock so far.

## Hosting: the recommended setup

**Static hosting + a checkout that delivers the download.** It's the fastest
site, it costs nothing to host, and you keep full control of the design.

1. **Host the `website` folder** on Cloudflare Pages, Netlify or GitHub Pages,
   all of which are free. On Cloudflare Pages, connect this repository, set the
   output directory to `website`, and leave the build command empty. Every push
   updates the site.
2. **Point your domain at it**, for example `kvfx.tools` or `kvfxtools.com`.
3. **Sell through a checkout link.** Create the product with your provider,
   upload the installer zip, and paste the product's checkout link into
   `buyUrl`. Each provider gives you its own link or overlay script.

| Checkout | Good for | Watch out for |
|---|---|---|
| **Gumroad** | Starting today: product page, file delivery, UPI at checkout, payouts to Indian banks. It handles sales tax as merchant of record. | About 10% + $0.50 a sale, more through its Discover marketplace. |
| **Paddle** | Selling worldwide with tax, invoices and licence keys handled for you, at about 5% + $0.50. | It reviews your site and legal pages before approving you. Confirm that it accepts sellers based in India. |
| **Dodo Payments** | An India-based merchant of record with licence keys built in. | Check its current fees. |
| **Razorpay** | Mostly Indian buyers: low fees, UPI, cards. It can take international payments too. | You handle GST, invoices and delivering the file yourself. |
| **aescripts + aeplugins** | Reaching After Effects users who already shop there. List it there as well as on your own site. | Reported to take a sizeable commission (about 30% per a third-party source); confirm with them. |

The fees in this table come from a web search in October 2026. Check each
provider's own pricing page before you choose.

## If you'd rather use WordPress or Shopify

**WordPress** suits you if you'll also run a blog for search traffic and want
to edit everything from a dashboard. It needs paid hosting and regular plugin
updates, and it is slower unless you tune it.

* **Store:** Easy Digital Downloads, built for selling software, with licence
  keys in its higher plans. WooCommerce with a digital-products setup also
  works.
* **This page:** make a page with a blank, full-width template. Put the
  contents of `index.html` (from `<style>` to the end of `<script>`) in a
  Custom HTML block, and upload `assets/` to the Media Library or by FTP.
  Update the file paths to match.

**Shopify** suits physical products and merch. For a single digital download
you pay a monthly plan plus a digital-downloads app, and you get less design
control. It is only worth it if you'll also sell other things.

* **This page:** make a page template (`page.kvfx.liquid`) with this page's
  HTML, and upload the clips under Content ▸ Files.

**Framer or Webflow** are design-first builders with visual editing and fast
hosting, on a monthly plan. Rebuild the page there, upload the clips, and link
the buy buttons to your checkout.

## The clips

`assets/clips` is made from the rendered feature videos:

```
node scripts/feature-videos.mjs --layout 16x9   # if build/feature-videos is empty
node scripts/website-clips.mjs
```

Each feature gives `<id>.webm` (AV1), `<id>.mp4` (H.264) and `<id>.webp`
(poster). The Curve Editor, Text Animate and Effects Manager clips (`ease`,
`text`, `fx`) come from the tour videos, which render with
`node scripts/feature-videos.mjs --only text,ease,fx,generate`. `hero.*` is
the tour at the top of the page: Text Animate, the Ease curve, the Effects
Manager, Layouts, Comp Resizer and Follow Layer.

More interactions to choose from are in `promo/web-lab/index.html` (the
Motion Lab): a stagger grid, magnetic buttons, text presets, a live ease
curve, tilt cards, a scroll-driven timeline, a velocity marquee, snap and
throw, rolling numbers and a cursor follower. Each is plain JavaScript in its
own block, ready to move into this page.

To change the order of the top ten, move the items in the `#fp-list` list in
`index.html` (and their numbers), and set the player's default `poster`,
title and text to the new first item.
