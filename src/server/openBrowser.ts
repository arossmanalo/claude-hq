import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", (error) => {
    console.warn(`Could not open a browser automatically (${error.message}). Open ${url} yourself.`);
  });
  child.unref();
}
