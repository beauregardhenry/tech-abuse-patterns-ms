// Mulberry32: a small, public-domain, deterministic PRNG (Tommy Ettinger).
// Not cryptographically secure — fine for synthetic data generation, where
// the only requirement is "same seed in, same records out."
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  // Returns a float in [0, 1).
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns an integer in [0, maxExclusive).
  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("cannot pick from an empty list");
    }
    return items[this.nextInt(items.length)]!;
  }

  // Weighted pick: weights need not sum to 1.
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length !== weights.length || items.length === 0) {
      throw new Error("items and weights must be non-empty and equal length");
    }
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  // True with probability p (0..1).
  chance(p: number): boolean {
    return this.next() < p;
  }
}
