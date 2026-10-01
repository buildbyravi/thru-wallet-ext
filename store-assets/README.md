# Chrome Web Store Assets — Thru Wallet

This directory contains all the visual assets required for publishing and featuring **Thru Wallet** on the Chrome Web Store.

## Store Assets Checklist

| Asset File | Dimensions | Purpose | Chrome Web Store Location |
| --- | --- | --- | --- |
| `icon-128.png` | 128 x 128 px | Official Store Icon | Store Listing -> Store icon |
| `screenshot-1-dashboard.png` | 1280 x 800 px (16:10) | Dashboard & Portfolio Balance | Store Listing -> Screenshots |
| `screenshot-2-tokens.png` | 1280 x 800 px (16:10) | Sliding Token Drawer & Custom Mint Verification | Store Listing -> Screenshots |
| `screenshot-3-send.png` | 1280 x 800 px (16:10) | Secure Transfers & Live Fee Quotes | Store Listing -> Screenshots |
| `screenshot-4-activity.png` | 1280 x 800 px (16:10) | Live Activity Feed & Auto-Sync | Store Listing -> Screenshots |
| `screenshot-5-security.png` | 1280 x 800 px (16:10) | Self-Custody Security & Shortcuts | Store Listing -> Screenshots |
| `promo-small-440x280.png` | 440 x 280 px | Small Promotional Tile | Store Listing -> Promotional images -> Small tile |
| `promo-marquee-1400x560.jpg` | 1400 x 560 px | Marquee Promotional Banner | Store Listing -> Promotional images -> Marquee tile |

## Regeneration

To regenerate all store assets from the latest codebase design:

```bash
node scripts/generate-store-assets.mjs
```
