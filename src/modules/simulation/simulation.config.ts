export interface SimulationConfig {
  timeout_ms: number;
  decline_rate: number; // 0.0 to 1.0
}

let config: SimulationConfig = {
  timeout_ms: 0,
  decline_rate: 0.0,
};

export function getSimulationConfig(): SimulationConfig {
  return { ...config }; // return a copy
}

export function setSimulationConfig(update: Partial<SimulationConfig>): SimulationConfig {
  config = {
    ...config,
    ...(update.timeout_ms !== undefined
      ? { timeout_ms: Math.max(0, Math.min(30_000, update.timeout_ms)) }
      : {}),
    ...(update.decline_rate !== undefined
      ? { decline_rate: Math.max(0, Math.min(1, update.decline_rate)) }
      : {}),
  };
  return getSimulationConfig();
}

export function resetSimulationConfig(): void {
  config = { timeout_ms: 0, decline_rate: 0.0 };
}
