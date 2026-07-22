import { routeEvidenceSummary, routeInstruction, routeVisual } from "./route.ts";
import { RouteStage, type RouteInput, type RouteStage as RouteStageType } from "./types.ts";

const args = Bun.argv.slice(2);

async function main(): Promise<void> {
  const parsed = await parseInput(args);
  const decision = routeVisual(parsed);
  const output = {
    ...decision,
    instruction: routeInstruction(decision),
    evidenceSummary: routeEvidenceSummary(decision.evidence),
  };
  process.stdout.write(`${JSON.stringify(output, null, args.includes("--compact") ? 0 : 2)}\n`);
}

async function parseInput(argv: string[]): Promise<RouteInput> {
  const stageArg = argv.find((arg) => Object.values(RouteStage).includes(arg as RouteStageType));
  const stage = (stageArg as RouteStageType | undefined) ?? RouteStage.Prompt;
  const textIndex = stageArg ? argv.indexOf(stageArg) + 1 : 0;
  const positionalText = argv.slice(textIndex).filter((arg) => arg !== "--compact").join(" ").trim();
  if (positionalText.length > 0) {
    if (stage === RouteStage.Response) return { stage, assistantResponse: positionalText };
    return { stage, userPrompt: positionalText };
  }

  const stdin = await Bun.stdin.text();
  if (stdin.trim().length === 0) return { stage };
  const value = JSON.parse(stdin) as Partial<RouteInput>;
  return {
    stage: isStage(value.stage) ? value.stage : stage,
    ...(typeof value.userPrompt === "string" ? { userPrompt: value.userPrompt } : {}),
    ...(typeof value.assistantResponse === "string" ? { assistantResponse: value.assistantResponse } : {}),
    ...(typeof value.toolName === "string" ? { toolName: value.toolName } : {}),
    ...(value.toolInput !== undefined ? { toolInput: value.toolInput } : {}),
    ...(value.toolResult !== undefined ? { toolResult: value.toolResult } : {}),
  };
}

function isStage(value: unknown): value is RouteStageType {
  return typeof value === "string" && Object.values(RouteStage).includes(value as RouteStageType);
}

await main();
