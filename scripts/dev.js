import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const useProcessGroups = process.platform !== "win32";
const children = [];
let shuttingDown = false;

function signalGroups(signal) {
  let groupExists = false;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, signal);
      groupExists = true;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  return groupExists;
}

function shutdown(exitCode, signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;

  if (!useProcessGroups) {
    for (const child of children) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("error", () => child.kill());
    }
    return;
  }

  // A watcher can exit before its workers. Check the whole group until it is gone.
  if (!signalGroups(signal)) return;
  const deadline = Date.now() + 3000;
  const check = setInterval(() => {
    if (!signalGroups(0)) {
      clearInterval(check);
    } else if (Date.now() >= deadline) {
      signalGroups("SIGKILL");
      clearInterval(check);
    }
  }, 50);
}

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    detached: useProcessGroups,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  child.on("exit", (code) => shutdown(code ?? 1));
  child.on("error", (error) => {
    console.error(`Unable to start ${name}`, error.message);
    shutdown(1);
  });
}

process.on("SIGINT", () => shutdown(130, "SIGINT"));
process.on("SIGTERM", () => shutdown(143));
process.on("SIGHUP", () => shutdown(129));

const localEnv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
start("dotnet watch", "dotnet", [
  "watch",
  "--project",
  "src/api/EmCoreInventory.Api.csproj",
  "run",
  "--no-launch-profile",
  "--urls",
  "http://127.0.0.1:3001",
], { ...localEnv, ...process.env });

if (!process.argv.includes("--server-only")) {
  start("Vite", process.execPath, [process.env.npm_execpath, "run", "dev:client"]);
}
