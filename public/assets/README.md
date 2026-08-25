# Art drop

Drop the client's artwork here using these exact filenames. Everything is optional —
the game renders a clean vector store if a file is missing.

| File | Size | Used for |
| --- | --- | --- |
| `board.png` | 608×608 (19×19 tiles @ 32px) | The store floor art. Drawn under the shelf overlay, so it must line up with the 19×19 grid in `public/src/config.js`. |
| `icon-192.png` | 192×192 | PWA / home-screen icon |
| `icon-512.png` | 512×512 | PWA splash + store listing |

## Lining board art up with the grid

The map in `config.js` is 19 columns × 19 rows. If the mockup's aisles do not match,
edit the `MAP` glyph rows rather than stretching the image — `npm run qa` re-checks that
every item, the pen and the checkout lane are still reachable after any map edit.

Keep `board.png` under ~250 KB (export as 8-bit PNG or run it through an optimizer);
the Lighthouse performance budget for this project is ≥ 85.
