import { describe, expect, it } from "vitest";
import { formatPaise, marginOnCost, paiseToInput, parseRupees, parseSignedRupees, splitInclusive } from "../shared/money";

describe("money", () => {
  it("parses rupee strings into exact paise", () => {
    expect(parseRupees("1250")).toBe(125000);
    expect(parseRupees("1,250.5")).toBe(125050);
    expect(parseRupees("₹ 0.10")).toBe(10);
    expect(parseRupees("0.29")).toBe(29); // no float drift (0.29 * 100 = 28.999…)
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "12.3.4"]) expect(parseRupees(bad)).toBeNull();
    expect(parseSignedRupees("-2500")).toBe(-250000);
  });

  it("works out margin on cost from a GST-inclusive selling price", () => {
    // ₹1,180 incl. 18% GST = ₹1,000 taxable; cost ₹800 → 25%.
    expect(marginOnCost(118000, 1800, 80000)).toBe(25);
    expect(marginOnCost(118000, 1800, 0)).toBeNull();
  });

  it("formats with Indian grouping and round-trips through the input format", () => {
    expect(formatPaise(1234567890)).toBe("1,23,45,678.90");
    expect(formatPaise(-5)).toBe("-0.05");
    expect(paiseToInput(399900)).toBe("3999.00");
    expect(parseRupees(paiseToInput(123405))).toBe(123405);
  });

  it("splits GST-inclusive prices so taxable + tax always equals the price", () => {
    expect(splitInclusive(11800, 1800)).toEqual({ taxablePaise: 10000, taxPaise: 1800 });
    expect(splitInclusive(399900, 1800)).toEqual({ taxablePaise: 338898, taxPaise: 61002 });
    for (let price = 0; price < 5000; price += 37) {
      for (const rate of [0, 500, 1200, 1800, 2800]) {
        const { taxablePaise, taxPaise } = splitInclusive(price, rate);
        expect(taxablePaise + taxPaise).toBe(price);
        expect(taxPaise).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("WhatsApp numbers", () => {
  it("accepts Indian mobiles in common formats and rejects landlines", async () => {
    const { whatsAppNumber } = await import("../shared/india");
    expect(whatsAppNumber("98422 12345")).toBe("919842212345");
    expect(whatsAppNumber("+91-98422-12345")).toBe("919842212345");
    expect(whatsAppNumber("09842212345")).toBe("919842212345");
    expect(whatsAppNumber("0421 2234567")).toBeNull();
    expect(whatsAppNumber("")).toBeNull();
  });
});
