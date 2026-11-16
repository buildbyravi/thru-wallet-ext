# Chrome Web Store Assets — Thru Wallet

Visual assets for the **Thru Wallet** Chrome Web Store listing (`extension.md` is the listing copy source of truth).

## Store Assets Inventory

| Asset File | Dimensions | Purpose | Chrome Web Store Slot |
| --- | --- | --- | --- |
| `icon-128.png` | `128 x 128 px` | Extension Store Icon | Store Listing -> Store icon |
| `screenshot-1-dashboard.png` | `1280 x 800 px` (16:10) | Dashboard & Portfolio Balance | Store Listing -> Screenshots |
| `screenshot-2-tokens.png` | `1280 x 800 px` (16:10) | Sliding Token Drawer & Custom Mint Verification | Store Listing -> Screenshots |
| `screenshot-3-send.png` | `1280 x 800 px` (16:10) | Reviewed Transfers & Fee Quotes | Store Listing -> Screenshots |
| `screenshot-4-activity.png` | `1280 x 800 px` (16:10) | Flat Activity Stream & Auto-Sync | Store Listing -> Screenshots |
| `screenshot-5-security.png` | `1280 x 800 px` (16:10) | Self-Custody Security & Shortcuts | Store Listing -> Screenshots |
| `promo-small-440x280.png` | `440 x 280 px` | Small Promotional Tile | Promotional images -> Small tile |
| `promo-marquee-1400x560.jpg` | `1400 x 560 px` | Marquee Promotional Banner | Promotional images -> Marquee tile |

## Regeneration Note

`node scripts/generate-store-assets.mjs` renders synthetic marketing compositions via local Windows Chrome/PowerShell (not live `dist/` popup captures) and overwrites this `README.md` when run. Verify rendered screenshots visually against the shipped UI (`dist/`) and `extension.md` before uploading a new store package.
