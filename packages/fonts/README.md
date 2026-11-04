# @cvac/fonts

Fonts bundled with CV as Code. cvac embeds only these fonts, never system fonts,
so output is byte-identical on every machine.

| Family                 | Faces                            | License                                                                    |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| Source Sans 3 (Adobe)  | 400, 400 italic, 600, 600 italic | SIL OFL 1.1 ([files/source-sans-3/OFL.txt](files/source-sans-3/OFL.txt))   |
| Source Serif 4 (Adobe) | 400, 400 italic, 600, 600 italic | SIL OFL 1.1 ([files/source-serif-4/OFL.txt](files/source-serif-4/OFL.txt)) |

The font files come from `@expo-google-fonts/source-sans-3@0.4.2` and
`@expo-google-fonts/source-serif-4@0.4.2`, and are committed here so the bytes
stay pinned. A PDF or DOCX embeds only the families its theme uses.
