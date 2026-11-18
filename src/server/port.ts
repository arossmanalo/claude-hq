import net from "node:net";

const HOST = "127.0.0.1";

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

/** Returns the first free port from `preferred` up to `preferred + attempts - 1`. */
export async function findFreePort(preferred: number, attempts = 20): Promise<number> {
  for (let port = preferred; port < preferred + attempts; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `Ports ${preferred}-${preferred + attempts - 1} are all in use. ` +
      `Close whatever is using them or set OFFICE_PORT to another port.`,
  );
}

export { HOST };
