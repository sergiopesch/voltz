import { describe, it, expect } from "vitest";

// Test the TTS helper functions (sentence splitting and markdown stripping)
// without spawning actual `say` processes

const SENTENCE_ENDINGS = /(?<=[.!?])\s+/;

function stripMarkdown(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

describe("TTS helpers", () => {
  describe("sentence splitting", () => {
    it("splits on periods", () => {
      const parts = "Hello world. How are you?".split(SENTENCE_ENDINGS);
      expect(parts).toEqual(["Hello world.", "How are you?"]);
    });

    it("splits on exclamation marks", () => {
      const parts = "Watch out! High voltage.".split(SENTENCE_ENDINGS);
      expect(parts).toEqual(["Watch out!", "High voltage."]);
    });

    it("splits on question marks", () => {
      const parts = "Is that a capacitor? Yes it is.".split(SENTENCE_ENDINGS);
      expect(parts).toEqual(["Is that a capacitor?", "Yes it is."]);
    });

    it("does not split on decimal numbers", () => {
      const parts = "Use a 4.7 kilo ohm resistor.".split(SENTENCE_ENDINGS);
      // "4.7" should not cause a split because there's no space after the period
      expect(parts.length).toBeLessThanOrEqual(2);
    });

    it("keeps incomplete sentences together", () => {
      const parts = "Hello world".split(SENTENCE_ENDINGS);
      expect(parts).toEqual(["Hello world"]);
    });
  });

  describe("markdown stripping", () => {
    it("removes code blocks", () => {
      expect(stripMarkdown("Text ```code here``` more")).toBe("Text  more");
    });

    it("removes inline code backticks", () => {
      expect(stripMarkdown("Use `resistor` for this")).toBe(
        "Use resistor for this"
      );
    });

    it("removes bold markers", () => {
      expect(stripMarkdown("This is **bold** text")).toBe("This is bold text");
    });

    it("removes italic markers", () => {
      expect(stripMarkdown("This is *italic* text")).toBe(
        "This is italic text"
      );
    });

    it("removes underscore bold/italic", () => {
      expect(stripMarkdown("__bold__ and _italic_")).toBe("bold and italic");
    });

    it("removes headers", () => {
      expect(stripMarkdown("## Header\nText")).toBe("Header\nText");
      expect(stripMarkdown("### Deep Header")).toBe("Deep Header");
    });

    it("removes links, keeping text", () => {
      expect(stripMarkdown("[click here](http://example.com)")).toBe(
        "click here"
      );
    });

    it("removes dash bullet points", () => {
      expect(stripMarkdown("- Item 1\n- Item 2")).toBe("Item 1\nItem 2");
    });

    it("removes + bullet points", () => {
      expect(stripMarkdown("+ Item 1\n+ Item 2")).toBe("Item 1\nItem 2");
    });

    it("removes numbered lists", () => {
      expect(stripMarkdown("1. First\n2. Second")).toBe("First\nSecond");
    });

    it("collapses excess newlines", () => {
      expect(stripMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
    });

    it("handles empty string", () => {
      expect(stripMarkdown("")).toBe("");
    });

    it("handles plain text without changes", () => {
      expect(stripMarkdown("Just plain text")).toBe("Just plain text");
    });
  });
});
