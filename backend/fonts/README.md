# Arabic Fonts

All fonts are bundled locally in this folder so the renderer (libass via `fontsdir`)
does not depend on OS-installed fonts. Every font is licensed under the
**SIL Open Font License 1.1** — free for commercial use, redistribution, and
embedding in videos.

| File | Family (internal) | Weight | Source | License |
|------|-------------------|--------|--------|---------|
| `Cairo-Bold.ttf` | Cairo | Variable (Bold available) | Google Fonts — [Cairo](https://fonts.google.com/specimen/Cairo) | SIL OFL 1.1 |
| `Tajawal-Bold.ttf` | Tajawal | Bold | Google Fonts — [Tajawal](https://fonts.google.com/specimen/Tajawal) | SIL OFL 1.1 |
| `IBMPlexSansArabic-Bold.ttf` | IBM Plex Sans Arabic | Bold | Google Fonts — [IBM Plex Sans Arabic](https://fonts.google.com/specimen/IBM+Plex+Sans+Arabic) | SIL OFL 1.1 |
| `NotoSansArabic.ttf` | Noto Sans Arabic | Variable | Google Fonts — [Noto Sans Arabic](https://fonts.google.com/noto/specimen/Noto+Sans+Arabic) | SIL OFL 1.1 |

## Sources (raw files)

Downloaded from the official `google/fonts` GitHub repository:

- `https://github.com/google/fonts/tree/main/ofl/cairo`
- `https://github.com/google/fonts/tree/main/ofl/tajawal`
- `https://github.com/google/fonts/tree/main/ofl/ibmplexsansarabic`
- `https://github.com/google/fonts/tree/main/ofl/notosansarabic`

## Notes

- Cairo and Noto Sans Arabic are **variable fonts**; the Bold weight is requested
  via `fontconfig` (`family:weight=bold`) so both static and variable fonts render bold.
- The renderer adds this directory to libass via the `fontsdir=` option of the
  FFmpeg `subtitles` filter, so no system font installation is required.