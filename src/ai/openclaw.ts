import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const execAsync = promisify(exec);

const OPENCLAW_NODE =
  process.env.OPENCLAW_NODE ||
  "/Applications/Kimi.app/Contents/Resources/resources/runtime/node";
const OPENCLAW_MJS =
  process.env.OPENCLAW_MJS ||
  "/Applications/Kimi.app/Contents/Resources/resources/gateway/node_modules/openclaw/openclaw.mjs";
const OPENCLAW_STATE_DIR =
  process.env.OPENCLAW_STATE_DIR || "~/.kimi_openclaw";
const OPENCLAW_TIMEOUT = parseInt(process.env.OPENCLAW_TIMEOUT || "180", 10);

function getStateDir(): string {
  return OPENCLAW_STATE_DIR.startsWith("~")
    ? join(homedir(), OPENCLAW_STATE_DIR.slice(1))
    : OPENCLAW_STATE_DIR;
}

function resolveGatewayPort(): number {
  const envPort = process.env.OPENCLAW_GATEWAY_PORT?.trim();
  if (envPort) {
    const p = Number.parseInt(envPort, 10);
    if (Number.isFinite(p) && p > 0) return p;
  }
  try {
    const cfg = JSON.parse(
      readFileSync(join(getStateDir(), "openclaw.json"), "utf-8")
    );
    const port = cfg?.gateway?.port;
    if (typeof port === "number" && Number.isFinite(port) && port > 0)
      return port;
  } catch {}
  return 18679;
}

function resolveGatewayToken(): string | null {
  try {
    const cfg = JSON.parse(
      readFileSync(join(getStateDir(), "openclaw.json"), "utf-8")
    );
    return (
      cfg?.gateway?.auth?.token ??
      cfg?.gateway?.token ??
      cfg?.channels?.kimiClaw?.gateway?.token ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * 调用 OpenClaw CLI 发送消息。
 * 使用相同的 session key（默认 agent:main:main），上下文会被保留。
 */
export async function callOpenClaw(
  prompt: string,
  options?: {
    timeout?: number;
    agent?: string;
  }
): Promise<string> {
  const agentId = options?.agent || "main";
  const timeout = options?.timeout || OPENCLAW_TIMEOUT;
  const gatewayPort = resolveGatewayPort();
  const envVars = [
    `OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR}`,
    `OPENCLAW_GATEWAY_PORT=${gatewayPort}`,
  ].join(" ");

  const cmd = `${envVars} ${OPENCLAW_NODE} ${OPENCLAW_MJS} agent --agent ${agentId} --message ${JSON.stringify(prompt)} --timeout ${timeout}`;

  const { stdout, stderr } = await execAsync(cmd, {
    timeout: (timeout + 20) * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const stderrLines = stderr.split("\n").filter((l) => {
    if (l.startsWith("│") || l.startsWith("◇") || l.startsWith("├"))
      return false;
    if (l.includes("Doctor warnings")) return false;
    if (l.includes("iMessage.groupPolicy")) return false;
    if (l.startsWith("[plugins]")) return false;
    if (l.includes("agents.defaults.timeoutSeconds")) return false;
    if (l.includes("command not found")) return false;
    if (l.includes("No such file or directory")) return false;
    if (l.includes("syntax error")) return false;
    if (l.includes("command substitution")) return false;
    return true;
  });
  if (stderrLines.some((l) => l.trim())) {
    console.warn("[OpenClaw] stderr:", stderrLines.join("\n").trim());
  }

  const lines = stdout
    .split("\n")
    .filter((l) => !l.startsWith("[plugins]"));
  const text = lines.join("\n").trim();

  if (!text) {
    throw new Error(`No content in openclaw response for agent ${agentId}`);
  }
  return text;
}

/**
 * 通过 Gateway RPC 重置指定 agent 的 session。
 * 重置后，下一次调用会开启一个全新的对话上下文。
 */
export async function resetOpenClawSession(
  agentId: string = "main"
): Promise<{ ok: boolean; key: string }> {
  const gatewayPort = resolveGatewayPort();
  const token = resolveGatewayToken();
  const sessionKey = `agent:${agentId}:main`;

  const tokenArg = token ? `--token ${token}` : "";
  const envVars = [
    `OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR}`,
    `OPENCLAW_GATEWAY_PORT=${gatewayPort}`,
  ].join(" ");

  const cmd = `${envVars} ${OPENCLAW_NODE} ${OPENCLAW_MJS} gateway call --url ws://127.0.0.1:${gatewayPort} ${tokenArg} sessions.reset --params ${JSON.stringify(JSON.stringify({ key: sessionKey }))} --timeout 10000 --json`;

  const { stdout, stderr } = await execAsync(cmd, {
    timeout: 15000,
    maxBuffer: 5 * 1024 * 1024,
  });

  const stderrLines = stderr.split("\n").filter((l) => {
    if (l.startsWith("│") || l.startsWith("◇") || l.startsWith("├"))
      return false;
    if (l.includes("Doctor warnings")) return false;
    if (l.includes("iMessage.groupPolicy")) return false;
    if (l.startsWith("[plugins]")) return false;
    if (l.includes("agents.defaults.timeoutSeconds")) return false;
    if (l.includes("command not found")) return false;
    if (l.includes("No such file or directory")) return false;
    if (l.includes("syntax error")) return false;
    if (l.includes("command substitution")) return false;
    return true;
  });
  if (stderrLines.some((l) => l.trim())) {
    console.warn("[OpenClaw] reset stderr:", stderrLines.join("\n").trim());
  }

  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `Gateway reset response did not contain JSON. stdout: ${stdout.slice(0, 500)}`
    );
  }

  const result = JSON.parse(jsonMatch[0]) as {
    ok?: boolean;
    key?: string;
    error?: string;
  };

  if (result.error) {
    throw new Error(`Gateway reset failed: ${result.error}`);
  }

  console.log(`[OpenClaw] Session reset: ${result.key}`);
  return { ok: result.ok ?? true, key: result.key ?? sessionKey };
}
