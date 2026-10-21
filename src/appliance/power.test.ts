import { describe, expect, it } from "vitest";
import { batteryLevel, clockText, correctedNow, zoneOffset } from "./power.ts";

describe("the stick's battery", () => {
  it("warns at 10% and powers off at 3%, only while discharging", () => {
    expect(batteryLevel(null)).toBe("fine");
    expect(batteryLevel({ percent: 11, charging: false })).toBe("fine");
    expect(batteryLevel({ percent: 10, charging: false })).toBe("low");
    expect(batteryLevel({ percent: 4, charging: false })).toBe("low");
    expect(batteryLevel({ percent: 3, charging: false })).toBe("critical");
    expect(batteryLevel({ percent: 0, charging: false })).toBe("critical");
    expect(batteryLevel({ percent: 2, charging: true })).toBe("fine");
  });
});

describe("the stick's clock", () => {
  // 2026-10-21 12:34 UTC: Stockholm is on summer time (UTC+2), Riyadh UTC+3.
  const noon = Date.UTC(2026, 9, 21, 12, 34, 56);
  // 2026-12-01: Stockholm on winter time (UTC+1).
  const winter = Date.UTC(2026, 11, 1, 12, 34);

  it("shows 24-hour time in the writer's time zone", () => {
    expect(clockText(noon, "Europe/Stockholm")).toBe("14:34");
    expect(clockText(noon, "Asia/Riyadh")).toBe("15:34");
    expect(clockText(noon, "UTC")).toBe("12:34");
  });

  it("knows each zone's offset, summer time included", () => {
    expect(zoneOffset(noon, "Europe/Stockholm")).toBe(120);
    expect(zoneOffset(winter, "Europe/Stockholm")).toBe(60);
    expect(zoneOffset(noon, "America/New_York")).toBe(-240);
    expect(zoneOffset(noon, "Asia/Kolkata")).toBe(330);
  });

  it("corrects a hardware clock that keeps local time, and nothing else", () => {
    // Windows left the hardware clock at Stockholm's 14:34; Linux read it as UTC.
    const system = Date.UTC(2026, 9, 21, 14, 34);
    const fixed = correctedNow(system, "Europe/Stockholm", true);
    expect(clockText(fixed, "Europe/Stockholm")).toBe("14:34");
    expect(correctedNow(system, "Europe/Stockholm", false)).toBe(system);
  });
});
