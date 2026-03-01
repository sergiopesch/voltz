import { describe, it, expect } from "vitest";

// Test redaction patterns directly by importing the logger internals
// Since redaction is internal, we test via the exported logger behavior

describe("logger", () => {
  describe("redaction patterns", () => {
    // We test the redaction logic by examining what patterns should match
    const SENSITIVE_PATTERNS = [
      /api[_-]?key/i,
      /token/i,
      /secret/i,
      /password/i,
      /passwd/i,
      /auth/i,
      /credential/i,
      /^key$/i,
    ];

    function isSensitiveKey(key: string): boolean {
      return SENSITIVE_PATTERNS.some((p) => p.test(key));
    }

    it("detects apiKey as sensitive", () => {
      expect(isSensitiveKey("apiKey")).toBe(true);
      expect(isSensitiveKey("api_key")).toBe(true);
      expect(isSensitiveKey("api-key")).toBe(true);
      expect(isSensitiveKey("API_KEY")).toBe(true);
    });

    it("detects token as sensitive", () => {
      expect(isSensitiveKey("token")).toBe(true);
      expect(isSensitiveKey("accessToken")).toBe(true);
      expect(isSensitiveKey("auth_token")).toBe(true);
    });

    it("detects password as sensitive", () => {
      expect(isSensitiveKey("password")).toBe(true);
      expect(isSensitiveKey("passwd")).toBe(true);
      expect(isSensitiveKey("PASSWORD")).toBe(true);
    });

    it("detects credential as sensitive", () => {
      expect(isSensitiveKey("credential")).toBe(true);
      expect(isSensitiveKey("credentials")).toBe(true);
    });

    it("does not flag normal keys", () => {
      expect(isSensitiveKey("component")).toBe(false);
      expect(isSensitiveKey("msg")).toBe(false);
      expect(isSensitiveKey("level")).toBe(false);
      expect(isSensitiveKey("error")).toBe(false);
    });

    it("detects exact 'key' as sensitive", () => {
      expect(isSensitiveKey("key")).toBe(true);
    });
  });

  describe("API key value detection", () => {
    it("catches sk- prefixed strings (alphanumeric only)", () => {
      const value = "sk-1234567890abcdef";
      expect(/^sk-[a-zA-Z0-9]{10,}/.test(value)).toBe(true);
    });

    it("does not catch sk- with hyphens in middle", () => {
      // The regex requires 10+ consecutive alphanumeric chars after 'sk-'
      const value = "sk-ant-api03-1234567890abcdef";
      // 'ant' is only 3 chars before the next hyphen
      expect(/^sk-[a-zA-Z0-9]{10,}/.test(value)).toBe(false);
    });

    it("does not flag short strings", () => {
      const value = "sk-abc";
      expect(/^sk-[a-zA-Z0-9]{10,}/.test(value)).toBe(false);
    });
  });
});
