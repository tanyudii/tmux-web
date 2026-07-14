// Sandboxed/containerized environments (this dev box, and most CI runners) can't
// give Chrome the kernel privileges its default sandbox needs. Same fix is needed
// for the GitHub Actions job, so this lives in source control, not a local hack.
config.set({
    browsers: ["ChromeHeadlessNoSandbox"],
    customLaunchers: {
        ChromeHeadlessNoSandbox: {
            base: "ChromeHeadless",
            flags: [
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--enable-logging=stderr",
                "--v=1",
            ],
        },
    },
    // The Wasm binary is large enough that instantiating it can outrun
    // Karma's 2s default ping/capture timeouts on a resource-constrained
    // sandbox, producing a false "Disconnected ... ping timeout" before the
    // browser ever gets to run a single test.
    captureTimeout: 120000,
    browserDisconnectTimeout: 60000,
    browserDisconnectTolerance: 3,
    browserNoActivityTimeout: 120000,
    pingTimeout: 60000,
});
