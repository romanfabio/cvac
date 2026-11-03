import { z } from "zod";
import { EndDate, LocaleCode, LocalizedText, PartialDate, Tags, Url } from "./common.ts";
import { LintConfig } from "./lint.ts";

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export const Location = z.strictObject({
  city: LocalizedText.optional(),
  region: LocalizedText.optional(),
  country: LocalizedText.optional(),
});

export const Profile = z.strictObject({
  network: z.string().min(1).describe("e.g. LinkedIn, GitHub"),
  username: z.string().optional(),
  url: Url,
});

export const Basics = z
  .strictObject({
    name: z.string().min(1),
    title: LocalizedText.optional().describe("Headline, e.g. 'Senior Software Engineer'"),
    email: z.email().optional(),
    phone: z.string().min(1).optional(),
    url: Url.optional(),
    location: z.union([LocalizedText, Location]).optional(),
    photo: z.string().min(1).optional().describe("Path to an image, relative to the CV file"),
    summary: LocalizedText.optional(),
    profiles: z.array(Profile).optional(),
  })
  .describe("Who you are and how to reach you. `name` and at least one contact are required.");

// ---------------------------------------------------------------------------
// Section items
// ---------------------------------------------------------------------------

const itemBase = {
  tags: Tags.optional(),
};

const dated = {
  start: PartialDate.optional(),
  end: EndDate.optional(),
};

const Highlights = z.array(LocalizedText);

export const ExperienceItem = z.strictObject({
  ...itemBase,
  ...dated,
  company: LocalizedText,
  role: LocalizedText,
  location: LocalizedText.optional(),
  url: Url.optional(),
  summary: LocalizedText.optional(),
  highlights: Highlights.optional(),
});

export const EducationItem = z.strictObject({
  ...itemBase,
  ...dated,
  institution: LocalizedText,
  degree: LocalizedText.optional(),
  field: LocalizedText.optional(),
  location: LocalizedText.optional(),
  grade: z.string().optional(),
  url: Url.optional(),
  highlights: Highlights.optional(),
});

export const SkillItem = z.strictObject({
  ...itemBase,
  name: LocalizedText,
  level: LocalizedText.optional(),
  keywords: z.array(LocalizedText).optional(),
});

export const LanguageItem = z.strictObject({
  ...itemBase,
  language: LocalizedText,
  fluency: LocalizedText.optional().describe("e.g. Native, C1, Professional"),
});

export const ProjectItem = z.strictObject({
  ...itemBase,
  ...dated,
  name: LocalizedText,
  description: LocalizedText.optional(),
  url: Url.optional(),
  highlights: Highlights.optional(),
  keywords: z.array(LocalizedText).optional(),
});

export const CertificationItem = z.strictObject({
  ...itemBase,
  name: LocalizedText,
  issuer: LocalizedText.optional(),
  date: PartialDate.optional(),
  url: Url.optional(),
});

export const CustomItem = z.strictObject({
  ...itemBase,
  ...dated,
  title: LocalizedText.optional(),
  subtitle: LocalizedText.optional(),
  date: PartialDate.optional(),
  description: LocalizedText.optional(),
  url: Url.optional(),
  highlights: Highlights.optional(),
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const sectionBase = {
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "Section ids are lowercase, e.g. 'side-projects'")
    .optional()
    .describe("Stable id used by themes to place the section. Defaults to the type."),
  title: LocalizedText.optional().describe("Overrides the default localized heading"),
  tags: Tags.optional(),
};

function section<T extends string, I extends z.ZodType>(type: T, item: I) {
  return z.strictObject({ type: z.literal(type), ...sectionBase, items: z.array(item) });
}

export const ExperienceSection = section("experience", ExperienceItem);
export const EducationSection = section("education", EducationItem);
export const SkillsSection = section("skills", SkillItem);
export const LanguagesSection = section("languages", LanguageItem);
export const ProjectsSection = section("projects", ProjectItem);
export const CertificationsSection = section("certifications", CertificationItem);
export const CustomSection = z.strictObject({
  type: z.literal("custom"),
  ...sectionBase,
  title: LocalizedText.describe("Heading of the custom section (required)"),
  items: z.array(CustomItem),
});

export const Section = z.discriminatedUnion("type", [
  ExperienceSection,
  EducationSection,
  SkillsSection,
  LanguagesSection,
  ProjectsSection,
  CertificationsSection,
  CustomSection,
]);
export type Section = z.output<typeof Section>;
export type SectionType = Section["type"];
export const SECTION_TYPES = [
  "experience",
  "education",
  "skills",
  "languages",
  "projects",
  "certifications",
  "custom",
] as const satisfies readonly SectionType[];

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const ContentMeta = z.strictObject({
  defaultLocale: LocaleCode.optional().describe("Locale used when --lang is not given"),
  locales: z.array(LocaleCode).optional().describe("Locales this CV is written in"),
  lint: LintConfig.optional(),
});

export const Content = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1).optional().describe("cvac content format version"),
  meta: ContentMeta.optional(),
  basics: Basics,
  sections: z.array(Section).default([]),
});
export type Content = z.output<typeof Content>;
export type ContentInput = z.input<typeof Content>;
