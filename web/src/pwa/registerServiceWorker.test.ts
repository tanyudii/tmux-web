import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./registerServiceWorker";

function fakeNavigatorWithSupport(register: ReturnType<typeof vi.fn>) {
  return { serviceWorker: { register } } as unknown as Navigator;
}

function fakeNavigatorWithoutSupport() {
  return {} as Navigator;
}

function fakeWindow() {
  const loadListeners: Array<() => void> = [];
  const windowImpl = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "load") loadListeners.push(handler);
    }),
  } as unknown as Window;
  return { windowImpl, fireLoad: () => loadListeners.forEach((handler) => handler()) };
}

describe("registerServiceWorker", () => {
  it("does nothing when the browser has no serviceWorker support", () => {
    const { windowImpl } = fakeWindow();

    registerServiceWorker({ navigatorImpl: fakeNavigatorWithoutSupport(), windowImpl });

    expect(windowImpl.addEventListener).not.toHaveBeenCalled();
  });

  it("registers /sw.js once the window has loaded", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const { windowImpl, fireLoad } = fakeWindow();

    registerServiceWorker({ navigatorImpl: fakeNavigatorWithSupport(register), windowImpl });
    expect(register).not.toHaveBeenCalled();

    fireLoad();

    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("swallows a rejected registration without throwing", async () => {
    const register = vi.fn().mockRejectedValue(new Error("registration blocked"));
    const { windowImpl, fireLoad } = fakeWindow();

    registerServiceWorker({ navigatorImpl: fakeNavigatorWithSupport(register), windowImpl });

    expect(() => fireLoad()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
