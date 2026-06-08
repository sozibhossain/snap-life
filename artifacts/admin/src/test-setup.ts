import "@testing-library/jest-dom";

// Radix UI primitives use pointer-capture APIs that jsdom does not implement.
// Stub them so Select, Dialog, and other Radix components work in tests.
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => undefined;
  window.HTMLElement.prototype.releasePointerCapture = () => undefined;

  // Radix UI also calls scrollIntoView on menu items in some versions.
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
}
