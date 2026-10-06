export type PropositionName = "schawb";

export type PropositionConfig = Readonly<{
  proposition: PropositionName;
  providerName: "charles_schwab";
  apiUrl: string;
}>;

const propositionConfigs: Record<PropositionName, PropositionConfig> = {
  schawb: {
    proposition: "schawb",
    providerName: "charles_schwab",
    apiUrl: "https://api.schwabapi.com",
  },
};

const propositionAliases = new Map<string, PropositionName>([
  ["schawb", "schawb"],
  ["schwab", "schawb"],
  ["charles_schwab", "schawb"],
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
