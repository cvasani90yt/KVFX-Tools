import { afterEach, describe, expect, it } from "vitest";
import { processRunning, processesAvailable, startProcess, stopProcess } from "../src/app/cep/process.js";

/**
 * cep.process — how the panel starts the system colour picker without After
 * Effects, so After Effects can never be left waiting on it.
 */

const global = globalThis as unknown as { window?: { cep?: { process?: unknown } } };

afterEach(() => {
  delete global.window;
});

describe("starting a program from the panel", () => {
  it("passes the full path and then each argument, and returns the pid", () => {
    const calls: string[][] = [];
    global.window = {
      cep: {
        process: {
          createProcess: (...args: string[]) => {
            calls.push(args);
            return { err: 0, data: 4242 };
          },
        },
      },
    };
    expect(processesAvailable()).toBe(true);
    expect(startProcess("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-EncodedCommand", "AAAA"])).toBe(4242);
    expect(calls).toEqual([["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoProfile", "-EncodedCommand", "AAAA"]]);
  });

  it("has no pid when CEP refuses, throws, or has no process bridge", () => {
    global.window = { cep: { process: { createProcess: () => ({ err: 3, data: -1 }) } } };
    expect(startProcess("x", [])).toBeUndefined();
    global.window = {
      cep: {
        process: {
          createProcess: () => {
            throw new Error("no");
          },
        },
      },
    };
    expect(startProcess("x", [])).toBeUndefined();
    global.window = { cep: {} };
    expect(processesAvailable()).toBe(false);
    expect(startProcess("x", [])).toBeUndefined();
  });

  it("reads results given as JSON strings too", () => {
    global.window = { cep: { process: { createProcess: () => '{"err":0,"data":7}', isRunning: () => '{"err":0,"data":false}' } } };
    expect(startProcess("x", [])).toBe(7);
    expect(processRunning(7)).toBe(false);
  });

  it("can't tell whether it runs when CEP can't, and stopping never throws", () => {
    global.window = { cep: { process: { createProcess: () => ({ err: 0, data: 1 }) } } };
    expect(processRunning(1)).toBeUndefined();
    expect(() => stopProcess(1)).not.toThrow();

    const stopped: number[] = [];
    global.window = {
      cep: {
        process: {
          createProcess: () => ({ err: 0, data: 1 }),
          isRunning: () => ({ err: 0, data: true }),
          terminate: (pid: number) => {
            stopped.push(pid);
            throw new Error("already gone");
          },
        },
      },
    };
    expect(processRunning(1)).toBe(true);
    expect(() => stopProcess(1)).not.toThrow();
    expect(stopped).toEqual([1]);
  });
});
