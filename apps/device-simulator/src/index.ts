/**
 * SIMULATED LOCKER CONTROLLER — development only. This is not firmware and controls no hardware.
 *
 * Plays the device side of the Milestone 1 device API: heartbeats, command polling, ack,
 * door open/close events, and injectable faults so the backend's failure handling can be
 * exercised locally.
 *
 *   pnpm --filter @sl/device-simulator start -- run [--device SIM-BLR-IND-A] [--scenario normal]
 *   pnpm --filter @sl/device-simulator start -- run --all
 *   pnpm --filter @sl/device-simulator start -- pin --device SIM-BLR-IND-A --compartment S1 --code 123456
 *   pnpm --filter @sl/device-simulator start -- event --device SIM-BLR-IND-A --compartment S1 --type TAMPER_DETECTED
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEVICE_EVENT_TYPES, type DeviceEventType } from '@sl/shared';

const SCENARIOS = {
  normal: 'Ack commands, open the door, close it after the hold time',
  offline: 'Send no heartbeats and ignore commands (device appears offline)',
  'no-ack': 'Receive commands but never acknowledge them (unlock times out)',
  'ack-fail': 'Acknowledge commands with result FAILED (lock jammed)',
  'door-stuck-open': 'Open the door but never report it closed (door-left-open alert)',
  'duplicate-events': 'Send every event twice (backend must deduplicate)',
  'out-of-order': 'Deliver a stale DOOR_CLOSED after DOOR_OPENED (must be ignored)',
  flaky: 'Drop ~50% of heartbeats and delay acks by 3s',
} as const;
type Scenario = keyof typeof SCENARIOS;

interface SimDevice {
  deviceIdentifier: string;
  outlet: string;
  token: string;
  compartments: string[];
}

interface Command {
  commandId: string;
  compartmentCode: string;
  type: string;
  expiresAt: string;
  nonce: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const SIM_FILE = process.env.SIM_DEVICES_FILE ?? path.resolve(here, '../../../.sim-devices.json');

function loadDevices(): { apiUrl: string; devices: SimDevice[] } {
  if (process.env.SIM_DEVICE_TOKEN && process.env.SIM_DEVICE_ID) {
    return {
      apiUrl: process.env.SIM_API_URL ?? 'http://localhost:4000',
      devices: [
        {
          deviceIdentifier: process.env.SIM_DEVICE_ID,
          outlet: '(env)',
          token: process.env.SIM_DEVICE_TOKEN,
          compartments: [],
        },
      ],
    };
  }
  try {
    const f = JSON.parse(readFileSync(SIM_FILE, 'utf8'));
    return { apiUrl: process.env.SIM_API_URL ?? f.apiUrl, devices: f.devices };
  } catch {
    console.error(`No simulated devices found. Run "pnpm db:seed" first (writes ${SIM_FILE}),`);
    console.error(
      'or set SIM_DEVICE_ID and SIM_DEVICE_TOKEN for a device registered in the admin UI.',
    );
    process.exit(1);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SimulatedLocker {
  // Monotonic across restarts without persisting state.
  private sequence = Date.now();
  private readonly handled = new Set<string>();

  constructor(
    private readonly apiUrl: string,
    private readonly device: SimDevice,
    private readonly scenario: Scenario,
    private readonly doorHoldMs: number,
  ) {}

  private log(msg: string) {
    console.log(
      `[SIM ${this.device.deviceIdentifier}] ${new Date().toISOString().slice(11, 19)} ${msg}`,
    );
  }

  private async call(method: string, p: string, body?: unknown) {
    const res = await fetch(`${this.apiUrl}/api/v1/devices${p}`, {
      method,
      headers: { authorization: `Bearer ${this.device.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${json?.error?.code ?? text}`);
    return json;
  }

  async heartbeat() {
    if (this.scenario === 'offline') return;
    if (this.scenario === 'flaky' && Math.random() < 0.5)
      return this.log('heartbeat dropped (flaky)');
    await this.call('POST', '/heartbeat', {
      firmwareVersion: 'sim-0.1.0',
      powerState: 'MAINS',
      connectivity: 'WIFI',
      sentAt: new Date().toISOString(),
    });
  }

  async event(
    type: DeviceEventType,
    compartmentCode?: string,
    commandId?: string,
    sequence = ++this.sequence,
  ) {
    const body = {
      eventId: randomUUID(),
      type,
      compartmentCode,
      commandId,
      occurredAt: new Date().toISOString(),
      sequence,
    };
    const r = await this.call('POST', '/events', body);
    this.log(
      `event ${type}${compartmentCode ? ` ${compartmentCode}` : ''} -> ${JSON.stringify(r)}`,
    );
    if (this.scenario === 'duplicate-events') {
      const dup = await this.call('POST', '/events', body);
      this.log(`  duplicate re-sent -> ${JSON.stringify(dup)}`);
    }
  }

  async handle(cmd: Command) {
    this.log(
      `command ${cmd.type} ${cmd.compartmentCode} (${cmd.commandId.slice(0, 8)}) expires ${cmd.expiresAt}`,
    );
    if (this.scenario === 'no-ack') return this.log('  ignoring command (no-ack scenario)');
    if (this.scenario === 'flaky') await sleep(3000);
    const result = this.scenario === 'ack-fail' ? 'FAILED' : 'OK';
    const ack = await this.call('POST', `/commands/${cmd.commandId}/ack`, {
      result,
      nonce: cmd.nonce,
      detail: result === 'FAILED' ? 'SIMULATED_LOCK_JAM' : undefined,
    });
    this.log(`  ack ${result} -> ${ack.status}`);
    if (result === 'FAILED') return;

    if (this.scenario === 'out-of-order') {
      // Network reordering: a DOOR_CLOSED stamped *before* the door-open arrives *after* it.
      // If the backend applied it, the booking would complete while the door is still open.
      const delayedSequence = ++this.sequence;
      await this.event('DOOR_OPENED', cmd.compartmentCode, cmd.commandId);
      await this.event('DOOR_CLOSED', cmd.compartmentCode, cmd.commandId, delayedSequence);
      await sleep(this.doorHoldMs);
      await this.event('DOOR_CLOSED', cmd.compartmentCode, cmd.commandId);
      return;
    }
    await this.event('DOOR_OPENED', cmd.compartmentCode, cmd.commandId);
    if (this.scenario === 'door-stuck-open')
      return this.log('  door left open (door-stuck-open scenario)');
    await sleep(this.doorHoldMs);
    await this.event('DOOR_CLOSED', cmd.compartmentCode, cmd.commandId);
  }

  async run(heartbeatMs: number, pollMs: number) {
    this.log(
      `SIMULATED device for "${this.device.outlet}" — scenario: ${this.scenario} (${SCENARIOS[this.scenario]})`,
    );
    let lastBeat = 0;
    for (;;) {
      try {
        if (Date.now() - lastBeat >= heartbeatMs) {
          await this.heartbeat();
          lastBeat = Date.now();
        }
        if (this.scenario !== 'offline') {
          const { commands } = (await this.call('GET', '/commands')) as { commands: Command[] };
          for (const c of commands) {
            if (this.handled.has(c.commandId)) continue;
            this.handled.add(c.commandId);
            void this.handle(c).catch((e) => this.log(`  error: ${(e as Error).message}`));
          }
        }
      } catch (e) {
        this.log(`error: ${(e as Error).message}`);
      }
      await sleep(pollMs);
    }
  }

  async enterPin(compartmentCode: string, pin: string) {
    const r = await this.call('POST', '/access/verify-pin', { compartmentCode, pin });
    this.log(
      `keypad PIN accepted -> ${JSON.stringify(r)} (run the simulator to execute the unlock)`,
    );
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      device: { type: 'string' },
      all: { type: 'boolean', default: false },
      scenario: { type: 'string', default: 'normal' },
      compartment: { type: 'string' },
      code: { type: 'string' },
      type: { type: 'string' },
      'door-hold-ms': { type: 'string', default: '2000' },
      'heartbeat-ms': { type: 'string', default: '15000' },
      'poll-ms': { type: 'string', default: '1500' },
      help: { type: 'boolean', default: false },
    },
  });
  const cmd = positionals[0] ?? 'run';
  if (values.help || !['run', 'pin', 'event', 'list'].includes(cmd)) {
    console.log('Commands: run | pin | event | list. Scenarios:');
    for (const [k, v] of Object.entries(SCENARIOS)) console.log(`  ${k.padEnd(18)} ${v}`);
    return;
  }
  const scenario = values.scenario as Scenario;
  if (!(scenario in SCENARIOS)) throw new Error(`Unknown scenario ${scenario}`);
  const { apiUrl, devices } = loadDevices();
  if (cmd === 'list') {
    for (const d of devices)
      console.log(`${d.deviceIdentifier.padEnd(18)} ${d.outlet}  [${d.compartments.join(' ')}]`);
    return;
  }
  const pick = (id?: string) => {
    const d = id ? devices.find((x) => x.deviceIdentifier === id) : devices[0];
    if (!d) throw new Error(`Device ${id} not found in ${SIM_FILE}`);
    return d;
  };
  const hold = Number(values['door-hold-ms']);
  if (cmd === 'pin') {
    if (!values.compartment || !values.code)
      throw new Error('--compartment and --code are required');
    return new SimulatedLocker(apiUrl, pick(values.device), 'normal', hold).enterPin(
      values.compartment,
      values.code,
    );
  }
  if (cmd === 'event') {
    const t = values.type as DeviceEventType;
    if (!DEVICE_EVENT_TYPES.includes(t))
      throw new Error(`--type must be one of ${DEVICE_EVENT_TYPES.join(', ')}`);
    return new SimulatedLocker(apiUrl, pick(values.device), 'normal', hold).event(
      t,
      values.compartment,
    );
  }
  const targets = values.all ? devices : [pick(values.device)];
  await Promise.all(
    targets.map((d) =>
      new SimulatedLocker(apiUrl, d, scenario, hold).run(
        Number(values['heartbeat-ms']),
        Number(values['poll-ms']),
      ),
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
