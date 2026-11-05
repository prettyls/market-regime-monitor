export type PropositionName = "schawb" | "stooq";

export type PropositionConfig = Readonly<{
  proposition: PropositionName;
  providerName: "charles_schwab" | "stooq";
  apiUrl: string;
}>;

const propositionConfigs: Record<PropositionName, PropositionConfig> = {
  schawb: {
    proposition: "schawb",
    providerName: "charles_schwab",
    apiUrl: "https://api.schwabapi.com",
  },
  stooq: {
    proposition: "stooq",
    providerName: "stooq",
    apiUrl: "https://stooq.com",
  },
};

const propositionAliases = new Map<string, PropositionName>([
  ["schawb", "schawb"],
  ["schwab", "schawb"],
  ["charles_schwab", "schawb"],
  ["stooq", "stooq"],
  ["stooq.com", "stooq"],
]);

export class PropositionMapping {
  resolveFromEnv(value: string | undefined): PropositionConfig {
    const normalized = (value ?? "schawb").trim().toLowerCase();
    const proposition = propositionAliases.get(normalized);
    if (!proposition) {
      throw new Error(`Unsupported DATA_PROVIDER proposition: ${value}`);
    }
    return propositionConfigs[proposition];
  }
}
