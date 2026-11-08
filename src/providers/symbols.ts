type ProviderSymbolSource = Readonly<{ provider: string; kind: string; providerSymbol: string }>;

// Schwab lists indices as $SPX and $VIX. A bare or caret-prefixed ticker returns an empty history.
const schwabIndexSymbol = (providerSymbol: string): string => {
  const symbol = providerSymbol.trim().toUpperCase();
  if (symbol.startsWith("$") || symbol.startsWith("/")) return symbol;
  return `$${symbol.replace(/^\^/, "")}`;
};

export const resolveProviderSymbol = (instrument: ProviderSymbolSource): string =>
  instrument.provider === "charles_schwab" && instrument.kind === "INDEX" ? schwabIndexSymbol(instrument.providerSymbol) : instrument.providerSymbol;
