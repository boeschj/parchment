import { describe, it, expect } from "bun:test";
import { commandSpawnArgs } from "./command-poll.ts";

// The approved command string is what runs — byte for byte. These tests pin
// that: argv mode never re-words it, shell mode never wraps or decorates it.
describe("commandSpawnArgs", () => {
  it("spawns a bare-word command as an argv array, with no shell at all", () => {
    expect(commandSpawnArgs("uptime")).toEqual(["uptime"]);
    expect(commandSpawnArgs("git status --short")).toEqual(["git", "status", "--short"]);
    expect(commandSpawnArgs("/usr/bin/wc -l /tmp/a.log")).toEqual([
      "/usr/bin/wc",
      "-l",
      "/tmp/a.log",
    ]);
  });

  it("uses a shell only when the command genuinely needs one", () => {
    const pipeline = "ps aux | grep -c node";

    expect(commandSpawnArgs(pipeline)).toEqual(["/bin/sh", "-c", pipeline]);
  });

  it("passes the command to the shell verbatim — nothing is concatenated in", () => {
    const command = "echo \"$USER\" | tr a-z A-Z && printf ' done'";

    const args = commandSpawnArgs(command);

    expect(args[0]).toBe("/bin/sh");
    expect(args[1]).toBe("-c");
    expect(args[2]).toBe(command);
    expect(args).toHaveLength(3);
  });

  it("treats every shell metacharacter as needing a shell, not as an argv word", () => {
    const shellOnly = [
      "cat a > b",
      "cat a; rm b",
      "echo $HOME",
      "echo `id`",
      "ls *.ts",
      "a && b",
      "printf 'x y'",
    ];

    for (const command of shellOnly) {
      expect(commandSpawnArgs(command)).toEqual(["/bin/sh", "-c", command]);
    }
  });
});
