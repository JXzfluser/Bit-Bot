# Grok 真源差量表（自动生成，勿手改）

- 真源：`docs/design/desktop-target/reference/grok-real-spec.json` · 我方：`docs/design/desktop-target/reference/bb-real-spec.json`
- 同值 **110** 项 · 差值 **420** 项 · 仅真源有 **1315** 项 · 仅我方有 **396** 项

> 数值由 `scripts/grok_real_spec_capture.mjs` 与 `scripts/bb_spec_capture.mjs` 实测产出；
> 重跑：`node scripts/grok_real_spec_capture.mjs && node scripts/bb_spec_capture.mjs && node scripts/grok_delta_report.mjs --md docs/design/desktop-target/alignment-delta-tables.md`

### windowShell

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `padding` | 0px 0px 0px 0px | 0 |
| `margin` | 0px 0px 0px 0px | 0 |
| `backgroundColor` | rgb(252, 252, 252) | rgb(255, 255, 255) |
| `fontFamily` | -apple-system, "system-ui", "segoe ui", sans-serif | -apple-system, "system-ui", "pingfang sc", "hiragino sans gb", "microsoft yahei", sans-serif |
| `fontSize` | 16 | 15 |
| `color` | rgb(28, 28, 28) | rgb(26, 26, 26) |

### sidebar

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `top` | 0 | 56 |
| `height` | 760 | 704 |
| `padding` | 0px 0px 0px 0px | 0px 12px |
| `backgroundColor` | rgb(245, 245, 245) | rgb(247, 247, 247) |
| `borderRightWidth` | 0.5 | 1 |
| `borderRightColor` | rgba(28, 28, 28, 0.08) | rgb(227, 227, 227) |
| `color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `fontFamily` | -apple-system, "system-ui", "segoe ui", sans-serif | -apple-system, "system-ui", "pingfang sc", "hiragino sans gb", "microsoft yahei", sans-serif |
| `fontSize` | 16 | 15 |

### sidebarHeader

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 0 | 12 |
| `top` | 0 | 56 |
| `width` | 279.5 | 255 |
| `height` | 60 | 48 |
| `padding` | 12px 16px 12px 16px | 6px 6px 8px 64px |
| `gap` | 8 | 10 |
| `color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `borderTopColor` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `fontSize` | 16 | 15 |
| `fontWeight` | 420 | 400 |
| `lineHeight` | normal | 21.75 |

### sidebarHeaderButtons[0]

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 183.5 | 183 |
| `top` | 12 | 62 |
| `width` | 36 | 34 |
| `height` | 36 | 34 |
| `borderRadius` | 9999 | 50% |
| `borderTopWidth` | 1 | 0 |
| `borderTopColor` | rgba(28, 28, 28, 0.08) | rgb(26, 26, 26) |
| `color` | rgba(28, 28, 28, 0.92) | rgb(26, 26, 26) |
| `boxShadow` | none | rgba(0, 0, 0, 0.07) 0px 1px 2px 0px |

### sidebarHeaderButtons[1]

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 227.5 | 227 |
| `top` | 12 | 62 |
| `width` | 36 | 34 |
| `height` | 36 | 34 |
| `borderRadius` | 9999 | 50% |
| `borderTopWidth` | 1 | 0 |
| `borderTopColor` | rgba(28, 28, 28, 0.08) | rgb(26, 26, 26) |
| `color` | rgba(28, 28, 28, 0.92) | rgb(26, 26, 26) |
| `boxShadow` | none | rgba(0, 0, 0, 0.07) 0px 1px 2px 0px |

### sessionRow

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `top` | 98 | 173.69 |
| `width` | 255.5 | 255 |
| `height` | 54 | 58 |
| `padding` | 8px 8px 8px 8px | 11px 9px 11px 6px |
| `margin` | 0px 0px 0px 0px | 0 |
| `gap` | 8 | 11 |
| `color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `borderTopColor` | rgb(0, 0, 0) | rgb(26, 26, 26) |
| `borderRadius` | 10 | 12 |
| `fontFamily` | -apple-system, "system-ui", "segoe ui", sans-serif | -apple-system, "system-ui", "pingfang sc", "hiragino sans gb", "microsoft yahei", sans-serif |
| `fontSize` | 16 | 15 |
| `fontWeight` | 420 | 400 |
| `lineHeight` | normal | 21.75 |
| `interRowGap` | 4 | 0 |
| `title/left` | 64 | 65 |
| `title/top` | 106 | 184.69 |
| `title/width` | 195.5 | 193 |
| `title/height` | 20 | 18 |
| `title/fontSize` | 16 | 13.5 |
| `title/fontWeight` | 420 | 600 |
| `title/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `title/lineHeight` | normal | 18 |
| `preview/left` | 64 | 65 |
| `preview/top` | 126 | 202.69 |
| `preview/width` | 195.5 | 193 |
| `preview/fontWeight` | 420 | 400 |
| `preview/color` | rgba(28, 28, 28, 0.68) | rgb(111, 111, 111) |
| `activeRowBackground` | null | color(srgb 0.899294 0.899294 0.899294) |

### avatar

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 20 | 18 |
| `top` | 107 | 184.69 |
| `borderRadius` | 0 | 46% 54% 48% 52% / 52% 46% 54% 48% |
| `backgroundColor` | rgba(0, 0, 0, 0) | rgb(24, 194, 114) |
| `overflow` | visible | hidden |

### groupLabel

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `top` | 64 | 152.84 |
| `width` | 255.5 | 255 |
| `height` | 30 | 18.84 |
| `padding` | 8px 8px 6px 8px | 0px 9px |
| `margin` | 0px 0px 0px 0px | 14px 0px 2px |
| `gap` | 0 | 8 |
| `fontWeight` | 420 | 500 |
| `color` | rgb(0, 0, 0) | color(srgb 0.675294 0.675294 0.675294) |
| `textSpan/left` | 20 | 21 |
| `textSpan/top` | 72 | 152.84 |
| `textSpan/width` | 223.5 | 26 |
| `textSpan/height` | 16 | 18.84 |
| `textSpan/fontSize` | 12 | 13 |
| `textSpan/fontWeight` | 420 | 500 |
| `textSpan/color` | rgba(28, 28, 28, 0.68) | color(srgb 0.675294 0.675294 0.675294) |
| `textSpan/lineHeight` | 16 | 18.85 |

### composer

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `dock/top` | 700 | 649.5 |
| `dock/height` | 60 | 96.5 |
| `dock/padding` | 0px 16px 16px | 0 |
| `dock/gap` | normal | 6 |
| `left` | 296 | 280 |
| `top` | 700 | 693.5 |
| `width` | 728 | 760 |
| `height` | 44 | 52.5 |
| `padding` | 0 | 5px 8px 5px 10px |
| `margin` | 0px 0px 0px 0px | 0 |
| `gap` | normal | 4 |
| `borderTopWidth` | 0.5 | 1 |
| `borderTopColor` | rgba(28, 28, 28, 0.12) | rgb(227, 227, 227) |
| `borderRadius` | 22 | 24 |
| `boxShadow` | rgba(0, 0, 0, 0.05) 0px 2px 8px -1px, rgba(0, 0, 0, 0.03) 0px 1px 2px 0px, rgba(228, 228, 228, 0.04) 0px 0px 0px 1px | rgba(0, 0, 0, 0.04) 0px 1px 2px 0px |
| `field/left` | 340.5 | 331 |
| `field/top` | 712 | 699.5 |
| `field/width` | 603 | 622 |
| `field/height` | 20 | 40.5 |
| `field/fontSize` | 14 | 15 |
| `field/lineHeight` | 20 | 22.5 |
| `field/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `field/fontFamily` | -apple-system, "system-ui", "segoe ui", sans-serif | -apple-system, "system-ui", "pingfang sc", "hiragino sans gb", "microsoft yahei", sans-serif |
| `fieldLeftInset` | 44.5 | 51 |
| `frameWidthVsPane` | 0.96 | 1 |

### attachButton

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 304.5 | 291 |
| `top` | 707.5 | 704 |
| `width` | 28 | 36 |
| `height` | 28 | 36 |
| `borderRadius` | 9999 | 50% |
| `backgroundColor` | rgba(28, 28, 28, 0.06) | rgba(0, 0, 0, 0) |
| `color` | rgba(28, 28, 28, 0.56) | rgb(111, 111, 111) |
| `boxShadow` | rgba(28, 28, 28, 0.08) 0px 0px 0px 0.5px inset | none |

### micButton

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 987.5 | 957 |
| `top` | 707.5 | 704 |
| `width` | 28 | 36 |
| `height` | 28 | 36 |
| `borderRadius` | 9999 | 50% |
| `backgroundColor` | rgb(28, 28, 28) | rgba(0, 0, 0, 0) |
| `color` | rgb(252, 252, 252) | rgb(111, 111, 111) |

### bubble

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 326 | 296 |
| `top` | -946 | 286 |
| `width` | 558.4 | 728 |
| `height` | 58 | 179 |
| `padding` | 7px 12px 7px 12px | 14px 18px |
| `margin` | 0px 0px 0px 0px | 0 |
| `color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `backgroundColor` | rgba(28, 28, 28, 0.06) | rgb(244, 244, 245) |
| `borderTopColor` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `borderRadius` | 18 | 16 |
| `boxShadow` | rgba(255, 255, 255, 0.16) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.16) 0px -0.5px 0px 0px inset, rgba(28, 28, 28, 0.06) 0px 0px 0px 0.5px inset | none |
| `fontFamily` | -apple-system, "system-ui", "segoe ui", sans-serif | -apple-system, "system-ui", "pingfang sc", "hiragino sans gb", "microsoft yahei", sans-serif |
| `fontSize` | 14 | 15 |
| `fontWeight` | 420 | 400 |
| `lineHeight` | 20 | 24 |
| `hasShadow` | true | false |

### bubbleVariants[0]

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 326 | 296 |
| `top` | -946 | 286 |
| `width` | 558.4 | 728 |
| `height` | 58 | 179 |
| `backgroundColor` | rgba(28, 28, 28, 0.06) | rgb(244, 244, 245) |
| `color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `borderRadius` | 18 | 16 |
| `padding` | 7px 12px | 14px 18px |
| `boxShadow` | rgba(255, 255, 255, 0.16) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.16) 0px -0.5px 0px 0px inset, rgba(28, 28, 28, 0.06) 0px 0px 0px 0.5px inset | none |

### bubbleVariants[1]

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 464 | 665.53 |
| `top` | -11 | 196 |
| `width` | 560 | 358.47 |
| `height` | 58 | 40 |
| `backgroundColor` | rgb(28, 28, 28) | rgb(236, 238, 240) |
| `color` | rgb(255, 255, 255) | rgb(26, 26, 26) |
| `borderRadius` | 18 | 18px 18px 6px |
| `padding` | 7px 12px | 10px 16px 6px |
| `boxShadow` | rgba(255, 255, 255, 0.16) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.16) 0px -0.5px 0px 0px inset, rgba(28, 28, 28, 0.06) 0px 0px 0px 0.5px inset | none |

### bubbleAuthorName

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 338 | 332 |
| `top` | -966 | 257.3 |
| `width` | 19.7 | 39.65 |
| `height` | 16 | 17.4 |
| `fontWeight` | 420 | 600 |
| `color` | rgba(28, 28, 28, 0.68) | rgb(124, 58, 237) |
| `lineHeight` | 16 | 17.4 |

### bubbleAvatar

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `top` | -910 | 252 |
| `width` | 22 | 28 |
| `height` | 22 | 28 |
| `borderRadius` | 0 | 50% |
| `backgroundColor` | rgba(0, 0, 0, 0) | color(srgb 0.184314 0.619608 0.266667 / 0.16) |

### messageColumn

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `row/top` | -980 | 252 |
| `row/height` | 94 | 213 |
| `row/padding` | 2px 0px | 0 |
| `row/margin` | 0px 0px 0px 0px | 0 |
| `rowWidth` | 728 | 760 |
| `sideMargin` | 16 | 0 |
| `codeBlock/left` | 338 | 314 |
| `codeBlock/top` | 90 | 336 |
| `codeBlock/width` | 534.4 | 692 |
| `codeBlock/height` | 158 | 103 |
| `codeBlock/borderRadius` | 0 | 12 |
| `codeBlock/backgroundColor` | rgba(0, 0, 0, 0) | rgb(244, 244, 245) |
| `codeBlock/borderTopWidth` | 0 | 1 |
| `codeBlock/borderTopColor` | rgb(28, 28, 28) | rgb(227, 227, 227) |
| `codeBlock/padding` | 0 | 24px 12px 12px |

### accountBar

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 0 | 12 |
| `top` | 708 | 706 |
| `width` | 279.5 | 255 |
| `height` | 52 | 44 |
| `padding` | 0px 16px 16px 16px | 0 |
| `gap` | 2 | 4 |
| `accountButton/left` | 16 | 12 |
| `accountButton/top` | 708 | 706 |
| `accountButton/width` | 171.5 | 179 |
| `accountButton/height` | 36 | 44 |
| `accountButton/borderRadius` | 9999 | 999 |
| `accountButton/fontSize` | 13 | 13.33 |
| `accountButton/color` | rgb(28, 28, 28) | rgb(0, 0, 0) |
| `accountButton/padding` | 0px 17px 0px 0px | 6px 12px 6px 6px |
| `accountButton/boxShadow` | none | rgba(0, 0, 0, 0.06) 0px 1px 2px 0px |
| `accountAvatar/left` | 16 | 18 |
| `accountAvatar/top` | 708 | 712 |
| `accountAvatar/width` | 36 | 32 |
| `accountAvatar/height` | 36 | 32 |
| `accountAvatar/borderRadius` | 9999 | 50% |
| `emailText/left` | 60 | 58 |
| `emailText/top` | 716 | 720.5 |
| `emailText/width` | 110.5 | 97 |
| `emailText/height` | 20 | 15 |
| `emailText/fontSize` | 14 | 13 |
| `emailText/fontWeight` | 500 | 600 |
| `emailText/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |

### sendButton

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `left` | 987.5 | 997 |
| `top` | 707.5 | 706 |
| `width` | 28 | 34 |
| `height` | 28 | 34 |
| `backgroundColor` | rgb(28, 28, 28) | rgb(124, 58, 237) |
| `color` | rgb(252, 252, 252) | rgb(255, 255, 255) |
| `borderRadius` | 9999 | 50% |
| `boxShadow` | none | rgba(0, 0, 0, 0.15) 0px 2px 6px 0px |

### accountPopup

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `separators[0]/height` | 0 | 1 |
| `separators[0]/margin` | 4px 8px | 4px 6px |
| `items[0]/left` | 22 | 19 |
| `items[0]/top` | 497.5 | 278 |
| `items[0]/width` | 216 | 246 |
| `items[0]/height` | 30 | 34.5 |
| `items[0]/padding` | 6px 8px | 8px 10px |
| `items[0]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `items[0]/borderRadius` | 6 | 8 |
| `items[0]/fontWeight` | 420 | 400 |
| `items[1]/left` | 22 | 19 |
| `items[1]/top` | 529.5 | 314.5 |
| `items[1]/width` | 216 | 246 |
| `items[1]/height` | 30 | 34.5 |
| `items[1]/padding` | 6px 8px | 8px 10px |
| `items[1]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `items[1]/borderRadius` | 6 | 8 |
| `items[1]/fontWeight` | 420 | 400 |
| `items[2]/left` | 22 | 19 |
| `items[2]/top` | 561.5 | 362 |
| `items[2]/width` | 216 | 246 |
| `items[2]/height` | 30 | 34.5 |
| `items[2]/padding` | 6px 8px | 8px 10px |
| `items[2]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `items[2]/borderRadius` | 6 | 8 |
| `items[2]/fontWeight` | 420 | 400 |
| `items[3]/left` | 22 | 19 |
| `items[3]/top` | 593.5 | 398.5 |
| `items[3]/width` | 216 | 246 |
| `items[3]/height` | 30 | 34.5 |
| `items[3]/padding` | 6px 8px | 8px 10px |
| `items[3]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `items[3]/borderRadius` | 6 | 8 |
| `items[3]/fontWeight` | 420 | 400 |
| `items[4]/left` | 22 | 19 |
| `items[4]/top` | 636 | 446 |
| `items[4]/width` | 216 | 246 |
| `items[4]/height` | 30 | 34.5 |
| `items[4]/padding` | 6px 8px | 8px 10px |
| `items[4]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `items[4]/borderRadius` | 6 | 8 |
| `items[4]/fontWeight` | 420 | 400 |
| `items[5]/left` | 22 | 19 |
| `items[5]/top` | 668 | 482.5 |
| `items[5]/width` | 216 | 246 |
| `items[5]/height` | 30 | 34.5 |
| `items[5]/padding` | 6px 8px | 8px 10px |
| `items[5]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `items[5]/borderRadius` | 6 | 8 |
| `items[5]/fontWeight` | 420 | 400 |

### connectAppsPanel

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `container/left` | 120 | 160 |
| `container/top` | 47 | 68.4 |
| `container/width` | 800 | 720 |
| `container/height` | 666 | 623.2 |
| `container/padding` | 0 | 16 |
| `container/borderRadius` | 14 | 16 |
| `container/boxShadow` | none | rgba(0, 0, 0, 0.18) 0px 24px 64px 0px |
| `container/borderTopColor` | rgba(28, 28, 28, 0.12) | rgb(232, 232, 234) |
| `container/zIndex` | 10001 | auto |
| `container/position` | fixed | static |
| `container/overflow` | hidden | auto |
| `container/fontFamily` | -apple-system, "system-ui", "segoe ui", sans-serif | -apple-system, "system-ui", "pingfang sc", "hiragino sans gb", "microsoft yahei", sans-serif |
| `container/fontSize` | 13 | 14 |
| `container/fontWeight` | 420 | 400 |
| `container/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `title/left` | 153 | 177 |
| `title/top` | 100 | 87.65 |
| `title/width` | 734 | 83.16 |
| `title/height` | 24 | 31.5 |
| `title/fontSize` | 17 | 21 |
| `title/fontWeight` | 500 | 600 |
| `title/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `close/left` | 881 | 835.98 |
| `close/top` | 58 | 85.4 |
| `close/width` | 28 | 27.02 |
| `close/height` | 28 | 36 |
| `close/color` | rgba(28, 28, 28, 0.66) | rgb(117, 117, 122) |
| `close/borderRadius` | 9999 | 8 |
| `close/fontSize` | 13 | 0 |
| `close/fontWeight` | 420 | 500 |
| `close/borderTopColor` | rgb(0, 0, 0) | rgb(117, 117, 122) |
| `searchBox/left` | 185.5 | 177 |
| `searchBox/top` | 148 | 156.9 |
| `searchBox/width` | 571.6 | 636 |
| `searchBox/height` | 20 | 39 |
| `searchBox/fontWeight` | 420 | 400 |
| `searchBox/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `searchBox/backgroundColor` | rgba(0, 0, 0, 0) | rgb(255, 255, 255) |
| `searchBox/borderRadius` | 0 | 10 |
| `chips[0]/left` | 153 | 177 |
| `chips[0]/top` | 186 | 205.9 |
| `chips[0]/width` | 46 | 56 |
| `chips[0]/height` | 28 | 32.5 |
| `chips[0]/backgroundColor` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `chips[0]/color` | rgb(252, 252, 252) | rgb(255, 255, 255) |
| `chips[0]/borderRadius` | 9999 | 999 |
| `chips[0]/fontWeight` | 420 | 500 |
| `chips[0]/borderTopWidth` | 0 | 1 |
| `chips[0]/borderTopColor` | rgb(0, 0, 0) | rgb(26, 26, 26) |
| `chips[1]/left` | 207 | 239 |
| `chips[1]/top` | 186 | 205.9 |
| `chips[1]/width` | 85 | 95 |
| `chips[1]/height` | 28 | 32.5 |
| `chips[1]/backgroundColor` | rgba(28, 28, 28, 0.06) | rgb(255, 255, 255) |
| `chips[1]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `chips[1]/borderRadius` | 9999 | 999 |
| `chips[1]/fontWeight` | 420 | 500 |
| `chips[1]/borderTopWidth` | 0 | 1 |
| `chips[1]/borderTopColor` | rgb(0, 0, 0) | rgb(232, 232, 234) |
| `chips[2]/left` | 300 | 340 |
| `chips[2]/top` | 186 | 205.9 |
| `chips[2]/width` | 46 | 56 |
| `chips[2]/height` | 28 | 32.5 |
| `chips[2]/backgroundColor` | rgba(28, 28, 28, 0.06) | rgb(255, 255, 255) |
| `chips[2]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `chips[2]/borderRadius` | 9999 | 999 |
| `chips[2]/fontWeight` | 420 | 500 |
| `chips[2]/borderTopWidth` | 0 | 1 |
| `chips[2]/borderTopColor` | rgb(0, 0, 0) | rgb(232, 232, 234) |
| `chips[3]/left` | 354 | 402 |
| `chips[3]/top` | 186 | 205.9 |
| `chips[3]/width` | 46 | 56 |
| `chips[3]/height` | 28 | 32.5 |
| `chips[3]/backgroundColor` | rgba(28, 28, 28, 0.06) | rgb(255, 255, 255) |
| `chips[3]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `chips[3]/borderRadius` | 9999 | 999 |
| `chips[3]/fontWeight` | 420 | 500 |
| `chips[3]/borderTopWidth` | 0 | 1 |
| `chips[3]/borderTopColor` | rgb(0, 0, 0) | rgb(232, 232, 234) |
| `chips[4]/left` | 408 | 464 |
| `chips[4]/top` | 186 | 205.9 |
| `chips[4]/width` | 46 | 56 |
| `chips[4]/height` | 28 | 32.5 |
| `chips[4]/backgroundColor` | rgba(28, 28, 28, 0.06) | rgb(255, 255, 255) |
| `chips[4]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `chips[4]/borderRadius` | 9999 | 999 |
| `chips[4]/fontWeight` | 420 | 500 |
| `chips[4]/borderTopWidth` | 0 | 1 |
| `chips[4]/borderTopColor` | rgb(0, 0, 0) | rgb(232, 232, 234) |
| `chips[5]/left` | 462 | 526 |
| `chips[5]/top` | 186 | 205.9 |
| `chips[5]/width` | 46 | 56 |
| `chips[5]/height` | 28 | 32.5 |
| `chips[5]/backgroundColor` | rgba(28, 28, 28, 0.06) | rgb(255, 255, 255) |
| `chips[5]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `chips[5]/borderRadius` | 9999 | 999 |
| `chips[5]/fontWeight` | 420 | 500 |
| `chips[5]/borderTopWidth` | 0 | 1 |
| `chips[5]/borderTopColor` | rgb(0, 0, 0) | rgb(232, 232, 234) |
| `grid/left` | 141 | 177 |
| `grid/top` | 276 | 572.09 |
| `grid/width` | 758 | 686 |
| `grid/height` | 196 | 167.5 |
| `grid/gap` | 2px 8px | 8 |
| `grid/gridTemplateColumns` | 375px 375px | 339px 339px |
| `rowCount` | 67 | 3 |
| `rows[0]/left` | 153 | 177 |
| `rows[0]/top` | 288 | 572.09 |
| `rows[0]/width` | 259.2 | 339 |
| `rows[0]/height` | 40 | 167.5 |
| `rows[0]/borderRadius` | 6 | 12 |
| `rows[0]/padding` | 0 | 12px 14px |
| `rows[1]/left` | 536 | 524 |
| `rows[1]/top` | 288 | 572.09 |
| `rows[1]/width` | 259.2 | 339 |
| `rows[1]/height` | 40 | 167.5 |
| `rows[1]/borderRadius` | 6 | 12 |
| `rows[1]/padding` | 0 | 12px 14px |
| `rows[2]/left` | 153 | 177 |
| `rows[2]/top` | 354 | 779.09 |
| `rows[2]/width` | 259.2 | 339 |
| `rows[2]/height` | 40 | 18 |
| `rows[2]/borderRadius` | 6 | 0 |

### plusMenuItems

| 字段 | Grok 真源 | 我方现状 |
|------|-----------|----------|
| `container/padding` | 0px 0px 0px 0px | 6 |
| `container/gap` | normal | 2 |
| `container/borderRadius` | 12 | 10 |
| `container/boxShadow` | none | rgba(0, 0, 0, 0.12) 0px 8px 24px 0px |
| `items[0]/left` | 310.5 | 303 |
| `items[0]/top` | 635.5 | 552.47 |
| `items[0]/width` | 188 | 196 |
| `items[0]/height` | 30 | 36.84 |
| `items[0]/padding` | 6px 8px | 9px 12px |
| `items[0]/color` | rgb(28, 28, 28) | rgb(26, 26, 26) |
| `items[0]/borderRadius` | 6 | 8 |
| `items[1]/left` | 310.5 | 303 |
| `items[1]/top` | 667.5 | 591.31 |
| `items[1]/width` | 188 | 196 |
| `items[1]/height` | 30 | 36.84 |
| `items[1]/padding` | 6px 8px | 9px 12px |
| `items[1]/color` | rgb(28, 28, 28) | rgb(111, 111, 111) |
| `items[1]/borderRadius` | 6 | 8 |

### 仅真源存在（我方结构缺件，需产品裁决是否补）

- `windowShell/gap`
- `windowShell/bodyBackground`
- `sidebar/margin`
- `sidebar/gap`
- `sidebarHeader/margin`
- `sidebarHeader/fontFamily`
- `avatar/disc/left`
- `avatar/disc/top`
- `avatar/disc/width`
- `avatar/disc/height`
- `avatar/disc/borderRadius`
- `avatar/disc/backgroundColor`
- `composer/dock/margin`
- `attachButton/borderTopColor`
- `trailingButtonsEmpty[0]/left`
- `trailingButtonsEmpty[0]/top`
- `trailingButtonsEmpty[0]/width`
- `trailingButtonsEmpty[0]/height`
- `trailingButtonsEmpty[0]/borderRadius`
- `trailingButtonsEmpty[0]/backgroundColor`
- `trailingButtonsEmpty[0]/color`
- `trailingButtonsEmpty[0]/boxShadow`
- `trailingButtonsEmpty[0]/opacity`
- `trailingButtonsEmpty[0]/visibility`
- `trailingButtonsEmpty[1]/left`
- `trailingButtonsEmpty[1]/top`
- `trailingButtonsEmpty[1]/width`
- `trailingButtonsEmpty[1]/height`
- `trailingButtonsEmpty[1]/borderRadius`
- `trailingButtonsEmpty[1]/backgroundColor`
- `trailingButtonsEmpty[1]/color`
- `trailingButtonsEmpty[1]/boxShadow`
- `trailingButtonsEmpty[1]/opacity`
- `trailingButtonsEmpty[1]/visibility`
- `bubble/gap`
- `bubble/letterSpacing`
- `bubble/opacity`
- `bubbleText/left`
- `bubbleText/top`
- `bubbleText/width`
- `bubbleText/height`
- `bubbleText/fontSize`
- `bubbleText/lineHeight`
- `bubbleText/color`
- `bubbleText/fontWeight`
- `bubbleText/letterSpacing`
- `messageColumn/row/gap`
- `messageColumn/maxWidthRule`
- `accountBar/margin`
- `accountBar/connectAppsButton/left`
- `accountBar/connectAppsButton/top`
- `accountBar/connectAppsButton/width`
- `accountBar/connectAppsButton/height`
- `accountBar/connectAppsButton/backgroundColor`
- `accountBar/connectAppsButton/borderRadius`
- `accountBar/connectAppsButton/fontSize`
- `accountBar/connectAppsButton/color`
- `accountBar/connectAppsButton/gap`
- `chatHeader/left`
- `chatHeader/top`
- `chatHeader/width`
- `chatHeader/height`
- `chatHeader/backgroundColor`
- `chatHeader/borderRadius`
- `chatHeader/fontSize`
- `chatHeader/fontWeight`
- `chatHeader/color`
- `chatHeader/padding`
- `chatHeader/borderTopWidth`
- `chatHeader/borderTopColor`
- `chatHeader/boxShadow`
- `toolbar/left`
- `toolbar/top`
- `toolbar/width`
- `toolbar/height`
- `toolbar/padding`
- `toolbar/margin`
- `toolbar/gap`
- `toolbar/backgroundColor`
- `toolbar/borderBottomWidth`
- `toolbar/borderBottomColor`
- `toolbar/boxShadow`
- `tokens/cssVars/--sand-bg-green-bright`
- `tokens/cssVars/--sand-bg-primary`
- `tokens/cssVars/--sand-bg-secondary`
- `tokens/cssVars/--sand-text-primary`
- `tokens/cssVars/--sand-text-secondary`
- `tokens/cssVars/--sand-bg-tertiary`
- `tokens/unreadDot/left`
- `tokens/unreadDot/top`
- `tokens/unreadDot/width`
- `tokens/unreadDot/height`
- `tokens/unreadDot/color`
- `tokens/rowTextPrimary`
- `tokens/previewText`
- `tokens/separator`
- `sendButton/allTrailingWhileTyping[0]/left`
- `sendButton/allTrailingWhileTyping[0]/top`
- `sendButton/allTrailingWhileTyping[0]/width`
- `sendButton/allTrailingWhileTyping[0]/height`
- `sendButton/allTrailingWhileTyping[0]/opacity`
- `sendButton/allTrailingWhileTyping[0]/visibility`
- `sendButton/allTrailingWhileTyping[0]/display`
- `sendButton/allTrailingWhileTyping[0]/backgroundColor`
- `sendButton/allTrailingWhileTyping[0]/color`
- `sendButton/allTrailingWhileTyping[0]/borderRadius`
- `sendButton/allTrailingWhileTyping[0]/boxShadow`
- `sendButton/allTrailingWhileTyping[1]/left`
- `sendButton/allTrailingWhileTyping[1]/top`
- `sendButton/allTrailingWhileTyping[1]/width`
- `sendButton/allTrailingWhileTyping[1]/height`
- `sendButton/allTrailingWhileTyping[1]/opacity`
- `sendButton/allTrailingWhileTyping[1]/visibility`
- `sendButton/allTrailingWhileTyping[1]/display`
- `sendButton/allTrailingWhileTyping[1]/backgroundColor`
- `sendButton/allTrailingWhileTyping[1]/color`
- `sendButton/allTrailingWhileTyping[1]/borderRadius`
- `sendButton/allTrailingWhileTyping[1]/boxShadow`
- `meta/viewport/dpr`
- `accountPopup/label`
- `accountPopup/container/left`
- `accountPopup/container/top`
- `accountPopup/container/width`
- `accountPopup/container/height`
- `accountPopup/container/padding`
- `accountPopup/container/margin`
- `accountPopup/container/gap`
- `accountPopup/container/backgroundColor`
- `accountPopup/container/borderRadius`
- `accountPopup/container/boxShadow`
- `accountPopup/container/zIndex`
- `accountPopup/container/position`
- `accountPopup/container/opacity`
- `accountPopup/container/transform`
- `accountPopup/container/fontFamily`
- `accountPopup/container/fontSize`
- `accountPopup/container/fontWeight`
- `accountPopup/container/color`
- `accountPopup/container/transition`
- `accountPopup/container/borderTopWidth`
- `accountPopup/container/borderTopColor`
- `accountPopup/container/borderTopStyle`
- `accountPopup/container/borderRightWidth`
- `accountPopup/container/borderRightColor`
- `accountPopup/container/borderBottomWidth`
- `accountPopup/container/borderBottomColor`
- `accountPopup/container/borderBottomStyle`
- `accountPopup/container/borderLeftWidth`
- `accountPopup/container/borderLeftColor`
- `accountPopup/list/left`
- `accountPopup/list/top`
- `accountPopup/list/width`
- `accountPopup/list/height`
- `accountPopup/list/padding`
- `accountPopup/list/margin`
- `accountPopup/list/gap`
- `accountPopup/sectionCount`
- `accountPopup/sections[0]/index`
- `accountPopup/sections[0]/left`
- `accountPopup/sections[0]/top`
- `accountPopup/sections[0]/width`
- `accountPopup/sections[0]/height`
- `accountPopup/sections[0]/padding`
- `accountPopup/sections[0]/margin`
- `accountPopup/sections[0]/gap`
- `accountPopup/sections[0]/nextIsSection`
- `accountPopup/sections[0]/sepBefore`
- `accountPopup/sections[0]/sepAfter`
- `accountPopup/sections[1]/index`
- `accountPopup/sections[1]/left`
- `accountPopup/sections[1]/top`
- `accountPopup/sections[1]/width`
- `accountPopup/sections[1]/height`
- `accountPopup/sections[1]/padding`
- `accountPopup/sections[1]/margin`
- `accountPopup/sections[1]/gap`
- `accountPopup/sections[1]/nextIsSection`
- `accountPopup/sections[1]/sepBefore/via`
- `accountPopup/sections[1]/sepBefore/content`
- `accountPopup/sections[1]/sepBefore/height`
- `accountPopup/sections[1]/sepBefore/width`
- `accountPopup/sections[1]/sepBefore/bg`
- `accountPopup/sections[1]/sepBefore/border`
- `accountPopup/sections[1]/sepBefore/margin`
- `accountPopup/sections[1]/sepAfter`
- `accountPopup/separators[0]/via`
- `accountPopup/separators[0]/content`
- `accountPopup/separators[0]/width`
- `accountPopup/separators[0]/bg`
- `accountPopup/separators[0]/border`
- `accountPopup/separators[0]/sectionIndex`
- `accountPopup/itemCount`
- `accountPopup/items[0]/component`
- `accountPopup/items[0]/hasSubmenuArrow`
- `accountPopup/items[0]/expanded`
- `accountPopup/items[0]/disabled`
- `accountPopup/items[0]/href`
- `accountPopup/items[0]/margin`
- `accountPopup/items[0]/gap`
- `accountPopup/items[0]/lineHeight`
- `accountPopup/items[0]/icons[0]/name`
- `accountPopup/items[0]/icons[0]/sizeAttr`
- `accountPopup/items[0]/icons[0]/left`
- `accountPopup/items[0]/icons[0]/top`
- `accountPopup/items[0]/icons[0]/width`
- `accountPopup/items[0]/icons[0]/height`
- `accountPopup/items[0]/icons[0]/color`
- `accountPopup/items[0]/icons[0]/fontSize`
- `accountPopup/items[0]/icons[1]/name`
- `accountPopup/items[0]/icons[1]/sizeAttr`
- `accountPopup/items[0]/icons[1]/left`
- `accountPopup/items[0]/icons[1]/top`
- `accountPopup/items[0]/icons[1]/width`
- `accountPopup/items[0]/icons[1]/height`
- `accountPopup/items[0]/icons[1]/color`
- `accountPopup/items[0]/icons[1]/fontSize`
- `accountPopup/items[0]/labelEl/left`
- `accountPopup/items[0]/labelEl/top`
- `accountPopup/items[0]/labelEl/width`
- `accountPopup/items[0]/labelEl/height`
- `accountPopup/items[0]/labelEl/fontSize`
- `accountPopup/items[0]/labelEl/fontWeight`
- `accountPopup/items[0]/labelEl/color`
- `accountPopup/items[0]/labelEl/lineHeight`
- `accountPopup/items[0]/leafTexts[0]`
- `accountPopup/items[0]/leafTexts[1]`
- `accountPopup/items[0]/subtext[0]`
- `accountPopup/items[1]/component`
- `accountPopup/items[1]/hasSubmenuArrow`
- `accountPopup/items[1]/expanded`
- `accountPopup/items[1]/disabled`
- `accountPopup/items[1]/href`
- `accountPopup/items[1]/margin`
- `accountPopup/items[1]/gap`
- `accountPopup/items[1]/lineHeight`
- `accountPopup/items[1]/icons[0]/name`
- `accountPopup/items[1]/icons[0]/sizeAttr`
- `accountPopup/items[1]/icons[0]/left`
- `accountPopup/items[1]/icons[0]/top`
- `accountPopup/items[1]/icons[0]/width`
- `accountPopup/items[1]/icons[0]/height`
- `accountPopup/items[1]/icons[0]/color`
- `accountPopup/items[1]/icons[0]/fontSize`
- `accountPopup/items[1]/labelEl/left`
- `accountPopup/items[1]/labelEl/top`
- `accountPopup/items[1]/labelEl/width`
- `accountPopup/items[1]/labelEl/height`
- `accountPopup/items[1]/labelEl/fontSize`
- `accountPopup/items[1]/labelEl/fontWeight`
- `accountPopup/items[1]/labelEl/color`
- `accountPopup/items[1]/labelEl/lineHeight`
- `accountPopup/items[1]/leafTexts[0]`
- `accountPopup/items[2]/component`
- `accountPopup/items[2]/hasSubmenuArrow`
- `accountPopup/items[2]/expanded`
- `accountPopup/items[2]/disabled`
- `accountPopup/items[2]/href`
- `accountPopup/items[2]/margin`
- `accountPopup/items[2]/gap`
- `accountPopup/items[2]/lineHeight`
- `accountPopup/items[2]/icons[0]/name`
- `accountPopup/items[2]/icons[0]/sizeAttr`
- `accountPopup/items[2]/icons[0]/left`
- `accountPopup/items[2]/icons[0]/top`
- `accountPopup/items[2]/icons[0]/width`
- `accountPopup/items[2]/icons[0]/height`
- `accountPopup/items[2]/icons[0]/color`
- `accountPopup/items[2]/icons[0]/fontSize`
- `accountPopup/items[2]/icons[1]/name`
- `accountPopup/items[2]/icons[1]/sizeAttr`
- `accountPopup/items[2]/icons[1]/left`
- `accountPopup/items[2]/icons[1]/top`
- `accountPopup/items[2]/icons[1]/width`
- `accountPopup/items[2]/icons[1]/height`
- `accountPopup/items[2]/icons[1]/color`
- `accountPopup/items[2]/icons[1]/fontSize`
- `accountPopup/items[2]/labelEl/left`
- `accountPopup/items[2]/labelEl/top`
- `accountPopup/items[2]/labelEl/width`
- `accountPopup/items[2]/labelEl/height`
- `accountPopup/items[2]/labelEl/fontSize`
- `accountPopup/items[2]/labelEl/fontWeight`
- `accountPopup/items[2]/labelEl/color`
- `accountPopup/items[2]/labelEl/lineHeight`
- `accountPopup/items[2]/leafTexts[0]`
- `accountPopup/items[3]/component`
- `accountPopup/items[3]/hasSubmenuArrow`
- `accountPopup/items[3]/expanded`
- `accountPopup/items[3]/disabled`
- `accountPopup/items[3]/href`
- `accountPopup/items[3]/margin`
- `accountPopup/items[3]/gap`
- `accountPopup/items[3]/lineHeight`
- `accountPopup/items[3]/icons[0]/name`
- `accountPopup/items[3]/icons[0]/sizeAttr`
- `accountPopup/items[3]/icons[0]/left`
- `accountPopup/items[3]/icons[0]/top`
- `accountPopup/items[3]/icons[0]/width`
- `accountPopup/items[3]/icons[0]/height`
- `accountPopup/items[3]/icons[0]/color`
- `accountPopup/items[3]/icons[0]/fontSize`
- `accountPopup/items[3]/labelEl/left`
- `accountPopup/items[3]/labelEl/top`
- `accountPopup/items[3]/labelEl/width`
- `accountPopup/items[3]/labelEl/height`
- `accountPopup/items[3]/labelEl/fontSize`
- `accountPopup/items[3]/labelEl/fontWeight`
- `accountPopup/items[3]/labelEl/color`
- `accountPopup/items[3]/labelEl/lineHeight`
- `accountPopup/items[3]/leafTexts[0]`
- `accountPopup/items[4]/component`
- `accountPopup/items[4]/hasSubmenuArrow`
- `accountPopup/items[4]/expanded`
- `accountPopup/items[4]/disabled`
- `accountPopup/items[4]/href`
- `accountPopup/items[4]/margin`
- `accountPopup/items[4]/gap`
- `accountPopup/items[4]/lineHeight`
- `accountPopup/items[4]/icons[0]/name`
- `accountPopup/items[4]/icons[0]/sizeAttr`
- `accountPopup/items[4]/icons[0]/left`
- `accountPopup/items[4]/icons[0]/top`
- `accountPopup/items[4]/icons[0]/width`
- `accountPopup/items[4]/icons[0]/height`
- `accountPopup/items[4]/icons[0]/color`
- `accountPopup/items[4]/icons[0]/fontSize`
- `accountPopup/items[4]/labelEl/left`
- `accountPopup/items[4]/labelEl/top`
- `accountPopup/items[4]/labelEl/width`
- `accountPopup/items[4]/labelEl/height`
- `accountPopup/items[4]/labelEl/fontSize`
- `accountPopup/items[4]/labelEl/fontWeight`
- `accountPopup/items[4]/labelEl/color`
- `accountPopup/items[4]/labelEl/lineHeight`
- `accountPopup/items[4]/leafTexts[0]`
- `accountPopup/items[5]/component`
- `accountPopup/items[5]/hasSubmenuArrow`
- `accountPopup/items[5]/expanded`
- `accountPopup/items[5]/disabled`
- `accountPopup/items[5]/href`
- `accountPopup/items[5]/margin`
- `accountPopup/items[5]/gap`
- `accountPopup/items[5]/lineHeight`
- `accountPopup/items[5]/icons[0]/name`
- `accountPopup/items[5]/icons[0]/sizeAttr`
- `accountPopup/items[5]/icons[0]/left`
- `accountPopup/items[5]/icons[0]/top`
- `accountPopup/items[5]/icons[0]/width`
- `accountPopup/items[5]/icons[0]/height`
- `accountPopup/items[5]/icons[0]/color`
- `accountPopup/items[5]/icons[0]/fontSize`
- `accountPopup/items[5]/labelEl/left`
- `accountPopup/items[5]/labelEl/top`
- `accountPopup/items[5]/labelEl/width`
- `accountPopup/items[5]/labelEl/height`
- `accountPopup/items[5]/labelEl/fontSize`
- `accountPopup/items[5]/labelEl/fontWeight`
- `accountPopup/items[5]/labelEl/color`
- `accountPopup/items[5]/labelEl/lineHeight`
- `accountPopup/items[5]/leafTexts[0]`
- `accountPopup/rowHoverState/backgroundColor`
- `accountPopup/rowHoverState/color`
- `accountPopup/rowHoverState/transition`
- `accountPopup/submenus/每周用量/submenuAriaLabel`
- `accountPopup/submenus/每周用量/container/left`
- `accountPopup/submenus/每周用量/container/top`
- `accountPopup/submenus/每周用量/container/width`
- `accountPopup/submenus/每周用量/container/height`
- `accountPopup/submenus/每周用量/container/padding`
- `accountPopup/submenus/每周用量/container/margin`
- `accountPopup/submenus/每周用量/container/gap`
- `accountPopup/submenus/每周用量/container/backgroundColor`
- `accountPopup/submenus/每周用量/container/borderRadius`
- `accountPopup/submenus/每周用量/container/boxShadow`
- `accountPopup/submenus/每周用量/container/zIndex`
- `accountPopup/submenus/每周用量/container/position`
- `accountPopup/submenus/每周用量/container/opacity`
- `accountPopup/submenus/每周用量/container/transform`
- `accountPopup/submenus/每周用量/container/fontFamily`
- `accountPopup/submenus/每周用量/container/fontSize`
- `accountPopup/submenus/每周用量/container/fontWeight`
- `accountPopup/submenus/每周用量/container/color`
- `accountPopup/submenus/每周用量/container/transition`
- `accountPopup/submenus/每周用量/container/borderTopWidth`
- `accountPopup/submenus/每周用量/container/borderTopColor`
- `accountPopup/submenus/每周用量/container/borderTopStyle`
- `accountPopup/submenus/每周用量/container/borderRightWidth`
- `accountPopup/submenus/每周用量/container/borderRightColor`
- `accountPopup/submenus/每周用量/container/borderBottomWidth`
- `accountPopup/submenus/每周用量/container/borderBottomColor`
- `accountPopup/submenus/每周用量/container/borderBottomStyle`
- `accountPopup/submenus/每周用量/container/borderLeftWidth`
- `accountPopup/submenus/每周用量/container/borderLeftColor`
- `accountPopup/submenus/每周用量/sections[0]/index`
- `accountPopup/submenus/每周用量/sections[0]/left`
- `accountPopup/submenus/每周用量/sections[0]/top`
- `accountPopup/submenus/每周用量/sections[0]/width`
- `accountPopup/submenus/每周用量/sections[0]/height`
- `accountPopup/submenus/每周用量/sections[0]/padding`
- `accountPopup/submenus/每周用量/sections[0]/margin`
- `accountPopup/submenus/每周用量/sections[0]/gap`
- `accountPopup/submenus/每周用量/sections[0]/nextIsSection`
- `accountPopup/submenus/每周用量/sections[0]/sepBefore`
- `accountPopup/submenus/每周用量/sections[0]/sepAfter`
- `accountPopup/submenus/每周用量/sections[1]/index`
- `accountPopup/submenus/每周用量/sections[1]/left`
- `accountPopup/submenus/每周用量/sections[1]/top`
- `accountPopup/submenus/每周用量/sections[1]/width`
- `accountPopup/submenus/每周用量/sections[1]/height`
- `accountPopup/submenus/每周用量/sections[1]/padding`
- `accountPopup/submenus/每周用量/sections[1]/margin`
- `accountPopup/submenus/每周用量/sections[1]/gap`
- `accountPopup/submenus/每周用量/sections[1]/nextIsSection`
- `accountPopup/submenus/每周用量/sections[1]/sepBefore/via`
- `accountPopup/submenus/每周用量/sections[1]/sepBefore/content`
- `accountPopup/submenus/每周用量/sections[1]/sepBefore/height`
- `accountPopup/submenus/每周用量/sections[1]/sepBefore/width`
- `accountPopup/submenus/每周用量/sections[1]/sepBefore/bg`
- `accountPopup/submenus/每周用量/sections[1]/sepBefore/border`
- `accountPopup/submenus/每周用量/sections[1]/sepBefore/margin`
- `accountPopup/submenus/每周用量/sections[1]/sepAfter`
- `accountPopup/submenus/每周用量/separators[0]/via`
- `accountPopup/submenus/每周用量/separators[0]/content`
- `accountPopup/submenus/每周用量/separators[0]/height`
- `accountPopup/submenus/每周用量/separators[0]/width`
- `accountPopup/submenus/每周用量/separators[0]/bg`
- `accountPopup/submenus/每周用量/separators[0]/border`
- `accountPopup/submenus/每周用量/separators[0]/margin`
- `accountPopup/submenus/每周用量/separators[0]/sectionIndex`
- `accountPopup/submenus/每周用量/itemCount`
- `accountPopup/submenus/每周用量/items[0]/component`
- `accountPopup/submenus/每周用量/items[0]/hasSubmenuArrow`
- `accountPopup/submenus/每周用量/items[0]/expanded`
- `accountPopup/submenus/每周用量/items[0]/disabled`
- `accountPopup/submenus/每周用量/items[0]/href`
- `accountPopup/submenus/每周用量/items[0]/left`
- `accountPopup/submenus/每周用量/items[0]/top`
- `accountPopup/submenus/每周用量/items[0]/width`
- `accountPopup/submenus/每周用量/items[0]/height`
- `accountPopup/submenus/每周用量/items[0]/padding`
- `accountPopup/submenus/每周用量/items[0]/margin`
- `accountPopup/submenus/每周用量/items[0]/gap`
- `accountPopup/submenus/每周用量/items[0]/backgroundColor`
- `accountPopup/submenus/每周用量/items[0]/color`
- `accountPopup/submenus/每周用量/items[0]/borderRadius`
- `accountPopup/submenus/每周用量/items[0]/fontSize`
- `accountPopup/submenus/每周用量/items[0]/fontWeight`
- `accountPopup/submenus/每周用量/items[0]/lineHeight`
- `accountPopup/submenus/每周用量/items[0]/labelEl/left`
- `accountPopup/submenus/每周用量/items[0]/labelEl/top`
- `accountPopup/submenus/每周用量/items[0]/labelEl/width`
- `accountPopup/submenus/每周用量/items[0]/labelEl/height`
- `accountPopup/submenus/每周用量/items[0]/labelEl/fontSize`
- `accountPopup/submenus/每周用量/items[0]/labelEl/fontWeight`
- `accountPopup/submenus/每周用量/items[0]/labelEl/color`
- `accountPopup/submenus/每周用量/items[0]/labelEl/lineHeight`
- `accountPopup/submenus/每周用量/items[0]/leafTexts[0]`
- `accountPopup/submenus/每周用量/items[0]/leafTexts[1]`
- `accountPopup/submenus/每周用量/items[0]/leafTexts[2]`
- `accountPopup/submenus/每周用量/items[0]/subtext[0]`
- `accountPopup/submenus/每周用量/items[0]/subtext[1]`
- `accountPopup/submenus/每周用量/items[1]/component`
- `accountPopup/submenus/每周用量/items[1]/hasSubmenuArrow`
- `accountPopup/submenus/每周用量/items[1]/expanded`
- `accountPopup/submenus/每周用量/items[1]/disabled`
- `accountPopup/submenus/每周用量/items[1]/href`
- `accountPopup/submenus/每周用量/items[1]/left`
- `accountPopup/submenus/每周用量/items[1]/top`
- `accountPopup/submenus/每周用量/items[1]/width`
- `accountPopup/submenus/每周用量/items[1]/height`
- `accountPopup/submenus/每周用量/items[1]/padding`
- `accountPopup/submenus/每周用量/items[1]/margin`
- `accountPopup/submenus/每周用量/items[1]/gap`
- `accountPopup/submenus/每周用量/items[1]/backgroundColor`
- `accountPopup/submenus/每周用量/items[1]/color`
- `accountPopup/submenus/每周用量/items[1]/borderRadius`
- `accountPopup/submenus/每周用量/items[1]/fontSize`
- `accountPopup/submenus/每周用量/items[1]/fontWeight`
- `accountPopup/submenus/每周用量/items[1]/lineHeight`
- `accountPopup/submenus/每周用量/items[1]/labelEl/left`
- `accountPopup/submenus/每周用量/items[1]/labelEl/top`
- `accountPopup/submenus/每周用量/items[1]/labelEl/width`
- `accountPopup/submenus/每周用量/items[1]/labelEl/height`
- `accountPopup/submenus/每周用量/items[1]/labelEl/fontSize`
- `accountPopup/submenus/每周用量/items[1]/labelEl/fontWeight`
- `accountPopup/submenus/每周用量/items[1]/labelEl/color`
- `accountPopup/submenus/每周用量/items[1]/labelEl/lineHeight`
- `accountPopup/submenus/每周用量/items[1]/leafTexts[0]`
- `accountPopup/submenus/支持/submenuAriaLabel`
- `accountPopup/submenus/支持/container/left`
- `accountPopup/submenus/支持/container/top`
- `accountPopup/submenus/支持/container/width`
- `accountPopup/submenus/支持/container/height`
- `accountPopup/submenus/支持/container/padding`
- `accountPopup/submenus/支持/container/margin`
- `accountPopup/submenus/支持/container/gap`
- `accountPopup/submenus/支持/container/backgroundColor`
- `accountPopup/submenus/支持/container/borderRadius`
- `accountPopup/submenus/支持/container/boxShadow`
- `accountPopup/submenus/支持/container/zIndex`
- `accountPopup/submenus/支持/container/position`
- `accountPopup/submenus/支持/container/opacity`
- `accountPopup/submenus/支持/container/transform`
- `accountPopup/submenus/支持/container/fontFamily`
- `accountPopup/submenus/支持/container/fontSize`
- `accountPopup/submenus/支持/container/fontWeight`
- `accountPopup/submenus/支持/container/color`
- `accountPopup/submenus/支持/container/transition`
- `accountPopup/submenus/支持/container/borderTopWidth`
- `accountPopup/submenus/支持/container/borderTopColor`
- `accountPopup/submenus/支持/container/borderTopStyle`
- `accountPopup/submenus/支持/container/borderRightWidth`
- `accountPopup/submenus/支持/container/borderRightColor`
- `accountPopup/submenus/支持/container/borderBottomWidth`
- `accountPopup/submenus/支持/container/borderBottomColor`
- `accountPopup/submenus/支持/container/borderBottomStyle`
- `accountPopup/submenus/支持/container/borderLeftWidth`
- `accountPopup/submenus/支持/container/borderLeftColor`
- `accountPopup/submenus/支持/sections[0]/index`
- `accountPopup/submenus/支持/sections[0]/left`
- `accountPopup/submenus/支持/sections[0]/top`
- `accountPopup/submenus/支持/sections[0]/width`
- `accountPopup/submenus/支持/sections[0]/height`
- `accountPopup/submenus/支持/sections[0]/padding`
- `accountPopup/submenus/支持/sections[0]/margin`
- `accountPopup/submenus/支持/sections[0]/gap`
- `accountPopup/submenus/支持/sections[0]/nextIsSection`
- `accountPopup/submenus/支持/sections[0]/sepBefore`
- `accountPopup/submenus/支持/sections[0]/sepAfter`
- `accountPopup/submenus/支持/itemCount`
- `accountPopup/submenus/支持/items[0]/component`
- `accountPopup/submenus/支持/items[0]/hasSubmenuArrow`
- `accountPopup/submenus/支持/items[0]/expanded`
- `accountPopup/submenus/支持/items[0]/disabled`
- `accountPopup/submenus/支持/items[0]/href`
- `accountPopup/submenus/支持/items[0]/left`
- `accountPopup/submenus/支持/items[0]/top`
- `accountPopup/submenus/支持/items[0]/width`
- `accountPopup/submenus/支持/items[0]/height`
- `accountPopup/submenus/支持/items[0]/padding`
- `accountPopup/submenus/支持/items[0]/margin`
- `accountPopup/submenus/支持/items[0]/gap`
- `accountPopup/submenus/支持/items[0]/backgroundColor`
- `accountPopup/submenus/支持/items[0]/color`
- `accountPopup/submenus/支持/items[0]/borderRadius`
- `accountPopup/submenus/支持/items[0]/fontSize`
- `accountPopup/submenus/支持/items[0]/fontWeight`
- `accountPopup/submenus/支持/items[0]/lineHeight`
- `accountPopup/submenus/支持/items[0]/icons[0]/name`
- `accountPopup/submenus/支持/items[0]/icons[0]/sizeAttr`
- `accountPopup/submenus/支持/items[0]/icons[0]/left`
- `accountPopup/submenus/支持/items[0]/icons[0]/top`
- `accountPopup/submenus/支持/items[0]/icons[0]/width`
- `accountPopup/submenus/支持/items[0]/icons[0]/height`
- `accountPopup/submenus/支持/items[0]/icons[0]/color`
- `accountPopup/submenus/支持/items[0]/icons[0]/fontSize`
- `accountPopup/submenus/支持/items[0]/labelEl/left`
- `accountPopup/submenus/支持/items[0]/labelEl/top`
- `accountPopup/submenus/支持/items[0]/labelEl/width`
- `accountPopup/submenus/支持/items[0]/labelEl/height`
- `accountPopup/submenus/支持/items[0]/labelEl/fontSize`
- `accountPopup/submenus/支持/items[0]/labelEl/fontWeight`
- `accountPopup/submenus/支持/items[0]/labelEl/color`
- `accountPopup/submenus/支持/items[0]/labelEl/lineHeight`
- `accountPopup/submenus/支持/items[0]/leafTexts[0]`
- `accountPopup/submenus/支持/items[1]/component`
- `accountPopup/submenus/支持/items[1]/hasSubmenuArrow`
- `accountPopup/submenus/支持/items[1]/expanded`
- `accountPopup/submenus/支持/items[1]/disabled`
- `accountPopup/submenus/支持/items[1]/href`
- `accountPopup/submenus/支持/items[1]/left`
- `accountPopup/submenus/支持/items[1]/top`
- `accountPopup/submenus/支持/items[1]/width`
- `accountPopup/submenus/支持/items[1]/height`
- `accountPopup/submenus/支持/items[1]/padding`
- `accountPopup/submenus/支持/items[1]/margin`
- `accountPopup/submenus/支持/items[1]/gap`
- `accountPopup/submenus/支持/items[1]/backgroundColor`
- `accountPopup/submenus/支持/items[1]/color`
- `accountPopup/submenus/支持/items[1]/borderRadius`
- `accountPopup/submenus/支持/items[1]/fontSize`
- `accountPopup/submenus/支持/items[1]/fontWeight`
- `accountPopup/submenus/支持/items[1]/lineHeight`
- `accountPopup/submenus/支持/items[1]/icons[0]/name`
- `accountPopup/submenus/支持/items[1]/icons[0]/sizeAttr`
- `accountPopup/submenus/支持/items[1]/icons[0]/left`
- `accountPopup/submenus/支持/items[1]/icons[0]/top`
- `accountPopup/submenus/支持/items[1]/icons[0]/width`
- `accountPopup/submenus/支持/items[1]/icons[0]/height`
- `accountPopup/submenus/支持/items[1]/icons[0]/color`
- `accountPopup/submenus/支持/items[1]/icons[0]/fontSize`
- `accountPopup/submenus/支持/items[1]/labelEl/left`
- `accountPopup/submenus/支持/items[1]/labelEl/top`
- `accountPopup/submenus/支持/items[1]/labelEl/width`
- `accountPopup/submenus/支持/items[1]/labelEl/height`
- `accountPopup/submenus/支持/items[1]/labelEl/fontSize`
- `accountPopup/submenus/支持/items[1]/labelEl/fontWeight`
- `accountPopup/submenus/支持/items[1]/labelEl/color`
- `accountPopup/submenus/支持/items[1]/labelEl/lineHeight`
- `accountPopup/submenus/支持/items[1]/leafTexts[0]`
- `accountPopup/submenus/支持/items[2]/component`
- `accountPopup/submenus/支持/items[2]/hasSubmenuArrow`
- `accountPopup/submenus/支持/items[2]/expanded`
- `accountPopup/submenus/支持/items[2]/disabled`
- `accountPopup/submenus/支持/items[2]/href`
- `accountPopup/submenus/支持/items[2]/left`
- `accountPopup/submenus/支持/items[2]/top`
- `accountPopup/submenus/支持/items[2]/width`
- `accountPopup/submenus/支持/items[2]/height`
- `accountPopup/submenus/支持/items[2]/padding`
- `accountPopup/submenus/支持/items[2]/margin`
- `accountPopup/submenus/支持/items[2]/gap`
- `accountPopup/submenus/支持/items[2]/backgroundColor`
- `accountPopup/submenus/支持/items[2]/color`
- `accountPopup/submenus/支持/items[2]/borderRadius`
- `accountPopup/submenus/支持/items[2]/fontSize`
- `accountPopup/submenus/支持/items[2]/fontWeight`
- `accountPopup/submenus/支持/items[2]/lineHeight`
- `accountPopup/submenus/支持/items[2]/icons[0]/name`
- `accountPopup/submenus/支持/items[2]/icons[0]/sizeAttr`
- `accountPopup/submenus/支持/items[2]/icons[0]/left`
- `accountPopup/submenus/支持/items[2]/icons[0]/top`
- `accountPopup/submenus/支持/items[2]/icons[0]/width`
- `accountPopup/submenus/支持/items[2]/icons[0]/height`
- `accountPopup/submenus/支持/items[2]/icons[0]/color`
- `accountPopup/submenus/支持/items[2]/icons[0]/fontSize`
- `accountPopup/submenus/支持/items[2]/labelEl/left`
- `accountPopup/submenus/支持/items[2]/labelEl/top`
- `accountPopup/submenus/支持/items[2]/labelEl/width`
- `accountPopup/submenus/支持/items[2]/labelEl/height`
- `accountPopup/submenus/支持/items[2]/labelEl/fontSize`
- `accountPopup/submenus/支持/items[2]/labelEl/fontWeight`
- `accountPopup/submenus/支持/items[2]/labelEl/color`
- `accountPopup/submenus/支持/items[2]/labelEl/lineHeight`
- `accountPopup/submenus/支持/items[2]/leafTexts[0]`
- `accountPopup/submenus/支持/items[3]/component`
- `accountPopup/submenus/支持/items[3]/hasSubmenuArrow`
- `accountPopup/submenus/支持/items[3]/expanded`
- `accountPopup/submenus/支持/items[3]/disabled`
- `accountPopup/submenus/支持/items[3]/href`
- `accountPopup/submenus/支持/items[3]/left`
- `accountPopup/submenus/支持/items[3]/top`
- `accountPopup/submenus/支持/items[3]/width`
- `accountPopup/submenus/支持/items[3]/height`
- `accountPopup/submenus/支持/items[3]/padding`
- `accountPopup/submenus/支持/items[3]/margin`
- `accountPopup/submenus/支持/items[3]/gap`
- `accountPopup/submenus/支持/items[3]/backgroundColor`
- `accountPopup/submenus/支持/items[3]/color`
- `accountPopup/submenus/支持/items[3]/borderRadius`
- `accountPopup/submenus/支持/items[3]/fontSize`
- `accountPopup/submenus/支持/items[3]/fontWeight`
- `accountPopup/submenus/支持/items[3]/lineHeight`
- `accountPopup/submenus/支持/items[3]/icons[0]/name`
- `accountPopup/submenus/支持/items[3]/icons[0]/sizeAttr`
- `accountPopup/submenus/支持/items[3]/icons[0]/left`
- `accountPopup/submenus/支持/items[3]/icons[0]/top`
- `accountPopup/submenus/支持/items[3]/icons[0]/width`
- `accountPopup/submenus/支持/items[3]/icons[0]/height`
- `accountPopup/submenus/支持/items[3]/icons[0]/color`
- `accountPopup/submenus/支持/items[3]/icons[0]/fontSize`
- `accountPopup/submenus/支持/items[3]/labelEl/left`
- `accountPopup/submenus/支持/items[3]/labelEl/top`
- `accountPopup/submenus/支持/items[3]/labelEl/width`
- `accountPopup/submenus/支持/items[3]/labelEl/height`
- `accountPopup/submenus/支持/items[3]/labelEl/fontSize`
- `accountPopup/submenus/支持/items[3]/labelEl/fontWeight`
- `accountPopup/submenus/支持/items[3]/labelEl/color`
- `accountPopup/submenus/支持/items[3]/labelEl/lineHeight`
- `accountPopup/submenus/支持/items[3]/leafTexts[0]`
- `accountPopup/notClicked[0]`
- `accountPopup/notClicked[1]`
- `accountPopup/notClicked[2]`
- `accountPopup/notClicked[3]`
- `accountPopup/extendedCapturedAt`
- `connectAppsPanel/container/margin`
- `connectAppsPanel/container/gap`
- `connectAppsPanel/title/tag`
- `connectAppsPanel/searchBox/placeholder`
- `connectAppsPanel/installedPreview/left`
- `connectAppsPanel/installedPreview/top`
- `connectAppsPanel/installedPreview/width`
- `connectAppsPanel/installedPreview/height`
- `connectAppsPanel/installedPreview/backgroundColor`
- `connectAppsPanel/installedPreview/color`
- `connectAppsPanel/installedPreview/borderRadius`
- `connectAppsPanel/installedPreview/fontSize`
- `connectAppsPanel/installedPreview/fontWeight`
- `connectAppsPanel/installedPreview/boxShadow`
- `connectAppsPanel/installedPreview/borderTopWidth`
- `connectAppsPanel/installedPreview/borderTopColor`
- `connectAppsPanel/botTemplate/left`
- `connectAppsPanel/botTemplate/top`
- `connectAppsPanel/botTemplate/width`
- `connectAppsPanel/botTemplate/height`
- `connectAppsPanel/botTemplate/backgroundColor`
- `connectAppsPanel/botTemplate/color`
- `connectAppsPanel/botTemplate/borderRadius`
- `connectAppsPanel/botTemplate/fontSize`
- `connectAppsPanel/botTemplate/fontWeight`
- `connectAppsPanel/botTemplate/boxShadow`
- `connectAppsPanel/botTemplate/borderTopWidth`
- `connectAppsPanel/botTemplate/borderTopColor`
- `connectAppsPanel/chips[6]/left`
- `connectAppsPanel/chips[6]/top`
- `connectAppsPanel/chips[6]/width`
- `connectAppsPanel/chips[6]/height`
- `connectAppsPanel/chips[6]/backgroundColor`
- `connectAppsPanel/chips[6]/color`
- `connectAppsPanel/chips[6]/borderRadius`
- `connectAppsPanel/chips[6]/fontSize`
- `connectAppsPanel/chips[6]/fontWeight`
- `connectAppsPanel/chips[6]/boxShadow`
- `connectAppsPanel/chips[6]/borderTopWidth`
- `connectAppsPanel/chips[6]/borderTopColor`
- `connectAppsPanel/chips[6]/active`
- `connectAppsPanel/headings[0]/left`
- `connectAppsPanel/headings[0]/top`
- `connectAppsPanel/headings[0]/width`
- `connectAppsPanel/headings[0]/height`
- `connectAppsPanel/headings[0]/fontSize`
- `connectAppsPanel/headings[0]/fontWeight`
- `connectAppsPanel/headings[0]/color`
- `connectAppsPanel/headings[1]/left`
- `connectAppsPanel/headings[1]/top`
- `connectAppsPanel/headings[1]/width`
- `connectAppsPanel/headings[1]/height`
- `connectAppsPanel/headings[1]/fontSize`
- `connectAppsPanel/headings[1]/fontWeight`
- `connectAppsPanel/headings[1]/color`
- `connectAppsPanel/headings[2]/left`
- `connectAppsPanel/headings[2]/top`
- `connectAppsPanel/headings[2]/width`
- `connectAppsPanel/headings[2]/height`
- `connectAppsPanel/headings[2]/fontSize`
- `connectAppsPanel/headings[2]/fontWeight`
- `connectAppsPanel/headings[2]/color`
- `connectAppsPanel/headings[3]/left`
- `connectAppsPanel/headings[3]/top`
- `connectAppsPanel/headings[3]/width`
- `connectAppsPanel/headings[3]/height`
- `connectAppsPanel/headings[3]/fontSize`
- `connectAppsPanel/headings[3]/fontWeight`
- `connectAppsPanel/headings[3]/color`
- `connectAppsPanel/headings[4]/left`
- `connectAppsPanel/headings[4]/top`
- `connectAppsPanel/headings[4]/width`
- `connectAppsPanel/headings[4]/height`
- `connectAppsPanel/headings[4]/fontSize`
- `connectAppsPanel/headings[4]/fontWeight`
- `connectAppsPanel/headings[4]/color`
- `connectAppsPanel/headings[5]/left`
- `connectAppsPanel/headings[5]/top`
- `connectAppsPanel/headings[5]/width`
- `connectAppsPanel/headings[5]/height`
- `connectAppsPanel/headings[5]/fontSize`
- `connectAppsPanel/headings[5]/fontWeight`
- `connectAppsPanel/headings[5]/color`
- `connectAppsPanel/headings[6]/left`
- `connectAppsPanel/headings[6]/top`
- `connectAppsPanel/headings[6]/width`
- `connectAppsPanel/headings[6]/height`
- `connectAppsPanel/headings[6]/fontSize`
- `connectAppsPanel/headings[6]/fontWeight`
- `connectAppsPanel/headings[6]/color`
- `connectAppsPanel/headings[7]/left`
- `connectAppsPanel/headings[7]/top`
- `connectAppsPanel/headings[7]/width`
- `connectAppsPanel/headings[7]/height`
- `connectAppsPanel/headings[7]/fontSize`
- `connectAppsPanel/headings[7]/fontWeight`
- `connectAppsPanel/headings[7]/color`
- `connectAppsPanel/headings[8]/left`
- `connectAppsPanel/headings[8]/top`
- `connectAppsPanel/headings[8]/width`
- `connectAppsPanel/headings[8]/height`
- `connectAppsPanel/headings[8]/fontSize`
- `connectAppsPanel/headings[8]/fontWeight`
- `connectAppsPanel/headings[8]/color`
- `connectAppsPanel/headings[9]/left`
- `connectAppsPanel/headings[9]/top`
- `connectAppsPanel/headings[9]/width`
- `connectAppsPanel/headings[9]/height`
- `connectAppsPanel/headings[9]/fontSize`
- `connectAppsPanel/headings[9]/fontWeight`
- `connectAppsPanel/headings[9]/color`
- `connectAppsPanel/headings[10]/left`
- `connectAppsPanel/headings[10]/top`
- `connectAppsPanel/headings[10]/width`
- `connectAppsPanel/headings[10]/height`
- `connectAppsPanel/headings[10]/fontSize`
- `connectAppsPanel/headings[10]/fontWeight`
- `connectAppsPanel/headings[10]/color`
- `connectAppsPanel/headings[11]/left`
- `connectAppsPanel/headings[11]/top`
- `connectAppsPanel/headings[11]/width`
- `connectAppsPanel/headings[11]/height`
- `connectAppsPanel/headings[11]/fontSize`
- `connectAppsPanel/headings[11]/fontWeight`
- `connectAppsPanel/headings[11]/color`
- `connectAppsPanel/headings[12]/left`
- `connectAppsPanel/headings[12]/top`
- `connectAppsPanel/headings[12]/width`
- `connectAppsPanel/headings[12]/height`
- `connectAppsPanel/headings[12]/fontSize`
- `connectAppsPanel/headings[12]/fontWeight`
- `connectAppsPanel/headings[12]/color`
- `connectAppsPanel/viewAll[0]/left`
- `connectAppsPanel/viewAll[0]/top`
- `connectAppsPanel/viewAll[0]/width`
- `connectAppsPanel/viewAll[0]/height`
- `connectAppsPanel/viewAll[0]/backgroundColor`
- `connectAppsPanel/viewAll[0]/color`
- `connectAppsPanel/viewAll[0]/borderRadius`
- `connectAppsPanel/viewAll[0]/fontSize`
- `connectAppsPanel/viewAll[0]/fontWeight`
- `connectAppsPanel/viewAll[0]/boxShadow`
- `connectAppsPanel/viewAll[0]/borderTopWidth`
- `connectAppsPanel/viewAll[0]/borderTopColor`
- `connectAppsPanel/viewAll[1]/left`
- `connectAppsPanel/viewAll[1]/top`
- `connectAppsPanel/viewAll[1]/width`
- `connectAppsPanel/viewAll[1]/height`
- `connectAppsPanel/viewAll[1]/backgroundColor`
- `connectAppsPanel/viewAll[1]/color`
- `connectAppsPanel/viewAll[1]/borderRadius`
- `connectAppsPanel/viewAll[1]/fontSize`
- `connectAppsPanel/viewAll[1]/fontWeight`
- `connectAppsPanel/viewAll[1]/boxShadow`
- `connectAppsPanel/viewAll[1]/borderTopWidth`
- `connectAppsPanel/viewAll[1]/borderTopColor`
- `connectAppsPanel/viewAll[2]/left`
- `connectAppsPanel/viewAll[2]/top`
- `connectAppsPanel/viewAll[2]/width`
- `connectAppsPanel/viewAll[2]/height`
- `connectAppsPanel/viewAll[2]/backgroundColor`
- `connectAppsPanel/viewAll[2]/color`
- `connectAppsPanel/viewAll[2]/borderRadius`
- `connectAppsPanel/viewAll[2]/fontSize`
- `connectAppsPanel/viewAll[2]/fontWeight`
- `connectAppsPanel/viewAll[2]/boxShadow`
- `connectAppsPanel/viewAll[2]/borderTopWidth`
- `connectAppsPanel/viewAll[2]/borderTopColor`
- `connectAppsPanel/viewAll[3]/left`
- `connectAppsPanel/viewAll[3]/top`
- `connectAppsPanel/viewAll[3]/width`
- `connectAppsPanel/viewAll[3]/height`
- `connectAppsPanel/viewAll[3]/backgroundColor`
- `connectAppsPanel/viewAll[3]/color`
- `connectAppsPanel/viewAll[3]/borderRadius`
- `connectAppsPanel/viewAll[3]/fontSize`
- `connectAppsPanel/viewAll[3]/fontWeight`
- `connectAppsPanel/viewAll[3]/boxShadow`
- `connectAppsPanel/viewAll[3]/borderTopWidth`
- `connectAppsPanel/viewAll[3]/borderTopColor`
- `connectAppsPanel/viewAll[4]/left`
- `connectAppsPanel/viewAll[4]/top`
- `connectAppsPanel/viewAll[4]/width`
- `connectAppsPanel/viewAll[4]/height`
- `connectAppsPanel/viewAll[4]/backgroundColor`
- `connectAppsPanel/viewAll[4]/color`
- `connectAppsPanel/viewAll[4]/borderRadius`
- `connectAppsPanel/viewAll[4]/fontSize`
- `connectAppsPanel/viewAll[4]/fontWeight`
- `connectAppsPanel/viewAll[4]/boxShadow`
- `connectAppsPanel/viewAll[4]/borderTopWidth`
- `connectAppsPanel/viewAll[4]/borderTopColor`
- `connectAppsPanel/viewAll[5]/left`
- `connectAppsPanel/viewAll[5]/top`
- `connectAppsPanel/viewAll[5]/width`
- `connectAppsPanel/viewAll[5]/height`
- `connectAppsPanel/viewAll[5]/backgroundColor`
- `connectAppsPanel/viewAll[5]/color`
- `connectAppsPanel/viewAll[5]/borderRadius`
- `connectAppsPanel/viewAll[5]/fontSize`
- `connectAppsPanel/viewAll[5]/fontWeight`
- `connectAppsPanel/viewAll[5]/boxShadow`
- `connectAppsPanel/viewAll[5]/borderTopWidth`
- `connectAppsPanel/viewAll[5]/borderTopColor`
- `connectAppsPanel/viewAll[6]/left`
- `connectAppsPanel/viewAll[6]/top`
- `connectAppsPanel/viewAll[6]/width`
- `connectAppsPanel/viewAll[6]/height`
- `connectAppsPanel/viewAll[6]/backgroundColor`
- `connectAppsPanel/viewAll[6]/color`
- `connectAppsPanel/viewAll[6]/borderRadius`
- `connectAppsPanel/viewAll[6]/fontSize`
- `connectAppsPanel/viewAll[6]/fontWeight`
- `connectAppsPanel/viewAll[6]/boxShadow`
- `connectAppsPanel/viewAll[6]/borderTopWidth`
- `connectAppsPanel/viewAll[6]/borderTopColor`
- `connectAppsPanel/viewAll[7]/left`
- `connectAppsPanel/viewAll[7]/top`
- `connectAppsPanel/viewAll[7]/width`
- `connectAppsPanel/viewAll[7]/height`
- `connectAppsPanel/viewAll[7]/backgroundColor`
- `connectAppsPanel/viewAll[7]/color`
- `connectAppsPanel/viewAll[7]/borderRadius`
- `connectAppsPanel/viewAll[7]/fontSize`
- `connectAppsPanel/viewAll[7]/fontWeight`
- `connectAppsPanel/viewAll[7]/boxShadow`
- `connectAppsPanel/viewAll[7]/borderTopWidth`
- `connectAppsPanel/viewAll[7]/borderTopColor`
- `connectAppsPanel/viewAll[8]/left`
- `connectAppsPanel/viewAll[8]/top`
- `connectAppsPanel/viewAll[8]/width`
- `connectAppsPanel/viewAll[8]/height`
- `connectAppsPanel/viewAll[8]/backgroundColor`
- `connectAppsPanel/viewAll[8]/color`
- `connectAppsPanel/viewAll[8]/borderRadius`
- `connectAppsPanel/viewAll[8]/fontSize`
- `connectAppsPanel/viewAll[8]/fontWeight`
- `connectAppsPanel/viewAll[8]/boxShadow`
- `connectAppsPanel/viewAll[8]/borderTopWidth`
- `connectAppsPanel/viewAll[8]/borderTopColor`
- `connectAppsPanel/viewAll[9]/left`
- `connectAppsPanel/viewAll[9]/top`
- `connectAppsPanel/viewAll[9]/width`
- `connectAppsPanel/viewAll[9]/height`
- `connectAppsPanel/viewAll[9]/backgroundColor`
- `connectAppsPanel/viewAll[9]/color`
- `connectAppsPanel/viewAll[9]/borderRadius`
- `connectAppsPanel/viewAll[9]/fontSize`
- `connectAppsPanel/viewAll[9]/fontWeight`
- `connectAppsPanel/viewAll[9]/boxShadow`
- `connectAppsPanel/viewAll[9]/borderTopWidth`
- `connectAppsPanel/viewAll[9]/borderTopColor`
- `connectAppsPanel/grid/padding`
- `connectAppsPanel/grid/margin`
- `connectAppsPanel/rows[0]/backgroundColor`
- `connectAppsPanel/rows[0]/fontSize`
- `connectAppsPanel/rows[0]/fontWeight`
- `connectAppsPanel/rows[0]/gap`
- `connectAppsPanel/rows[0]/name/left`
- `connectAppsPanel/rows[0]/name/top`
- `connectAppsPanel/rows[0]/name/width`
- `connectAppsPanel/rows[0]/name/height`
- `connectAppsPanel/rows[0]/name/fontSize`
- `connectAppsPanel/rows[0]/name/fontWeight`
- `connectAppsPanel/rows[0]/name/color`
- `connectAppsPanel/rows[0]/subtitle/left`
- `connectAppsPanel/rows[0]/subtitle/top`
- `connectAppsPanel/rows[0]/subtitle/width`
- `connectAppsPanel/rows[0]/subtitle/height`
- `connectAppsPanel/rows[0]/subtitle/fontSize`
- `connectAppsPanel/rows[0]/subtitle/fontWeight`
- `connectAppsPanel/rows[0]/subtitle/color`
- `connectAppsPanel/rows[0]/subtitle/lineHeight`
- `connectAppsPanel/rows[0]/outerRow/left`
- `connectAppsPanel/rows[0]/outerRow/top`
- `connectAppsPanel/rows[0]/outerRow/width`
- `connectAppsPanel/rows[0]/outerRow/height`
- `connectAppsPanel/rows[0]/outerRow/backgroundColor`
- `connectAppsPanel/rows[0]/outerRow/borderRadius`
- `connectAppsPanel/rows[0]/outerRow/padding`
- `connectAppsPanel/rows[0]/outerRow/gap`
- `connectAppsPanel/rows[1]/backgroundColor`
- `connectAppsPanel/rows[1]/fontSize`
- `connectAppsPanel/rows[1]/fontWeight`
- `connectAppsPanel/rows[1]/gap`
- `connectAppsPanel/rows[1]/name/left`
- `connectAppsPanel/rows[1]/name/top`
- `connectAppsPanel/rows[1]/name/width`
- `connectAppsPanel/rows[1]/name/height`
- `connectAppsPanel/rows[1]/name/fontSize`
- `connectAppsPanel/rows[1]/name/fontWeight`
- `connectAppsPanel/rows[1]/name/color`
- `connectAppsPanel/rows[1]/subtitle/left`
- `connectAppsPanel/rows[1]/subtitle/top`
- `connectAppsPanel/rows[1]/subtitle/width`
- `connectAppsPanel/rows[1]/subtitle/height`
- `connectAppsPanel/rows[1]/subtitle/fontSize`
- `connectAppsPanel/rows[1]/subtitle/fontWeight`
- `connectAppsPanel/rows[1]/subtitle/color`
- `connectAppsPanel/rows[1]/subtitle/lineHeight`
- `connectAppsPanel/rows[1]/outerRow/left`
- `connectAppsPanel/rows[1]/outerRow/top`
- `connectAppsPanel/rows[1]/outerRow/width`
- `connectAppsPanel/rows[1]/outerRow/height`
- `connectAppsPanel/rows[1]/outerRow/backgroundColor`
- `connectAppsPanel/rows[1]/outerRow/borderRadius`
- `connectAppsPanel/rows[1]/outerRow/padding`
- `connectAppsPanel/rows[1]/outerRow/gap`
- `connectAppsPanel/rows[2]/backgroundColor`
- `connectAppsPanel/rows[2]/fontSize`
- `connectAppsPanel/rows[2]/fontWeight`
- `connectAppsPanel/rows[2]/gap`
- `connectAppsPanel/rows[2]/name/left`
- `connectAppsPanel/rows[2]/name/top`
- `connectAppsPanel/rows[2]/name/width`
- `connectAppsPanel/rows[2]/name/height`
- `connectAppsPanel/rows[2]/name/fontSize`
- `connectAppsPanel/rows[2]/name/fontWeight`
- `connectAppsPanel/rows[2]/name/color`
- `connectAppsPanel/rows[2]/subtitle/left`
- `connectAppsPanel/rows[2]/subtitle/top`
- `connectAppsPanel/rows[2]/subtitle/width`
- `connectAppsPanel/rows[2]/subtitle/height`
- `connectAppsPanel/rows[2]/subtitle/fontSize`
- `connectAppsPanel/rows[2]/subtitle/fontWeight`
- `connectAppsPanel/rows[2]/subtitle/color`
- `connectAppsPanel/rows[2]/subtitle/lineHeight`
- `connectAppsPanel/rows[2]/outerRow/left`
- `connectAppsPanel/rows[2]/outerRow/top`
- `connectAppsPanel/rows[2]/outerRow/width`
- `connectAppsPanel/rows[2]/outerRow/height`
- `connectAppsPanel/rows[2]/outerRow/backgroundColor`
- `connectAppsPanel/rows[2]/outerRow/borderRadius`
- `connectAppsPanel/rows[2]/outerRow/padding`
- `connectAppsPanel/rows[2]/outerRow/gap`
- `connectAppsPanel/rows[3]/left`
- `connectAppsPanel/rows[3]/top`
- `connectAppsPanel/rows[3]/width`
- `connectAppsPanel/rows[3]/height`
- `connectAppsPanel/rows[3]/backgroundColor`
- `connectAppsPanel/rows[3]/borderRadius`
- `connectAppsPanel/rows[3]/fontSize`
- `connectAppsPanel/rows[3]/fontWeight`
- `connectAppsPanel/rows[3]/padding`
- `connectAppsPanel/rows[3]/gap`
- `connectAppsPanel/rows[3]/name/left`
- `connectAppsPanel/rows[3]/name/top`
- `connectAppsPanel/rows[3]/name/width`
- `connectAppsPanel/rows[3]/name/height`
- `connectAppsPanel/rows[3]/name/fontSize`
- `connectAppsPanel/rows[3]/name/fontWeight`
- `connectAppsPanel/rows[3]/name/color`
- `connectAppsPanel/rows[3]/subtitle/left`
- `connectAppsPanel/rows[3]/subtitle/top`
- `connectAppsPanel/rows[3]/subtitle/width`
- `connectAppsPanel/rows[3]/subtitle/height`
- `connectAppsPanel/rows[3]/subtitle/fontSize`
- `connectAppsPanel/rows[3]/subtitle/fontWeight`
- `connectAppsPanel/rows[3]/subtitle/color`
- `connectAppsPanel/rows[3]/subtitle/lineHeight`
- `connectAppsPanel/rows[3]/outerRow/left`
- `connectAppsPanel/rows[3]/outerRow/top`
- `connectAppsPanel/rows[3]/outerRow/width`
- `connectAppsPanel/rows[3]/outerRow/height`
- `connectAppsPanel/rows[3]/outerRow/backgroundColor`
- `connectAppsPanel/rows[3]/outerRow/borderRadius`
- `connectAppsPanel/rows[3]/outerRow/padding`
- `connectAppsPanel/rows[3]/outerRow/gap`
- `connectAppsPanel/rows[4]/left`
- `connectAppsPanel/rows[4]/top`
- `connectAppsPanel/rows[4]/width`
- `connectAppsPanel/rows[4]/height`
- `connectAppsPanel/rows[4]/backgroundColor`
- `connectAppsPanel/rows[4]/borderRadius`
- `connectAppsPanel/rows[4]/fontSize`
- `connectAppsPanel/rows[4]/fontWeight`
- `connectAppsPanel/rows[4]/padding`
- `connectAppsPanel/rows[4]/gap`
- `connectAppsPanel/rows[4]/name/left`
- `connectAppsPanel/rows[4]/name/top`
- `connectAppsPanel/rows[4]/name/width`
- `connectAppsPanel/rows[4]/name/height`
- `connectAppsPanel/rows[4]/name/fontSize`
- `connectAppsPanel/rows[4]/name/fontWeight`
- `connectAppsPanel/rows[4]/name/color`
- `connectAppsPanel/rows[4]/subtitle`
- `connectAppsPanel/rows[4]/outerRow/left`
- `connectAppsPanel/rows[4]/outerRow/top`
- `connectAppsPanel/rows[4]/outerRow/width`
- `connectAppsPanel/rows[4]/outerRow/height`
- `connectAppsPanel/rows[4]/outerRow/backgroundColor`
- `connectAppsPanel/rows[4]/outerRow/borderRadius`
- `connectAppsPanel/rows[4]/outerRow/padding`
- `connectAppsPanel/rows[4]/outerRow/gap`
- `connectAppsPanel/rows[5]/left`
- `connectAppsPanel/rows[5]/top`
- `connectAppsPanel/rows[5]/width`
- `connectAppsPanel/rows[5]/height`
- `connectAppsPanel/rows[5]/backgroundColor`
- `connectAppsPanel/rows[5]/borderRadius`
- `connectAppsPanel/rows[5]/fontSize`
- `connectAppsPanel/rows[5]/fontWeight`
- `connectAppsPanel/rows[5]/padding`
- `connectAppsPanel/rows[5]/gap`
- `connectAppsPanel/rows[5]/name/left`
- `connectAppsPanel/rows[5]/name/top`
- `connectAppsPanel/rows[5]/name/width`
- `connectAppsPanel/rows[5]/name/height`
- `connectAppsPanel/rows[5]/name/fontSize`
- `connectAppsPanel/rows[5]/name/fontWeight`
- `connectAppsPanel/rows[5]/name/color`
- `connectAppsPanel/rows[5]/subtitle/left`
- `connectAppsPanel/rows[5]/subtitle/top`
- `connectAppsPanel/rows[5]/subtitle/width`
- `connectAppsPanel/rows[5]/subtitle/height`
- `connectAppsPanel/rows[5]/subtitle/fontSize`
- `connectAppsPanel/rows[5]/subtitle/fontWeight`
- `connectAppsPanel/rows[5]/subtitle/color`
- `connectAppsPanel/rows[5]/subtitle/lineHeight`
- `connectAppsPanel/rows[5]/outerRow/left`
- `connectAppsPanel/rows[5]/outerRow/top`
- `connectAppsPanel/rows[5]/outerRow/width`
- `connectAppsPanel/rows[5]/outerRow/height`
- `connectAppsPanel/rows[5]/outerRow/backgroundColor`
- `connectAppsPanel/rows[5]/outerRow/borderRadius`
- `connectAppsPanel/rows[5]/outerRow/padding`
- `connectAppsPanel/rows[5]/outerRow/gap`
- `connectAppsPanel/trailingButtons[0]/left`
- `connectAppsPanel/trailingButtons[0]/top`
- `connectAppsPanel/trailingButtons[0]/width`
- `connectAppsPanel/trailingButtons[0]/height`
- `connectAppsPanel/trailingButtons[0]/backgroundColor`
- `connectAppsPanel/trailingButtons[0]/color`
- `connectAppsPanel/trailingButtons[0]/borderRadius`
- `connectAppsPanel/trailingButtons[0]/fontSize`
- `connectAppsPanel/trailingButtons[0]/fontWeight`
- `connectAppsPanel/trailingButtons[0]/boxShadow`
- `connectAppsPanel/trailingButtons[0]/borderTopWidth`
- `connectAppsPanel/trailingButtons[0]/borderTopColor`
- `connectAppsPanel/trailingButtons[1]/left`
- `connectAppsPanel/trailingButtons[1]/top`
- `connectAppsPanel/trailingButtons[1]/width`
- `connectAppsPanel/trailingButtons[1]/height`
- `connectAppsPanel/trailingButtons[1]/backgroundColor`
- `connectAppsPanel/trailingButtons[1]/color`
- `connectAppsPanel/trailingButtons[1]/borderRadius`
- `connectAppsPanel/trailingButtons[1]/fontSize`
- `connectAppsPanel/trailingButtons[1]/fontWeight`
- `connectAppsPanel/trailingButtons[1]/boxShadow`
- `connectAppsPanel/trailingButtons[1]/borderTopWidth`
- `connectAppsPanel/trailingButtons[1]/borderTopColor`
- `connectAppsPanel/trailingButtons[2]/left`
- `connectAppsPanel/trailingButtons[2]/top`
- `connectAppsPanel/trailingButtons[2]/width`
- `connectAppsPanel/trailingButtons[2]/height`
- `connectAppsPanel/trailingButtons[2]/backgroundColor`
- `connectAppsPanel/trailingButtons[2]/color`
- `connectAppsPanel/trailingButtons[2]/borderRadius`
- `connectAppsPanel/trailingButtons[2]/fontSize`
- `connectAppsPanel/trailingButtons[2]/fontWeight`
- `connectAppsPanel/trailingButtons[2]/boxShadow`
- `connectAppsPanel/trailingButtons[2]/borderTopWidth`
- `connectAppsPanel/trailingButtons[2]/borderTopColor`
- `connectAppsPanel/trailingButtons[3]/left`
- `connectAppsPanel/trailingButtons[3]/top`
- `connectAppsPanel/trailingButtons[3]/width`
- `connectAppsPanel/trailingButtons[3]/height`
- `connectAppsPanel/trailingButtons[3]/backgroundColor`
- `connectAppsPanel/trailingButtons[3]/color`
- `connectAppsPanel/trailingButtons[3]/borderRadius`
- `connectAppsPanel/trailingButtons[3]/fontSize`
- `connectAppsPanel/trailingButtons[3]/fontWeight`
- `connectAppsPanel/trailingButtons[3]/boxShadow`
- `connectAppsPanel/trailingButtons[3]/borderTopWidth`
- `connectAppsPanel/trailingButtons[3]/borderTopColor`
- `connectAppsPanel/addedConnectedMarker[0]/left`
- `connectAppsPanel/addedConnectedMarker[0]/top`
- `connectAppsPanel/addedConnectedMarker[0]/width`
- `connectAppsPanel/addedConnectedMarker[0]/height`
- `connectAppsPanel/addedConnectedMarker[0]/color`
- `connectAppsPanel/addedConnectedMarker[0]/backgroundColor`
- `connectAppsPanel/addedConnectedMarker[0]/fontSize`
- `connectAppsPanel/addedConnectedMarker[0]/fontWeight`
- `connectAppsPanel/addedConnectedMarker[0]/borderRadius`
- `connectAppsPanel/addedConnectedMarker[1]/left`
- `connectAppsPanel/addedConnectedMarker[1]/top`
- `connectAppsPanel/addedConnectedMarker[1]/width`
- `connectAppsPanel/addedConnectedMarker[1]/height`
- `connectAppsPanel/addedConnectedMarker[1]/color`
- `connectAppsPanel/addedConnectedMarker[1]/backgroundColor`
- `connectAppsPanel/addedConnectedMarker[1]/fontSize`
- `connectAppsPanel/addedConnectedMarker[1]/fontWeight`
- `connectAppsPanel/addedConnectedMarker[1]/borderRadius`
- `connectAppsPanel/addedConnectedMarker[2]/left`
- `connectAppsPanel/addedConnectedMarker[2]/top`
- `connectAppsPanel/addedConnectedMarker[2]/width`
- `connectAppsPanel/addedConnectedMarker[2]/height`
- `connectAppsPanel/addedConnectedMarker[2]/color`
- `connectAppsPanel/addedConnectedMarker[2]/backgroundColor`
- `connectAppsPanel/addedConnectedMarker[2]/fontSize`
- `connectAppsPanel/addedConnectedMarker[2]/fontWeight`
- `connectAppsPanel/addedConnectedMarker[2]/borderRadius`
- `connectAppsPanel/teamBadges[0]/left`
- `connectAppsPanel/teamBadges[0]/top`
- `connectAppsPanel/teamBadges[0]/width`
- `connectAppsPanel/teamBadges[0]/height`
- `connectAppsPanel/teamBadges[0]/color`
- `connectAppsPanel/teamBadges[0]/backgroundColor`
- `connectAppsPanel/teamBadges[0]/fontSize`
- `connectAppsPanel/teamBadges[0]/borderRadius`
- `connectAppsPanel/teamBadges[0]/padding`
- `connectAppsPanel/teamBadges[1]/left`
- `connectAppsPanel/teamBadges[1]/top`
- `connectAppsPanel/teamBadges[1]/width`
- `connectAppsPanel/teamBadges[1]/height`
- `connectAppsPanel/teamBadges[1]/color`
- `connectAppsPanel/teamBadges[1]/backgroundColor`
- `connectAppsPanel/teamBadges[1]/fontSize`
- `connectAppsPanel/teamBadges[1]/borderRadius`
- `connectAppsPanel/teamBadges[1]/padding`
- `connectAppsPanel/teamBadges[2]/left`
- `connectAppsPanel/teamBadges[2]/top`
- `connectAppsPanel/teamBadges[2]/width`
- `connectAppsPanel/teamBadges[2]/height`
- `connectAppsPanel/teamBadges[2]/color`
- `connectAppsPanel/teamBadges[2]/backgroundColor`
- `connectAppsPanel/teamBadges[2]/fontSize`
- `connectAppsPanel/teamBadges[2]/borderRadius`
- `connectAppsPanel/teamBadges[2]/padding`
- `connectAppsPanel/notClicked[0]`
- `connectAppsPanel/notClicked[1]`
- `connectAppsPanel/notClicked[2]`
- `plusMenuItems/label`
- `plusMenuItems/container/left`
- `plusMenuItems/container/top`
- `plusMenuItems/container/width`
- `plusMenuItems/container/height`
- `plusMenuItems/container/margin`
- `plusMenuItems/container/zIndex`
- `plusMenuItems/container/position`
- `plusMenuItems/container/opacity`
- `plusMenuItems/container/transform`
- `plusMenuItems/container/fontFamily`
- `plusMenuItems/container/fontSize`
- `plusMenuItems/container/fontWeight`
- `plusMenuItems/container/color`
- `plusMenuItems/container/transition`
- `plusMenuItems/container/borderTopWidth`
- `plusMenuItems/container/borderTopColor`
- `plusMenuItems/container/borderTopStyle`
- `plusMenuItems/container/borderRightWidth`
- `plusMenuItems/container/borderRightColor`
- `plusMenuItems/container/borderBottomWidth`
- `plusMenuItems/container/borderBottomColor`
- `plusMenuItems/container/borderBottomStyle`
- `plusMenuItems/container/borderLeftWidth`
- `plusMenuItems/container/borderLeftColor`
- `plusMenuItems/list/left`
- `plusMenuItems/list/top`
- `plusMenuItems/list/width`
- `plusMenuItems/list/height`
- `plusMenuItems/list/padding`
- `plusMenuItems/list/margin`
- `plusMenuItems/list/gap`
- `plusMenuItems/itemCount`
- `plusMenuItems/items[0]/component`
- `plusMenuItems/items[0]/hasSubmenuArrow`
- `plusMenuItems/items[0]/expanded`
- `plusMenuItems/items[0]/disabled`
- `plusMenuItems/items[0]/href`
- `plusMenuItems/items[0]/margin`
- `plusMenuItems/items[0]/gap`
- `plusMenuItems/items[0]/fontWeight`
- `plusMenuItems/items[0]/lineHeight`
- `plusMenuItems/items[0]/icons[0]/name`
- `plusMenuItems/items[0]/icons[0]/sizeAttr`
- `plusMenuItems/items[0]/icons[0]/left`
- `plusMenuItems/items[0]/icons[0]/top`
- `plusMenuItems/items[0]/icons[0]/width`
- `plusMenuItems/items[0]/icons[0]/height`
- `plusMenuItems/items[0]/icons[0]/color`
- `plusMenuItems/items[0]/icons[0]/fontSize`
- `plusMenuItems/items[0]/labelEl/left`
- `plusMenuItems/items[0]/labelEl/top`
- `plusMenuItems/items[0]/labelEl/width`
- `plusMenuItems/items[0]/labelEl/height`
- `plusMenuItems/items[0]/labelEl/fontSize`
- `plusMenuItems/items[0]/labelEl/fontWeight`
- `plusMenuItems/items[0]/labelEl/color`
- `plusMenuItems/items[0]/labelEl/lineHeight`
- `plusMenuItems/items[0]/leafTexts[0]`
- `plusMenuItems/items[1]/component`
- `plusMenuItems/items[1]/hasSubmenuArrow`
- `plusMenuItems/items[1]/expanded`
- `plusMenuItems/items[1]/disabled`
- `plusMenuItems/items[1]/href`
- `plusMenuItems/items[1]/margin`
- `plusMenuItems/items[1]/gap`
- `plusMenuItems/items[1]/fontWeight`
- `plusMenuItems/items[1]/lineHeight`
- `plusMenuItems/items[1]/inlineSvg[0]/left`
- `plusMenuItems/items[1]/inlineSvg[0]/top`
- `plusMenuItems/items[1]/inlineSvg[0]/width`
- `plusMenuItems/items[1]/inlineSvg[0]/height`
- `plusMenuItems/items[1]/inlineSvg[0]/color`
- `plusMenuItems/items[1]/labelEl/left`
- `plusMenuItems/items[1]/labelEl/top`
- `plusMenuItems/items[1]/labelEl/width`
- `plusMenuItems/items[1]/labelEl/height`
- `plusMenuItems/items[1]/labelEl/fontSize`
- `plusMenuItems/items[1]/labelEl/fontWeight`
- `plusMenuItems/items[1]/labelEl/color`
- `plusMenuItems/items[1]/labelEl/lineHeight`
- `plusMenuItems/items[1]/leafTexts[0]`
- `rowInteractionStates/rowRect/left`
- `rowInteractionStates/rowRect/top`
- `rowInteractionStates/rowRect/width`
- `rowInteractionStates/rowRect/height`
- `rowInteractionStates/idle/index`
- `rowInteractionStates/idle/backgroundColor`
- `rowInteractionStates/idle/color`
- `rowInteractionStates/idle/borderRadius`
- `rowInteractionStates/idle/boxShadow`
- `rowInteractionStates/hover/i`
- `rowInteractionStates/hover/rect/left`
- `rowInteractionStates/hover/rect/top`
- `rowInteractionStates/hover/rect/width`
- `rowInteractionStates/hover/rect/height`
- `rowInteractionStates/hover/backgroundColor`
- `rowInteractionStates/hover/color`
- `rowInteractionStates/hover/boxShadow`
- `rowInteractionStates/hover/borderRadius`
- `rowInteractionStates/hover/isCurrent`
- `rowInteractionStates/selected/index`
- `rowInteractionStates/selected/backgroundColor`
- `rowInteractionStates/selected/color`
- `rowInteractionStates/selected/borderRadius`
- `rowInteractionStates/selected/boxShadow`
- `rowInteractionStates/selected/marker`
- `rowInteractionStates/originalActiveIndex`

### 仅我方存在（真源没有的形态，对齐时考虑退役或降级）

- `windowShell/right`
- `windowShell/bottom`
- `windowShell/htmlBackgroundColor`
- `sidebar/right`
- `sidebar/bottom`
- `sidebarHeader/right`
- `sidebarHeader/bottom`
- `sidebarHeader/display`
- `sidebarHeader/alignItems`
- `sidebarHeader/justifyContent`
- `sidebarHeaderButtons[0]/right`
- `sidebarHeaderButtons[0]/bottom`
- `sidebarHeaderButtons[0]/fontSize`
- `sidebarHeaderButtons[0]/fontFamily`
- `sidebarHeaderButtons[1]/right`
- `sidebarHeaderButtons[1]/bottom`
- `sidebarHeaderButtons[1]/fontSize`
- `sidebarHeaderButtons[1]/fontFamily`
- `sessionRow/right`
- `sessionRow/bottom`
- `sessionRow/display`
- `sessionRow/alignItems`
- `sessionRow/title/right`
- `sessionRow/title/bottom`
- `sessionRow/preview/right`
- `sessionRow/preview/bottom`
- `sessionRow/preview/letterSpacing`
- `avatar/right`
- `avatar/bottom`
- `avatar/color`
- `avatar/fontSize`
- `avatar/fontWeight`
- `avatar/avatarBlobClass`
- `groupLabel/right`
- `groupLabel/bottom`
- `groupLabel/lineHeight`
- `groupLabel/textTransform`
- `groupLabel/display`
- `groupLabel/justifyContent`
- `groupLabel/textSpan/right`
- `groupLabel/textSpan/bottom`
- `composer/dock/right`
- `composer/dock/bottom`
- `composer/dock/display`
- `composer/dock/flexDirection`
- `composer/right`
- `composer/bottom`
- `composer/display`
- `composer/alignItems`
- `composer/field/right`
- `composer/field/bottom`
- `composer/field/padding`
- `attachButton/right`
- `attachButton/bottom`
- `attachButton/display`
- `attachButton/order`
- `attachButton/opacity`
- `attachButton/visibility`
- `micButton/right`
- `micButton/bottom`
- `micButton/display`
- `micButton/order`
- `micButton/borderTopWidth`
- `sendButton/right`
- `sendButton/bottom`
- `sendButton/order`
- `sendButton/borderTopWidth`
- `sendButton/withTextState/value`
- `sendButton/withTextState/width`
- `sendButton/withTextState/height`
- `sendButton/withTextState/borderRadius`
- `sendButton/withTextState/backgroundColor`
- `sendButton/withTextState/color`
- `sendButton/withTextState/boxShadow`
- `sendButton/withTextState/opacity`
- `sendButton/withTextState/disabled`
- `sendButton/emptyState/backgroundColor`
- `sendButton/emptyState/opacity`
- `bubble/right`
- `bubble/bottom`
- `bubbleVariants[0]/right`
- `bubbleVariants[0]/bottom`
- `bubbleVariants[0]/margin`
- `bubbleVariants[0]/borderTopColor`
- `bubbleVariants[0]/borderTopStyle`
- `bubbleVariants[0]/fontSize`
- `bubbleVariants[0]/fontWeight`
- `bubbleVariants[0]/lineHeight`
- `bubbleVariants[0]/fontFamily`
- `bubbleVariants[0]/hasBorder`
- `bubbleVariants[0]/hasShadow`
- `bubbleVariants[1]/right`
- `bubbleVariants[1]/bottom`
- `bubbleVariants[1]/fontSize`
- `bubbleVariants[1]/fontWeight`
- `bubbleVariants[1]/lineHeight`
- `bubbleVariants[1]/body/left`
- `bubbleVariants[1]/body/top`
- `bubbleVariants[1]/body/right`
- `bubbleVariants[1]/body/bottom`
- `bubbleVariants[1]/body/width`
- `bubbleVariants[1]/body/height`
- `bubbleVariants[1]/body/fontSize`
- `bubbleVariants[1]/body/lineHeight`
- `bubbleVariants[1]/body/color`
- `bubbleVariants[1]/body/fontWeight`
- `bubbleAuthorName/right`
- `bubbleAuthorName/bottom`
- `bubbleAvatar/right`
- `bubbleAvatar/bottom`
- `bubbleAvatar/color`
- `messageColumn/row/right`
- `messageColumn/row/bottom`
- `messageColumn/row/maxWidth`
- `messageColumn/maxWidthRule/cssMaxWidth`
- `messageColumn/maxWidthRule/contentMaxVar`
- `messageColumn/maxWidthRule/resolved`
- `messageColumn/maxWidthRule/msgMaxWidth`
- `messageColumn/codeBlock/right`
- `messageColumn/codeBlock/bottom`
- `messageColumn/codeBlock/fontSize`
- `messageColumn/codeBlock/fontFamily`
- `messageColumn/codeBlock/lineHeight`
- `accountBar/footer/left`
- `accountBar/footer/top`
- `accountBar/footer/right`
- `accountBar/footer/bottom`
- `accountBar/footer/width`
- `accountBar/footer/height`
- `accountBar/footer/padding`
- `accountBar/footer/gap`
- `accountBar/footer/backgroundColor`
- `accountBar/footer/borderTopWidth`
- `accountBar/footer/borderTopColor`
- `accountBar/footer/display`
- `accountBar/right`
- `accountBar/bottom`
- `accountBar/display`
- `accountBar/alignItems`
- `accountBar/accountButton/right`
- `accountBar/accountButton/bottom`
- `accountBar/accountButton/gap`
- `accountBar/accountButton/display`
- `accountBar/accountButton/minHeight`
- `accountBar/accountAvatar/right`
- `accountBar/accountAvatar/bottom`
- `accountBar/accountAvatar/backgroundColor`
- `accountBar/accountAvatar/color`
- `accountBar/accountAvatar/fontSize`
- `accountBar/accountAvatar/boxShadow`
- `accountBar/emailText/right`
- `accountBar/emailText/bottom`
- `accountBar/connectAppsButton/absent`
- `accountBar/connectAppsButton/abSessionsBtn/left`
- `accountBar/connectAppsButton/abSessionsBtn/top`
- `accountBar/connectAppsButton/abSessionsBtn/right`
- `accountBar/connectAppsButton/abSessionsBtn/bottom`
- `accountBar/connectAppsButton/abSessionsBtn/width`
- `accountBar/connectAppsButton/abSessionsBtn/height`
- `accountBar/connectAppsButton/abSessionsBtn/borderRadius`
- `accountBar/connectAppsButton/abSessionsBtn/backgroundColor`
- `accountBar/connectAppsButton/abSessionsBtn/color`
- `accountBar/connectAppsButton/abSettingsBtn/left`
- `accountBar/connectAppsButton/abSettingsBtn/top`
- `accountBar/connectAppsButton/abSettingsBtn/right`
- `accountBar/connectAppsButton/abSettingsBtn/bottom`
- `accountBar/connectAppsButton/abSettingsBtn/width`
- `accountBar/connectAppsButton/abSettingsBtn/height`
- `accountBar/connectAppsButton/abSettingsBtn/borderRadius`
- `accountBar/connectAppsButton/abSettingsBtn/backgroundColor`
- `accountBar/connectAppsButton/abSettingsBtn/color`
- `tokens/cssVars/--bg`
- `tokens/cssVars/--bg-elev`
- `tokens/cssVars/--text`
- `tokens/cssVars/--text-muted`
- `tokens/cssVars/--border`
- `tokens/cssVars/--fill`
- `tokens/cssVars/--fill-strong`
- `tokens/cssVars/--accent`
- `tokens/cssVars/--accent-ink`
- `tokens/cssVars/--sidebar-w`
- `tokens/cssVars/--header-h`
- `tokens/cssVars/--content-max`
- `tokens/cssVars/--radius-composer`
- `tokens/cssVars/--radius-bubble`
- `tokens/cssVars/--radius-pill`
- `tokens/cssVars/--radius-xl`
- `tokens/cssVars/--space-1`
- `tokens/cssVars/--space-2`
- `tokens/cssVars/--space-3`
- `tokens/cssVars/--space-4`
- `tokens/cssVars/--space-5`
- `tokens/cssVars/--space-6`
- `tokens/cssVars/--space-7`
- `tokens/cssVars/--text-xs`
- `tokens/cssVars/--text-sm`
- `tokens/cssVars/--text-base`
- `tokens/cssVars/--text-md`
- `tokens/cssVars/--text-lg`
- `rowInteractionStates/hoverBackgroundColor`
- `rowInteractionStates/hoverNote`
- `rowInteractionStates/activeBackgroundColor`
- `rowInteractionStates/activeNote`
- `accountPopup/x`
- `accountPopup/y`
- `accountPopup/left`
- `accountPopup/top`
- `accountPopup/width`
- `accountPopup/height`
- `accountPopup/borderRadius`
- `accountPopup/backgroundColor`
- `accountPopup/borderTopWidth`
- `accountPopup/borderTopColor`
- `accountPopup/boxShadow`
- `accountPopup/padding`
- `accountPopup/gap`
- `accountPopup/transition`
- `accountPopup/items[0]/id`
- `accountPopup/items[0]/x`
- `accountPopup/items[0]/y`
- `accountPopup/items[0]/icon/fontSize`
- `accountPopup/items[0]/icon/color`
- `accountPopup/items[1]/id`
- `accountPopup/items[1]/x`
- `accountPopup/items[1]/y`
- `accountPopup/items[1]/icon/fontSize`
- `accountPopup/items[1]/icon/color`
- `accountPopup/items[2]/id`
- `accountPopup/items[2]/x`
- `accountPopup/items[2]/y`
- `accountPopup/items[2]/icon/fontSize`
- `accountPopup/items[2]/icon/color`
- `accountPopup/items[3]/id`
- `accountPopup/items[3]/x`
- `accountPopup/items[3]/y`
- `accountPopup/items[3]/icon/fontSize`
- `accountPopup/items[3]/icon/color`
- `accountPopup/items[4]/id`
- `accountPopup/items[4]/x`
- `accountPopup/items[4]/y`
- `accountPopup/items[4]/icon/fontSize`
- `accountPopup/items[4]/icon/color`
- `accountPopup/items[5]/id`
- `accountPopup/items[5]/x`
- `accountPopup/items[5]/y`
- `accountPopup/items[5]/icon/fontSize`
- `accountPopup/items[5]/icon/color`
- `accountPopup/items[6]/id`
- `accountPopup/items[6]/x`
- `accountPopup/items[6]/y`
- `accountPopup/items[6]/left`
- `accountPopup/items[6]/top`
- `accountPopup/items[6]/width`
- `accountPopup/items[6]/height`
- `accountPopup/items[6]/padding`
- `accountPopup/items[6]/borderRadius`
- `accountPopup/items[6]/fontSize`
- `accountPopup/items[6]/fontWeight`
- `accountPopup/items[6]/color`
- `accountPopup/items[6]/backgroundColor`
- `accountPopup/items[6]/icon/fontSize`
- `accountPopup/items[6]/icon/color`
- `accountPopup/items[7]/id`
- `accountPopup/items[7]/x`
- `accountPopup/items[7]/y`
- `accountPopup/items[7]/left`
- `accountPopup/items[7]/top`
- `accountPopup/items[7]/width`
- `accountPopup/items[7]/height`
- `accountPopup/items[7]/padding`
- `accountPopup/items[7]/borderRadius`
- `accountPopup/items[7]/fontSize`
- `accountPopup/items[7]/fontWeight`
- `accountPopup/items[7]/color`
- `accountPopup/items[7]/backgroundColor`
- `accountPopup/items[7]/icon/fontSize`
- `accountPopup/items[7]/icon/color`
- `accountPopup/items[8]/id`
- `accountPopup/items[8]/x`
- `accountPopup/items[8]/y`
- `accountPopup/items[8]/left`
- `accountPopup/items[8]/top`
- `accountPopup/items[8]/width`
- `accountPopup/items[8]/height`
- `accountPopup/items[8]/padding`
- `accountPopup/items[8]/borderRadius`
- `accountPopup/items[8]/fontSize`
- `accountPopup/items[8]/fontWeight`
- `accountPopup/items[8]/color`
- `accountPopup/items[8]/backgroundColor`
- `accountPopup/items[8]/icon/fontSize`
- `accountPopup/items[8]/icon/color`
- `accountPopup/items[9]/id`
- `accountPopup/items[9]/x`
- `accountPopup/items[9]/y`
- `accountPopup/items[9]/left`
- `accountPopup/items[9]/top`
- `accountPopup/items[9]/width`
- `accountPopup/items[9]/height`
- `accountPopup/items[9]/padding`
- `accountPopup/items[9]/borderRadius`
- `accountPopup/items[9]/fontSize`
- `accountPopup/items[9]/fontWeight`
- `accountPopup/items[9]/color`
- `accountPopup/items[9]/backgroundColor`
- `accountPopup/items[9]/icon/fontSize`
- `accountPopup/items[9]/icon/color`
- `accountPopup/separators[0]/backgroundColor`
- `accountPopup/separators[1]/height`
- `accountPopup/separators[1]/backgroundColor`
- `accountPopup/separators[1]/margin`
- `accountPopup/separators[2]/height`
- `accountPopup/separators[2]/backgroundColor`
- `accountPopup/separators[2]/margin`
- `accountPopup/separators[3]/height`
- `accountPopup/separators[3]/backgroundColor`
- `accountPopup/separators[3]/margin`
- `plusMenuItems/left`
- `plusMenuItems/top`
- `plusMenuItems/width`
- `plusMenuItems/height`
- `plusMenuItems/container/border`
- `plusMenuItems/items[0]/id`
- `plusMenuItems/items[0]/border`
- `plusMenuItems/items[1]/id`
- `plusMenuItems/items[1]/border`
- `plusMenuItems/items[2]/id`
- `plusMenuItems/items[2]/left`
- `plusMenuItems/items[2]/top`
- `plusMenuItems/items[2]/width`
- `plusMenuItems/items[2]/height`
- `plusMenuItems/items[2]/padding`
- `plusMenuItems/items[2]/borderRadius`
- `plusMenuItems/items[2]/fontSize`
- `plusMenuItems/items[2]/color`
- `plusMenuItems/items[2]/backgroundColor`
- `plusMenuItems/items[2]/border`
- `plusMenuItems/items[3]/id`
- `plusMenuItems/items[3]/left`
- `plusMenuItems/items[3]/top`
- `plusMenuItems/items[3]/width`
- `plusMenuItems/items[3]/height`
- `plusMenuItems/items[3]/padding`
- `plusMenuItems/items[3]/borderRadius`
- `plusMenuItems/items[3]/fontSize`
- `plusMenuItems/items[3]/color`
- `plusMenuItems/items[3]/backgroundColor`
- `plusMenuItems/items[3]/border`
- `connectAppsPanel/title/padding`
- `connectAppsPanel/title/backgroundColor`
- `connectAppsPanel/title/borderRadius`
- `connectAppsPanel/title/boxShadow`
- `connectAppsPanel/title/borderTopWidth`
- `connectAppsPanel/title/borderTopColor`
- `connectAppsPanel/title/borderTopStyle`
- `connectAppsPanel/close/padding`
- `connectAppsPanel/close/borderTopStyle`
- `connectAppsPanel/searchBox/padding`
- `connectAppsPanel/searchBox/boxShadow`
- `connectAppsPanel/searchBox/borderTopWidth`
- `connectAppsPanel/searchBox/borderTopColor`
- `connectAppsPanel/searchBox/borderTopStyle`
- `connectAppsPanel/chips[0]/padding`
- `connectAppsPanel/chips[1]/padding`
- `connectAppsPanel/chips[2]/padding`
- `connectAppsPanel/chips[3]/padding`
- `connectAppsPanel/chips[4]/padding`
- `connectAppsPanel/chips[5]/padding`
- `connectAppsPanel/absent/installedPreview`
- `connectAppsPanel/absent/botTemplate`
- `connectAppsPanel/absent/viewAll`
- `connectAppsPanel/absent/teamBadges`
- `meta/viewport/deviceScaleFactor`
- `meta/contentAreaVerified/w`
- `meta/contentAreaVerified/h`
- `meta/theme`
- `meta/unit`
- `meta/selectorMap/windowShell`
- `meta/selectorMap/sidebar`
- `meta/selectorMap/sidebarHeader`
- `meta/selectorMap/sessionRow`
- `meta/selectorMap/avatar`
- `meta/selectorMap/groupLabel`
- `meta/selectorMap/composer`
- `meta/selectorMap/attachButton`
- `meta/selectorMap/micButton`
- `meta/selectorMap/sendButton`
- `meta/selectorMap/bubble`
- `meta/selectorMap/bubbleVariants`
- `meta/selectorMap/bubbleAuthorName`
- `meta/selectorMap/bubbleAvatar`
- `meta/selectorMap/messageColumn`
- `meta/selectorMap/accountBar`
- `meta/selectorMap/accountPopup`
- `meta/selectorMap/plusMenuItems`
- `meta/selectorMap/connectAppsPanel`
