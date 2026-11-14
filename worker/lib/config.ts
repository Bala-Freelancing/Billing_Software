export const MIN_PASSWORD_HASH_ITERATIONS = 10_000;
// workerd refuses PBKDF2 above 100,000 iterations.
export const MAX_PASSWORD_HASH_ITERATIONS = 100_000;

export interface AppConfig {
  passwordHashIterations: number;
}

/**
 * Reads and validates configuration from the Worker environment. A bad value
 * fails loudly instead of silently weakening password storage.
 */
export function getConfig(env: Pick<Env, "PASSWORD_HASH_ITERATIONS">): AppConfig {
  const iterations = Number(env.PASSWORD_HASH_ITERATIONS);
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PASSWORD_HASH_ITERATIONS ||
    iterations > MAX_PASSWORD_HASH_ITERATIONS
  ) {
    throw new Error(
      `PASSWORD_HASH_ITERATIONS must be an integer between ${MIN_PASSWORD_HASH_ITERATIONS} and ${MAX_PASSWORD_HASH_ITERATIONS}`,
    );
  }
  return { passwordHashIterations: iterations };
}
