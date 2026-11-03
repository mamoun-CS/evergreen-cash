import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { EverGreenDatabase, ensureDefaults } from "@/lib/db/database";
import {
  parseMajorToMinor,
  formatMinorGrouped,
  addMinor,
  subMinor,
} from "@/lib/money";
import { computeDeltas, totals } from "@/lib/finance/ledger";
import { lineTotal, invoiceTotals, paymentStatus } from "@/lib/finance/invoices";
import {
  encryptBackupPayload,
  decryptBackupPayload,
  hashPin,
  verifyPin,
} from "@/lib/crypto/backupCrypto";

describe("Phase 1 & 2: Financial Arithmetic & Money Integrity", () => {
  it("computes exact integer minor units without floating-point errors", () => {
    // 0.1 + 0.2 floating point anomaly prevention
    const val1 = parseMajorToMinor("0.1", 2); // 10n
    const val2 = parseMajorToMinor("0.2", 2); // 20n
    const sum = addMinor(val1, val2);
    expect(sum).toBe(30n);
    expect(formatMinorGrouped(sum, 2)).toBe("0.30");

    const diff = subMinor(sum, 15n);
    expect(diff).toBe(15n);
    expect(formatMinorGrouped(diff, 2)).toBe("0.15");
  });

  it("handles minor currency units for 3-decimal currencies like JOD", () => {
    const jod = parseMajorToMinor("12.500", 3);
    expect(jod).toBe(12500n);
    expect(formatMinorGrouped(jod, 3)).toBe("12.500");
  });
});

describe("Phase 2: Ledger Event Deltas & Financial Balance Rules", () => {
  it("correctly computes deltas for cash income", () => {
    const deltas = computeDeltas({
      type: "income",
      amountMinor: 50000n, // 500.00 ILS
      currency: "ILS",
      description: "قبض دفعة مقاولة",
      occurredAt: new Date().toISOString(),
    });

    expect(deltas.cashDelta).toBe(50000n);
    expect(deltas.incomeDelta).toBe(50000n);
    expect(deltas.expenseDelta).toBe(0n);
    expect(deltas.advanceDelta).toBe(0n);
  });

  it("correctly computes deltas for cash expense", () => {
    const deltas = computeDeltas({
      type: "expense",
      amountMinor: 12000n, // 120.00 ILS
      currency: "ILS",
      description: "شراء ديزل تراكتور",
      occurredAt: new Date().toISOString(),
    });

    expect(deltas.cashDelta).toBe(-12000n);
    expect(deltas.incomeDelta).toBe(0n);
    expect(deltas.expenseDelta).toBe(12000n);
    expect(deltas.advanceDelta).toBe(0n);
  });

  it("correctly separates cash advance issuance and does not treat it as expense", () => {
    // Ahmed received 500 ILS advance
    const advanceDeltas = computeDeltas({
      type: "advance_given",
      amountMinor: 50000n,
      currency: "ILS",
      personId: "person-ahmed",
      description: "سلفة لشراء مستلزمات",
      occurredAt: new Date().toISOString(),
    });

    expect(advanceDeltas.cashDelta).toBe(-50000n); // Cash decreases
    expect(advanceDeltas.advanceDelta).toBe(50000n); // Outstanding advance increases
    expect(advanceDeltas.expenseDelta).toBe(0n); // NOT an expense yet!
  });

  it("settles advance without double-counting cash movement", () => {
    // Ahmed spent 350 ILS: settle advance to expense
    const settlementDeltas = computeDeltas({
      type: "advance_settlement",
      amountMinor: 35000n,
      currency: "ILS",
      personId: "person-ahmed",
      description: "فواتير مشتريات سماد",
      occurredAt: new Date().toISOString(),
    });

    expect(settlementDeltas.cashDelta).toBe(0n); // No cash moves!
    expect(settlementDeltas.advanceDelta).toBe(-35000n); // Advance decreases
    expect(settlementDeltas.expenseDelta).toBe(35000n); // Expense is recognized
  });

  it("refunds remaining advance back into cash", () => {
    // Ahmed returns remaining 150 ILS
    const refundDeltas = computeDeltas({
      type: "advance_refund",
      amountMinor: 15000n,
      currency: "ILS",
      personId: "person-ahmed",
      description: "استرداد باقي سلفة المشتريات",
      occurredAt: new Date().toISOString(),
    });

    expect(refundDeltas.cashDelta).toBe(15000n); // Cash increases back
    expect(refundDeltas.advanceDelta).toBe(-15000n); // Advance cleared
    expect(refundDeltas.expenseDelta).toBe(0n); // Not an expense
  });

  it("handles cash balance adjustment for counted inventory surplus and deficit", () => {
    const surplus = computeDeltas({
      type: "adjustment",
      amountMinor: 5000n,
      adjustmentDirection: "increase",
      currency: "ILS",
      description: "تسوية زيادة",
      occurredAt: new Date().toISOString(),
    });
    expect(surplus.cashDelta).toBe(5000n);

    const deficit = computeDeltas({
      type: "adjustment",
      amountMinor: 2500n,
      adjustmentDirection: "decrease",
      currency: "ILS",
      description: "تسوية عجز",
      occurredAt: new Date().toISOString(),
    });
    expect(deficit.cashDelta).toBe(-2500n);
  });
});

describe("Phase 3: Invoices & Business Integrity", () => {
  it("calculates invoice line totals and grand totals with discount and tax", () => {
    // 5 dunums at 100 ILS/dunum
    const qty = parseMajorToMinor("5.000", 3); // 5000n
    const unitPrice = parseMajorToMinor("100.00", 2); // 10000n
    const line1 = lineTotal(qty, 3, unitPrice); // 50000n = 500.00 ILS
    expect(line1).toBe(50000n);

    const { subtotal, grandTotal } = invoiceTotals(
      [{ lineTotalMinor: line1.toString() }],
      parseMajorToMinor("50.00", 2), // 50.00 discount
      parseMajorToMinor("15.00", 2), // 15.00 tax
    );

    expect(subtotal).toBe(50000n); // 500.00
    expect(grandTotal).toBe(46500n); // 500 - 50 + 15 = 465.00 ILS
  });

  it("determines payment status accurately", () => {
    expect(paymentStatus(10000n, 0n)).toBe("unpaid");
    expect(paymentStatus(10000n, 4000n)).toBe("partial");
    expect(paymentStatus(10000n, 10000n)).toBe("paid");
  });
});

describe("Phase 5: AES-256-GCM Encryption & PBKDF2 Recovery", () => {
  it("encrypts and decrypts database payload with user passphrase", async () => {
    const secretPayload = JSON.stringify({
      company: "EVER GREEN AGRICULTURAL CONTRACTORS",
      cashBalance: "5000.00",
      records: 42,
    });
    const passphrase = "EverGreenSecurePass123!";

    const encrypted = await encryptBackupPayload(secretPayload, passphrase);
    expect(encrypted.bytes.length).toBeGreaterThan(50);
    expect(encrypted.sha256).toBeDefined();

    const decrypted = await decryptBackupPayload(encrypted.bytes, passphrase);
    expect(decrypted).toBe(secretPayload);
  });

  it("rejects decryption when wrong passphrase is provided", async () => {
    const payload = "Confidential Financial Data";
    const encrypted = await encryptBackupPayload(payload, "RightPassphrase123!");

    await expect(
      decryptBackupPayload(encrypted.bytes, "WrongPassphrase999!")
    ).rejects.toThrow();
  });

  it("hashes and verifies security PIN with PBKDF2 and salt", async () => {
    const pin = "7890";
    const { hash, salt, iterations } = await hashPin(pin);

    const isValid = await verifyPin(pin, hash, salt, iterations);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPin("1111", hash, salt, iterations);
    expect(isInvalid).toBe(false);
  });
});
