/**
 * Starter files: what `cvac init` writes and what the web editor opens with.
 * Both validate and lint cleanly in English and Italian (tested).
 */

export const STARTER_CV = `# yaml-language-server: $schema=./.cvac/schemas/cv.schema.json
# Your CV as code. Build it with:  cvac build --format all
# Text can be one string, or one per language: { en: ..., it: ... }

version: 1
meta:
  defaultLocale: en
  locales: [en, it]
  # Tailored versions of the same CV: cvac build --variant backend
  # Tag sections, items or bullets (tags: [backend]); untagged ones are always kept.
  # variants:
  #   backend:
  #     tags: [backend]
  #     title: Backend Engineer

basics:
  name: Your Name
  title:
    en: Software Engineer
    it: Ingegnere del Software
  email: you@example.com
  phone: "+39 000 000 0000"
  location: { city: Milano, country: { en: Italy, it: Italia } }
  # photo: photo.jpg              # optional: a JPEG or PNG next to this file
  summary:
    en: One or two sentences about what you do and what you are looking for.
    it: Una o due frasi su cosa fai e cosa stai cercando.
  profiles:
    - network: GitHub
      url: https://github.com/your-handle

sections:
  - type: experience
    items:
      - company: Example Corp
        role: { en: Senior Developer, it: Sviluppatore Senior }
        location: Milano
        start: 2022-03
        end: present
        # Quote bullets that contain ": " (YAML would read them as a key).
        highlights:
          - "Impact first: what changed thanks to you, with numbers"
          - Another achievement
          # A bullet only some variants show:
          # - { text: Scaled the API to 10k requests/s, tags: [backend] }

  - type: education
    items:
      - institution: Your University
        degree: { en: MSc Computer Science, it: Laurea Magistrale in Informatica }
        start: 2016
        end: 2018

  - type: skills
    items:
      - name: { en: Languages, it: Linguaggi }
        keywords: [TypeScript, Python]

  - type: languages
    items:
      - { language: { en: Italian, it: Italiano }, fluency: { en: Native, it: Madrelingua } }
      - { language: { en: English, it: Inglese }, fluency: C1 }
`;

export const STARTER_THEME = `# yaml-language-server: $schema=./.cvac/schemas/theme.schema.json
# Layered over a base theme: set only what you want to change.
# Built-in bases: default, compact, minimal, classic, academic, executive,
# modern (one column); sidebar, sidebar-right, creative (two columns in the
# PDF). A file works too: ./base.yaml
version: 1
extends: default

page:
  size: A4        # or Letter
  margins: 18mm

tokens:
  colors:
    accent: "#1f4e79"
  # fonts:
  #   body: { family: Source Sans 3, size: 10pt }
  # spacing:
  #   section: 12pt

# A sidebar layout (the DOCX always stays one column, for ATS):
# layout:
#   type: sidebar
#   side: left
#   width: 32%
#   sidebar: [summary, skills, languages]

# header: { align: center, nameColor: accent }   # or left; text
# headings: { rule: bar, case: upper }           # or underline, none; normal

# The photo (when the CV has basics.photo):
# photo: { position: header-right, size: 28mm, shape: circle }
`;
