import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentJsonSchema, STARTER_CV, STARTER_THEME, themeJsonSchema } from "@cvac/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exportProject, importProject, MAX_PROJECT_BYTES, safePath } from "../src/project.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");
const photo = new Uint8Array(readFileSync(join(FIXTURES, "sidebar", "photo.jpg")));
const schemas = { cv: contentJsonSchema(), theme: themeJsonSchema() };

describe("project export", () => {
  it("lays the project out like `cvac init`, photo at the CV's path", () => {
    const { zip, skipped } = exportProject({
      cv: STARTER_CV,
      theme: STARTER_THEME,
      photo: { path: "img/me.jpg", data: photo },
      schemas,
    });
    expect(skipped).toBeUndefined();
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual([
      "cv.yaml",
      "theme.yaml",
      "img/me.jpg",
      ".cvac/schemas/cv.schema.json",
      ".cvac/schemas/theme.schema.json",
    ]);
    expect(strFromU8(files["cv.yaml"] as Uint8Array)).toBe(STARTER_CV);
    expect(files["img/me.jpg"]).toEqual(photo);
    expect(JSON.parse(strFromU8(files[".cvac/schemas/cv.schema.json"] as Uint8Array))).toEqual(
      schemas.cv,
    );
  });

  it("is byte-identical for the same files", () => {
    const a = exportProject({ cv: "a", theme: "b", photo: { path: "p.png", data: photo } });
    const b = exportProject({ cv: "a", theme: "b", photo: { path: "p.png", data: photo } });
    expect(a.zip).toEqual(b.zip);
  });

  it("leaves out a photo whose path escapes the project folder, and says why", () => {
    for (const path of ["../me.jpg", "/home/me.jpg", "C:\\me.jpg", "a/../../me.jpg"]) {
      const r = exportProject({ cv: "a", theme: "", photo: { path, data: photo } });
      expect(Object.keys(unzipSync(r.zip))).toEqual(["cv.yaml", "theme.yaml"]);
      expect(r.skipped).toContain("outside the project folder");
    }
  });

  it("accepts ./ and backslashes in relative paths", () => {
    expect(safePath("./photo.jpg")).toBe("photo.jpg");
    expect(safePath("img\\me.jpg")).toBe("img/me.jpg");
    expect(safePath("")).toBeUndefined();
  });
});

describe("project import", () => {
  it("round-trips an export", () => {
    const { zip } = exportProject({
      cv: STARTER_CV,
      theme: STARTER_THEME,
      photo: { path: "img/me.jpg", data: photo },
      schemas,
    });
    expect(importProject(zip)).toEqual({
      cv: STARTER_CV,
      theme: STARTER_THEME,
      photos: { "img/me.jpg": photo },
    });
  });

  it("finds the project inside a zipped folder and ignores files outside it", () => {
    const zip = zipSync({
      "my-cv/cv.yaml": strToU8("cv"),
      "my-cv/theme.yaml": strToU8("theme"),
      "my-cv/photo.jpg": photo,
      "my-cv/notes.txt": strToU8("ignored"),
      "other.png": photo,
      "__MACOSX/my-cv/._photo.jpg": strToU8("resource fork"),
    });
    expect(importProject(zip)).toEqual({
      cv: "cv",
      theme: "theme",
      photos: { "photo.jpg": photo },
    });
  });

  it("uses the default theme when there is no theme.yaml", () => {
    expect(importProject(zipSync({ "cv.yaml": strToU8("cv") }))).toEqual({
      cv: "cv",
      theme: "",
      photos: {},
    });
  });

  it("explains what is wrong with an unusable file", () => {
    expect(() => importProject(strToU8("not a zip"))).toThrow("not a valid zip");
    expect(() => importProject(zipSync({ "README.md": strToU8("hi") }))).toThrow("no cv.yaml");
    const huge = zipSync({ "cv.yaml": new Uint8Array(MAX_PROJECT_BYTES + 1) });
    expect(() => importProject(huge)).toThrow("more than 50 MB");
  });
});
