import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const nextBin = require.resolve("next/dist/bin/next")
const port = process.env.PORT || "43123"

const child = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEO4J_DISABLED: "1",
  },
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
