import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { z } from "zod";
import type { tradingSkillInputSchema } from "../schemas.js";

const skillsRoot = new URL(import.meta.url.endsWith(".ts") ? "../../skills/" : "../../../skills/", import.meta.url);
const skills = {
  paper: {
    directory: "market-regime-paper-trading",
    references: ["references/workflows.md", "references/revisions.md"],
  },
  live: {
    directory: "market-regime-real-trading",
    references: [],
  },
} as const;

export async function readTradingSkill(workflow: z.infer<typeof tradingSkillInputSchema>["workflow"]) {
  const { directory, references } = skills[workflow];
  const files = await Promise.all(["SKILL.md", ...references].map(async path => ({
    path,
    text: await readFile(new URL(`${directory}/${path}`, skillsRoot), "utf8"),
  })));
  const version = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return { workflow, name: directory, version, files };
}
