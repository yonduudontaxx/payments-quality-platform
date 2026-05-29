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
  config = { ...config, ...update };
  return getSimulationConfig();
}

export function resetSimulationConfig(): void {
  config = { timeout_ms: 0, decline_rate: 0.0 };
}
