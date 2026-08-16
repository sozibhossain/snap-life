import { describe, expect, it } from "vitest";
import {
  renderCoachingConfirmation,
  renderExpertSupportConfirmation,
} from "../emailTemplates";

describe("service request confirmation emails", () => {
  it("marks paid coaching as pending and includes the secure checkout", () => {
    const rendered = renderCoachingConfirmation({
      name: "Alex <Test>",
      sessionLabel: "Focus Session",
      bookingReference: "coach-123",
      paymentRequired: true,
      checkoutUrl: "https://payments.example/focus",
    });
    expect(rendered.subject).toContain("Complete secure payment");
    expect(rendered.html).toContain("https://payments.example/focus");
    expect(rendered.html).toContain("not confirmed until payment");
    expect(rendered.html).toContain("Alex &lt;Test&gt;");
    expect(rendered.html).not.toContain("<Test>");
    expect(rendered.html).not.toContain("Alex <Test>");
  });

  it("includes the selected expert service and escapes user-facing fields", () => {
    const rendered = renderExpertSupportConfirmation({
      name: "Alex <Test>",
      consultantLabel: "Faye & Team",
      consultantTitle: "Nutrition <Expert>",
      serviceLabel: "Power Hour — £125",
    });
    expect(rendered.html).toContain("Power Hour — £125");
    expect(rendered.html).toContain("Hi Alex,");
    expect(rendered.html).not.toContain("<Test>");
    expect(rendered.html).toContain("Faye &amp; Team");
    expect(rendered.html).toContain("Nutrition &lt;Expert&gt;");
  });
});
