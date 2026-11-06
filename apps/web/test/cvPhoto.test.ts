import { parseContent, STARTER_CV } from "@cvac/core";
import { describe, expect, it } from "vitest";
import { photoPathFor, readPhoto, removePhoto, setPhoto } from "../src/cvPhoto.ts";

/** The parsed value, to check the text edits mean what they should. */
const parsedPhoto = (cv: string) => parseContent(cv).value?.basics.photo;

describe("photo button edits", () => {
  it("adds the photo to the starter CV, replacing its commented hint", () => {
    expect(readPhoto(STARTER_CV)).toBeUndefined();
    const next = setPhoto(STARTER_CV, "photo.jpg") as string;
    expect(readPhoto(next)).toBe("photo.jpg");
    expect(parsedPhoto(next)).toBe("photo.jpg");
    expect(next.split("\n").length).toBe(STARTER_CV.split("\n").length);
    expect(next).not.toContain("# photo:");
  });

  it("adds the key after a multi-line name, at the block's indentation", () => {
    // A folded name spans several lines; the key goes after all of them.
    const cv = "basics:\n    name: >-\n      Jane\n      Doe\n    email: j@x.it\nsections: []\n";
    const next = setPhoto(cv, "photo.png") as string;
    expect(next).toBe(
      "basics:\n    name: >-\n      Jane\n      Doe\n    photo: photo.png\n    email: j@x.it\nsections: []\n",
    );
    expect(parsedPhoto(next)).toBe("photo.png");
  });

  it("adds the key first in basics when there is no name", () => {
    expect(setPhoto("basics:\n  email: j@x.it\n", "photo.jpg")).toBe(
      "basics:\n  photo: photo.jpg\n  email: j@x.it\n",
    );
  });

  it("replaces an existing value, quoted or with a comment", () => {
    const cv = 'basics:\n  name: Jane\n  photo: "me.jpg"  # mine\n  email: j@x.it\n';
    expect(readPhoto(cv)).toBe("me.jpg");
    expect(setPhoto(cv, "photo.png")).toBe(
      "basics:\n  name: Jane\n  photo: photo.png\n  email: j@x.it\n",
    );
  });

  it("ignores photo keys outside basics or deeper inside it", () => {
    const cv = "meta:\n  photo: no.jpg\nbasics:\n  name: Jane\n  location:\n    photo: no.jpg\n";
    expect(readPhoto(cv)).toBeUndefined();
    expect(setPhoto(cv, "photo.jpg")).toBe(
      "meta:\n  photo: no.jpg\nbasics:\n  name: Jane\n  photo: photo.jpg\n  location:\n    photo: no.jpg\n",
    );
  });

  it("removes the line, and gives up when there is nothing it can edit", () => {
    const withPhoto = setPhoto(STARTER_CV, "photo.jpg") as string;
    const removed = removePhoto(withPhoto) as string;
    expect(readPhoto(removed)).toBeUndefined();
    expect(parsedPhoto(removed)).toBeUndefined();
    expect(removePhoto(STARTER_CV)).toBeUndefined();
    // Flow-style or missing basics: the user edits by hand.
    expect(setPhoto("basics: { name: Jane }\n", "photo.jpg")).toBeUndefined();
    expect(setPhoto("sections: []\n", "photo.jpg")).toBeUndefined();
  });

  it("names the file by its type", () => {
    expect(photoPathFor({ name: "me.PNG", type: "" })).toBe("photo.png");
    expect(photoPathFor({ name: "me", type: "image/png" })).toBe("photo.png");
    expect(photoPathFor({ name: "me.jpeg", type: "image/jpeg" })).toBe("photo.jpg");
  });
});
